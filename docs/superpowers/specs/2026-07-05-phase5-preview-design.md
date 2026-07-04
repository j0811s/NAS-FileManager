# Phase 5: プレビュー機能 設計

- 日付: 2026-07-05
- 対象: 画像・動画・テキストのインラインプレビュー(`docs/spec.md` §10、`docs/roadmap.md` Phase 5)
- 前提: Phase 1〜4(ファイル操作 API・UI・認証・本番配信基盤)は完成済み

## 1. スコープ判断

サーバの配信土台と web の表示 UI は片方だけでは成果物にならない(Phase 2 認証と同様の性質)ため、1つの spec/plan にまとめる。バックエンド/フロントエンドで phase を分割しない。

## 2. アーキテクチャ概要

プレビューは「①サーバがファイルを正しく配信する土台」+「②型ごとの表示」の2層(spec §10 の原則どおり)。**拡張子ベースの型判定ロジックを `packages/shared` に置き**、サーバ(セキュリティ許可判定)と web(表示コンポーネント振り分け)の両方が同じ関数を参照することでロジックの乖離を防ぐ。

```ts
// packages/shared/src/preview.ts
export type PreviewKind = "image" | "video" | "text";
export function classifyPreview(filename: string): PreviewKind | null
```

- **image**: `.jpg` `.jpeg` `.png` `.webp` `.gif`(HEIC は対象外 → `null`)
- **video**: `.mp4` `.webm` `.ogv` `.ogg`(mkv/avi 等は対象外 → `null`)
- **text**: `.txt` `.md` `.json` `.yaml` `.yml` `.toml` `.ini` `.conf` `.log` `.csv` `.xml` `.html` `.htm` `.svg` `.css` `.js` `.jsx` `.ts` `.tsx` `.py` `.rb` `.go` `.rs` `.java` `.c` `.h` `.cpp` `.hpp` `.sh` `.sql` など一般的なテキスト/コード拡張子。**`.svg` もここに含め、画像としてではなくテキストとして扱う**(spec §10.1 が挙げる「SVG はテキスト扱い」の選択を採用。`.html` も同様に実行させずテキスト表示する)
- 上記いずれにも該当しない(拡張子なし・`.zip`・`.pdf` 等)→ `null`(非対応)

## 3. サーバ側: `GET /api/preview?path=`

`apps/server/src/features/files/files.routes.ts` に新規ルートを追加(既存の `/list` `/upload` `/download` `/mkdir` `/rename` `/delete` と同じファイル・同じ `/api` マウントのため、既存の `requireAuth` ガードが自動的にかかる)。

### 3.1 型判定とセキュリティ

- `classifyPreview(name)`(`@nas-fm/shared`)で許可判定。`null` なら `AppError("INVALID_REQUEST", ...)` → 400
- **image/video**: `mime-types` パッケージ(新規依存。spec §10.1 が明示的に指定)の `lookup(name)` で実際の Content-Type を判定して付与(例: `image/jpeg`)
- **text**: 判定結果に関わらず**常に `Content-Type: text/plain; charset=utf-8` を強制**する。ファイルの「本来の」MIME(`.html` → `text/html` 等)は絶対に使わない。これにより `.html`/`.svg` 等をブラウザに解釈・実行させることを防ぐ(XSS 対策。spec §10.1 の要求そのもの)
- 全レスポンス(200・206・416 すべて)に `X-Content-Type-Options: nosniff` を付与
- `Content-Disposition: inline`(ダウンロードの `attachment` と対比。spec §10.1 の記述に対応)

### 3.2 Range 対応(共通実装、型を問わず同じロジック)

- `Range: bytes=start-end` または `bytes=start-` を解析し、`fs.createReadStream(abs, { start, end })` で部分読みして返す
  - 妥当なリクエスト → `206 Partial Content` + `Content-Range: bytes start-end/size` + `Content-Length: end-start+1`
  - 不正・範囲外(`start >= size` 等) → `416 Range Not Satisfiable` + `Content-Range: bytes */size`
  - 複数レンジ(`bytes=0-99,200-299` のようにカンマを含む)は**非対応と割り切り**、全体を `200` で返す(HTTP 仕様上サーバが Range を無視して全体を返すことは許容されている。マルチパート応答の実装コストを避ける)
