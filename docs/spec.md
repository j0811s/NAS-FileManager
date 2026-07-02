# NAS-FileManager 仕様書

Raspberry Pi 5 (4GB) を NAS として運用し、Samba を主軸に、ブラウザ経由のファイル操作を **React + Hono の自作 Web アプリ**で提供する構成の仕様。

---

## 1. 全体構成

| レイヤ                         | 役割                                          | アクセス方法                                             |
| ------------------------------ | --------------------------------------------- | -------------------------------------------------------- |
| Samba (SMB)                    | **主軸**。日常のファイル操作                  | `smb://<PiのIP>`（Mac Finder / Windows / iOS / Android） |
| 自作 Web アプリ (React + Hono) | ブラウザからのアップロード / DL / 一覧 / 操作 | `http://<PiのIP>:8080`                                   |
| 共有ストレージ                 | 実データ置き場                                | 両者が**同一ディレクトリ**を参照                         |

**原則:** SMB と Web アプリは _同じ共有パス・同じ権限_ を見る。これにより「Finder で置いたファイルがブラウザにも見える／その逆」が成立する。

**運用方針:** **まずは LAN 内のみで運用**する（外部公開しない）。
外から使いたくなった場合も、直公開はせず **Tailscale などの VPN 越し**で後付けする。
外部到達は最後に足す方針とし、開発中はネットワークに一切露出させない。

---

## 2. 前提・環境

- ハード: Raspberry Pi 5 / 4GB
- OS: Raspberry Pi OS 64bit
- Samba: **設定済み**
- 共有パス: `/srv/nas/share`（← 実際の値に置き換え）
- 共通グループ: `nas`（Samba の `force group` に指定したもの）

> 実パスとグループの確認:
>
> ```bash
> grep -i path /etc/samba/smb.conf
> testparm -s 2>/dev/null | grep -iA10 '\[' | grep -i 'path\|force group'
> ```

---

## 3. 権限の統一（最重要）

Web アプリ（Node/Hono プロセス）と Samba でファイル所有者・パーミッションがずれると
「Finder では見えるのにブラウザから消せない」等が発生する。以下で必ず揃える。

- 共有ディレクトリは **setgid 付き** (`chmod 2775`) → 新規ファイルがグループを継承
- Node プロセスを **`nas` グループ ＋ `umask 0002`** で常駐させる
- 目標の状態: `ls -l /srv/nas/share` で、SMB 経由でも Web 経由でも
  グループが `nas`、パーミッションが `-rw-rw-r--`（ディレクトリは `drwxrwsr-x`）

---

## 4. バックエンド（Hono）

### 4.1 スタック

- ファイル I/O は Node の `fs` / `fs/promises` で共有パスを直接操作
- 認証: JWT もしくはセッション（`hono/jwt` など）。LAN 内限定でも最低限は付ける

### 4.2 API（最小構成）

| メソッド | パス                  | 役割                                             |
| -------- | --------------------- | ------------------------------------------------ |
| GET      | `/api/list?path=`     | ディレクトリ一覧（名前・サイズ・更新日時・種別） |
| POST     | `/api/upload?path=`   | アップロード（**ストリーミング必須**）           |
| GET      | `/api/download?path=` | ダウンロード                                     |
| POST     | `/api/mkdir`          | フォルダ作成                                     |
| POST     | `/api/rename`         | リネーム / 移動                                  |
| DELETE   | `/api/delete?path=`   | 削除                                             |

### 4.3 セキュリティ / 実装上の必須ポイント

**(A) パストラバーサル対策（最重要）**
ユーザー入力のパスをそのまま結合すると `../../etc/passwd` で共有外に出られる。
正規化後のパスが共有ルート配下に収まっているか必ず検証する。

```ts
import path from "node:path";

const ROOT = "/srv/nas/share";

function safeResolve(userPath: string): string {
  const resolved = path.resolve(ROOT, "." + path.sep + (userPath ?? ""));
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error("path traversal detected");
  }
  return resolved;
}
```

**(B) 大容量アップロードをメモリに載せない（4GB 機の生命線）**
`c.req.parseBody()` は全体をメモリに載せるので大きいファイルで落ちる。
リクエストボディを **ストリームのままディスクへ書く**。

```ts
import { Hono } from "hono";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const app = new Hono();

app.post("/api/upload", async (c) => {
  const dest = safeResolve(c.req.query("path") ?? "");
  const body = c.req.raw.body; // Web ReadableStream
  if (!body) return c.json({ error: "no body" }, 400);

  // Web Stream → Node Stream に変換してそのまま書き込む
  await pipeline(Readable.fromWeb(body as any), createWriteStream(dest));
  return c.json({ ok: true });
});
```

