# フォルダごとの zip ダウンロード 設計

日付: 2026-07-09
ステータス: 承認待ち

## 目的

現在 `GET /api/download?path=` はファイル専用で、フォルダを指定すると `IS_A_DIRECTORY` エラーになる。フォルダ配下をまとめてダウンロードする手段がないため、フォルダを渡された場合は zip ストリームとして返せるようにする。

## 方針（決定事項）

- 対象は**フォルダ単位のみ**。複数ファイルの選択ダウンロード（マルチセレクト）は現状未実装のため対象外
- 圧縮方式は**無圧縮（store）**。Pi の CPU を使わず高速。写真・動画中心の NAS では圧縮してもサイズがほぼ縮まらず、LAN 内転送のため速度優先
- 走査中の**シンボリックリンクはスキップ**（`safeResolve` による NAS_ROOT 外アクセス防止の方針と一貫）
- 新しいエンドポイントは作らず、**既存 `GET /api/download?path=` を拡張**する（対象がフォルダなら zip、ファイルなら従来通り）。フロントの `RowActions` も「ダウンロード」メニューの表示条件からファイル限定を外すだけで済み、UI 上は「ダウンロード」という単一の概念のまま自然に振る舞いが変わる
- `path=""`（NAS_ROOT 直下全体）の指定も許可する。ダウンロードは読み取り専用操作であり、`removePath`/`renamePath` のような破壊的操作に対する root 禁止ガードは不要。NAS 全体のバックアップ用途として自然な挙動とする
- 走査中に個別ファイルが消えた・読めなくなった場合は**そのファイルだけスキップして続行**する（`listDir` が「列挙後に消えたエントリはスキップ」する既存の流儀に合わせる）。fatal なエラー（zip 生成自体の失敗等）のみストリームを中断する
- 巨大フォルダに対するタイムアウト・プロセス保護は初版のスコープ外とする（store 方式は I/O 律速で軽く、Pi 5 で問題が顕在化すれば別途対応）

## スコープ外

- 複数ファイル・複数フォルダの一括選択ダウンロード（マルチセレクトUI自体が未実装）
- zip 内の圧縮方式の切り替え（deflate 等）
- 巨大フォルダへのサイズ上限・タイムアウト

## 設計

### サーバー: `files.service.ts` に追加（新規 feature は作らない）

ダウンロードの一種であり、既存の `files` feature の範囲内で完結するため、新規 feature ディレクトリは作らない。

**`resolveDownloadEntry(root: string, relPath: string)`**（新規）

```ts
export async function resolveDownloadEntry(
  root: string,
  relPath: string,
): Promise<
  | { abs: string; name: string; kind: "file"; size: number }
  | { abs: string; name: string; kind: "dir" }
>
```

既存の `statForDownload` はディレクトリを渡すと `IS_A_DIRECTORY` を投げる仕様で、これは `/preview` エンドポイントも共有して使っているため変更できない（プレビューはディレクトリを拒否し続ける必要がある）。ダウンロード専用の新関数として分離する。

- `safeResolve(root, relPath)` でパス検証（既存パターン踏襲）
- `fs.stat` で存在確認（無ければ `NOT_FOUND`）
- ディレクトリなら `{ abs, name: path.basename(abs), kind: "dir" }`
- ファイルなら `{ abs, name: path.basename(abs), kind: "file", size: st.size }`
- `path=""`（NAS_ROOT 直下）の場合、`name` は `NAS_ROOT` ディレクトリ自体のベース名になる（例: `NAS_ROOT=/srv/nas/share` なら zip ファイル名は `share.zip`）。これは決定的だが読み手が驚かないよう明示しておく

**`createFolderZipStream(absDir: string): Archiver`**（新規）