- `Range` ヘッダ無し → 全体を `200` で返す。`Accept-Ranges: bytes` は常に付与(ブラウザに Range 対応を広告し、動画のシークを可能にする)

### 3.3 テキストのサイズ制限(専用実装を足さない)

spec §10.2 は「巨大ファイルは先頭 N KB だけ取得(Range または `?limit=` でサーバ側で切る)」と要求している。**新しいクエリパラメータやサーバ側の特別分岐は作らず、上記の Range 機構をそのまま再利用する**: web 側のテキストプレビューが明示的に `Range: bytes=0-262143`(256KiB)を送ることで実現する。サーバは「Range が来たら従う」という一般ロジックのままでよく、`206` が返れば web 側は「先頭のみ表示中」と判断できる(このアプリの自作クライアントが送るリクエストであり、悪意のある第三者 API クライアントを想定した防御ではない — 単一ユーザー・LAN 内という前提に基づく判断)。

## 4. web 側

新規 feature は作らず、既存の `file-list` feature に追加する(行アクションの一部という位置づけ)。

- `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx`(新規): `classifyPreview(entry.name)` で振り分け、以下のいずれかを表示。**Dialog が開いたときだけ URL を組み立てる**(遅延ロード。事前フェッチしない)
  - `ImagePreview`: `<img src={api.previewUrl(path)} />`
  - `VideoPreview`: `<video controls src={api.previewUrl(path)} />`
  - `TextPreview`: `Range: bytes=0-262143` 付きで fetch。highlight.js で自動言語判定してハイライト表示。レスポンスが `206` なら「先頭256KBのみ表示しています」バナーを出す
  - `UnsupportedPreview`: 「プレビューできません」+ ダウンロードボタン(**必須のフォールバック**。spec §10.3)
- **起動導線**: ファイル名クリック(ディレクトリ名クリックで移動できるのと対称的な UX)と、RowActions ドロップダウンの「プレビュー」項目の**両方**から開けるようにする
- `apps/web/src/lib/api.ts` に `previewUrl(path: string): string` を追加(既存の `downloadUrl` と対称的な実装)

## 5. 新規依存

| パッケージ | ワークスペース | 用途 |
|---|---|---|
| `mime-types` | `@nas-fm/server` | image/video の実 Content-Type 判定(spec §10.1 で明示指定) |
| `@types/mime-types` | `@nas-fm/server`(devDependency) | 型定義 |
| `highlight.js` | `@nas-fm/web` | テキストプレビューのシンタックスハイライト(自動言語判定、追加設定不要) |

いずれもバージョン無指定でインストールし `.npmrc` の save-exact/min-release-age に従う。

## 6. テスト方針

- **サーバ**: `classifyPreview` を通した許可/非許可拡張子ごとの応答(image/video は実 MIME、text は常に `text/plain`、非対応は400)、Range あり(206・正しいバイト範囲・`Content-Range`)/なし(200・全体)/不正(416)、`X-Content-Type-Options: nosniff` の付与、複数レンジ指定時に全体を返す挙動、既存の認証(Cookie 無しで401)・パストラバーサル検証が維持されること
- **shared**: `classifyPreview` の全カテゴリ(image・video・text・null)を拡張子ごとに検証
- **web**: `PreviewDialog` の型振り分け(image/video/text/unsupported の4分岐)、`UnsupportedPreview` のダウンロードフォールバック表示、`TextPreview` の206時のバナー表示、`FileTable` のファイル名クリックと `RowActions` の「プレビュー」項目の両方から起動できること

## 7. 非ゴール(spec §10.4 通りの割り切り)

- HEIC はプレビュー非対応(ダウンロードのみに誘導。`sharp`/libheif によるサーバ変換は行わない)
- Pi 上での動画トランスコードは行わない(mkv/avi 等の再生不可な形式はダウンロードに誘導するのみで、サーバ側の変換処理は実装しない)
- 拡張子なしファイル(`README`・`Makefile` 等)のテキストプレビューは対象外(拡張子ベース判定のみを行い、ファイル名の特別扱いはしない)
- 一覧サムネイル生成(`sharp` によるキャッシュ付き生成)は将来拡張であり、今回は対象外