※ multipart で送る設計にする場合は `busboy` 等のストリーミングパーサを使い、
同様にファイル部分を `createWriteStream` へ pipe する。将来的に数十GB や再開を扱うなら **tus** を検討。

**(C) 権限を Samba と揃える**
プロセスを `nas` グループ ＋ `umask 0002` で起動（→ 7. デプロイ参照）。

**(D) ダウンロードもストリーミング**
`fs.createReadStream` を使い、`Content-Disposition` と `Content-Type` を付与して返す。

---

## 5. フロントエンド（React）

### 5.1 スタック

- **UI ライブラリ: shadcn/ui**（https://ui.shadcn.com/）
  - コンポーネントを npm 依存として入れるのではなく、CLI でソースを自プロジェクトにコピーして使う「Open Code」方式。生成されたコンポーネントは自由に編集できる
  - **前提: Tailwind CSS が必須**（shadcn/ui は Tailwind + Radix UI ベース）。加えて `lucide-react`（アイコン）を利用
  - 初期化: `npx shadcn@latest init` → 必要コンポーネントを `npx shadcn@latest add button dialog ...` で追加
- ビルド成果物を Hono から静的配信、または別ポートで開発

### 5.2 画面 / 機能（＋ 使用する shadcn/ui コンポーネントの目安）

- ファイル/フォルダ一覧（パンくずナビ、ソート）… `Table` / `Breadcrumb` / `Button`
- アップロード（ドラッグ&ドロップ、**進捗表示**）… `Card` の中にドロップ領域 ＋ `Progress`
- ダウンロード、フォルダ作成、リネーム、削除 … `DropdownMenu`（行アクション）／ `Dialog`・`Input`（作成・リネーム）／ `AlertDialog`（削除確認）
- 通知・エラー表示 … `Sonner`（トースト）
- 進捗表示は `XMLHttpRequest` の `upload.onprogress`、または fetch + ストリームで実装し、値を `Progress` に反映

### 5.3 割り切り（初版）

- 単一管理ユーザーで開始。複数ユーザー権限・共有リンク・プレビューは後回し
- まず「置ける・取れる・消せる」を最短で成立させる

---

## 6. プロジェクト構成（モノレポ ／ features 構成）

**実装済み。** 現状の構成はリポジトリ実体、構成ルールは `.claude/rules/features.md`、設計経緯は `docs/superpowers/specs/2026-07-02-nas-fm-monorepo-restructure-design.md` を参照。

---

## 7. デプロイ（systemd 常駐）

`/etc/systemd/system/nas-fm.service`

```ini
[Unit]
Description=Self-hosted NAS File Manager (React + Hono)
After=network.target

[Service]
User=<あなたのユーザー名>
Group=nas
UMask=0002
WorkingDirectory=/opt/nas-fm
ExecStart=/usr/bin/node /opt/nas-fm/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nas-fm
sudo systemctl status nas-fm --no-pager
```

- `User=` は共有に書き込めるユーザー、`Group=` は Samba の書き込みグループに一致させる
- `UMask=0002` は権限統一のため必須
- `--address 0.0.0.0`（Hono 側の listen 設定）で LAN の他デバイスからアクセス可
- ポートは他サービス（OMV / 既存の 8080 等）と重複しないよう決める

---

## 8. アクセス範囲の方針（LAN 内のみ ／ Tailscale は後付け）

**現段階の方針: LAN 内のみで運用する。** 外部公開はしない。

- 家の中から `http://<PiのIP>:8080` でのみアクセスする
- インターネットにポートを開けない（DDNS・ポート開放は行わない）
- 開発中も外部に一切露出しないため、安心して作り込める

### あとで Tailscale を足せるように（今やっておくこと）

外から使いたくなったら **Tailscale を「追加するだけ」で対応できる**。アプリのコードや構成は変更不要。そのための準備は次の1点のみ。

- **Hono の listen を `0.0.0.0`** にしておく（全インターフェイスで待ち受け）
  - こうすると LAN 経由でも Tailscale IP 経由でも同じポートで届く
  - `127.0.0.1` 固定だと「LAN では見えるが Tailscale 経由で届かない」となるので注意

### 将来 Tailscale を足すときの手順（参考・今は不要）