```ts
export function createFolderZipStream(absDir: string): Archiver {
  const archive = archiver("zip", { store: true });
  archive.on("warning", (err) => {
    if (err.code !== "ENOENT") archive.destroy(err);
    // ENOENT（走査中に消えたファイル）は無視して続行
  });
  void walkAndAppend(archive, absDir, "").then(
    () => archive.finalize(),
    (err) => archive.destroy(err),
  );
  return archive;
}

async function walkAndAppend(archive: Archiver, absDir: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absPath = path.join(absDir, entry.name);
    const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkAndAppend(archive, absPath, zipPath);
    } else if (entry.isFile()) {
      archive.file(absPath, { name: zipPath });
    }
  }
}
```

- 走査は非同期でバックグラウンド実行しつつ、`archive`（Readable）を即座に返す。呼び出し側はすぐ `pipe`/`Readable.toWeb` できる
- 全走査完了後に `finalize()` を呼び、zip の中央ディレクトリを書き込んで完了させる
- 空フォルダは有効な空zipになる（特別扱い不要）

### ルート (`files.routes.ts`) の変更

`GET /download` を変更:

```ts
app.get("/download", async (c) => {
  const rel = requirePath(c.req.query("path"));
  const target = await resolveDownloadEntry(root, rel);

  if (target.kind === "dir") {
    const archive = createFolderZipStream(target.abs);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", contentDisposition(`${target.name}.zip`));
    return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
  }

  c.header("Content-Type", "application/octet-stream");
  c.header("Content-Length", String(target.size));
  c.header("Content-Disposition", contentDisposition(target.name));
  return c.body(Readable.toWeb(createReadStream(target.abs)) as unknown as ReadableStream);
});
```

- zip 応答には `Content-Length` を付けない（完了までサイズ不明のため）。ブラウザ・Hono/undici は chunked transfer encoding を自動で使う
- 認証は既存の `/api/*` ガードでそのままカバーされる

### フロントエンド: `RowActions.tsx`

現在 `entry.type === "file"` の条件で囲まれている「ダウンロード」メニュー項目から、この条件を外す（フォルダでも表示）。`api.downloadUrl(rel)` はそのまま流用し、新しい API メソッドは追加しない。`<a href={...} download>` は Content-Type によらず保存ダイアログを出すため、フロント側は対象がファイルかフォルダか意識する必要がない。

### 依存関係

- `archiver`（zip ストリーミング生成、store 圧縮対応）— `apps/server` の dependencies に追加
- `@types/archiver`（型定義）— `apps/server` の devDependencies に追加
- `adm-zip`（生成された zip を読み戻して検証する**テスト専用**）— `apps/server` の devDependencies に追加

いずれも `npm install <pkg> [-D] -w @nas-fm/server`（バージョン無指定）で追加する。

## テスト（Vitest）

- `files.service.test.ts`（追記）
  - `resolveDownloadEntry`: ファイル/ディレクトリ/存在しない/パストラバーサルの分岐
  - `createFolderZipStream`: 実 fs（`mkdtemp`）+ 実 `archiver` で生成し、`adm-zip` で読み戻して検証
    - ネストしたフォルダ構造がzip内のパス階層に正しく反映される
    - 空フォルダは有効な空zipになる
    - シンボリックリンクはzipに含まれない
    - 走査中に削除されたファイルはスキップされ、他のファイルは正常に含まれる（zip全体は壊れない）
- `files.routes.test.ts`（追記）
  - `GET /api/download?path=<folder>` が `Content-Type: application/zip` を返し、レスポンスボディが有効な zip として読み戻せる
  - `GET /api/download?path=<file>` は従来通りファイルそのものを返す（回帰確認）
  - 未認証は401（既存ガードの回帰確認）
  - パストラバーサル・存在しないパスのエラーコード

## 影響範囲

- 変更: `apps/server/src/features/files/files.service.ts`（`resolveDownloadEntry` / `createFolderZipStream` 追加）
- 変更: `apps/server/src/features/files/files.routes.ts`（`/download` の分岐追加）
- 変更: `apps/web/src/features/file-list/components/RowActions.tsx`（ダウンロードのファイル限定条件を削除）
- 依存追加: `archiver` / `@types/archiver` / `adm-zip`（すべて `@nas-fm/server`）
- 新規 feature ディレクトリ: なし