```bash
# Pi 側
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

1. 外から使う Mac / iPhone にも Tailscale を入れ、同じアカウントでログイン
2. 外出先から `http://<PiのTailscale名>:8080`（例 `http://pi5:8080`）でアクセス
3. LAN 内アクセス（`http://<PiのIP>:8080`）は Tailscale 導入後も**そのまま維持**される（家では従来どおり／外では Tailscale と自然に併用）

> Tailscale はポートを開けない方式のため、足しても攻撃面は増えない。
> 「LAN 内で作り切ってから外部到達を最後に足す」順序はセキュリティ的にも正しい。

---

## 9. トラブルシューティング（詰まりどころ）

| 症状                                             | 主な原因                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| サービスがすぐ落ちる                             | `ROOT` パス誤り / そのユーザーに共有への書き込み権が無い         |
| 他デバイスから繋がらない                         | listen が `127.0.0.1` のまま / ポート重複                        |
| アップロードは可だが Finder で編集・削除できない | `UMask=0002` と `Group=nas` の設定漏れ（権限ズレ）               |
| 大きいファイルで落ちる                           | アップロードがメモリバッファ実装になっている（ストリーム化する） |
| 共有外にアクセスされる                           | パストラバーサル検証が無い／不十分                               |

---

## 10. プレビュー機能（画像 / 動画 / テキスト）

プレビューは「①サーバがファイルを正しく配信する土台」＋「②型ごとの表示」の2層で構成する。本体は①。

### 10.1 共通の土台（バックエンド）

すべての型で必要になる基盤。

- **インライン配信エンドポイント**: ダウンロード（`Content-Disposition: attachment`）とは別に、ブラウザに描画させる `inline` 用エンドポイントを用意。**正しい MIME タイプ**を付与する（`mime-types` パッケージで拡張子→Content-Type を判定）。パストラバーサル検証・認証は従来どおり通す。
- **HTTP Range 対応（動画で必須）**: `Range` ヘッダを解釈し `206 Partial Content` を返す。実装は `fs.createReadStream(path, { start, end })` の部分読み。**これが無いと動画のシークができず、再生が始まらないブラウザもある**。画像・テキストでも大きいファイルで有効。
  - Hono の `serve-static` でも Range は扱えるが、認証・パス検証を各リクエストで挟むため**自前エンドポイントで Range を実装**するほうが素直。
- **セキュリティ**: 任意ファイルの inline 配信は HTML/SVG を同一オリジンで開くと XSS になり得る。`X-Content-Type-Options: nosniff` を付与し、inline は既知の安全な型に限定、SVG はテキスト扱い or CSP を効かせる。

### 10.2 型ごとに必要なもの

**画像**

- 土台のみで `<img src={previewUrl}>` で表示可（jpg/png/webp/gif）。
- 注意: **HEIC（iPhone 写真）**は多くのブラウザが非対応。対応するなら `sharp`（libheif）でサーバ変換が必要だが 4GB 機には重いため、初版は「HEIC は DL のみ」で割り切る。
- 一覧サムネイルが欲しくなったら `sharp` で生成＋キャッシュ（拡張時）。

**動画**

- **Range 対応が前提**。`<video controls>` にストリーミング URL を渡すだけ。
- コーデックは**再生側（Mac/iPhone のブラウザ）でデコードされ、Pi はバイトを流すだけ**。mp4/H.264（端末により HEVC）はそのまま再生可能。
- mkv/avi や特殊コーデックはブラウザが再生できないことがある。**Pi 上での ffmpeg トランスコードは非常に重いので行わず、「再生できない形式は DL に誘導」**する。

**テキスト**

- `text/plain` で返し `<pre>` に表示。コードは**シンタックスハイライト**（Shiki / highlight.js / Prism）を併用。
- 注意: **文字コード**は UTF-8 前提（非 UTF-8 は割り切り or 判定）。**サイズ制限**として、巨大ファイルは**先頭 N KB だけ取得**（Range または `?limit=` でサーバ側で切る）。ブラウザに全読み込みさせない。

### 10.3 フロント側の共通部品

- プレビュー用の**モーダル（shadcn/ui の `Dialog`）**または横パネル。開いたときだけ URL を取得（遅延ロード）。
- MIME/拡張子で「画像／動画／テキスト／非対応」を振り分け、**非対応は「プレビューできません・ダウンロード」フォールバック**を必ず出す。この対応判定＋fallback を最初に作る。

### 10.4 新規に必要なもの / 避けるもの（まとめ）

- **必要**: Range 対応つき inline 配信エンドポイント、`mime-types`、（テキスト用）ハイライトライブラリ、（任意）HEIC/サムネ用 `sharp`。
- **避ける**: Pi 上での動画トランスコード（重すぎる）。
