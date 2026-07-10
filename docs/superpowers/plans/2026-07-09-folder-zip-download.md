# フォルダごとの zip ダウンロード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/download?path=` にフォルダパスを渡した場合、配下を無圧縮zipとしてストリーミング返却できるようにする。

**Architecture:** `files.service.ts` に `resolveDownloadEntry`（ファイル/フォルダ判定）と `createFolderZipStream`（`archiver` による再帰zipストリーム生成）を追加し、`files.routes.ts` の `/download` ハンドラで種別に応じて分岐する。フロントは `RowActions` の「ダウンロード」表示条件からファイル限定を外すのみ。

**Tech Stack:** Hono / Node `child_process`不要（`archiver` はnpmライブラリ）/ `node:fs/promises` / Vitest。新規npm依存: `archiver`（本番）、`@types/archiver` / `adm-zip`（開発・テスト用）。

スペック: `docs/superpowers/specs/2026-07-09-folder-zip-download-design.md`

## Global Constraints

- Node `>=24.18.0`。依存は `npm install <pkg> [-D] -w @nas-fm/server`（バージョン無指定）で追加する
- `verbatimModuleSyntax: true` — 型のみの import は必ず `import type`
- feature間の直接import禁止。今回は既存の `files` feature 内で完結（新規featureは作らない）
- フォーマット/リントは oxfmt / oxlint（pre-commitで自動実行）
- コミットは Conventional Commits（接頭辞は英語、本文は日本語）
- テスト実行: `npm run test -w @nas-fm/server -- <file>`

---

### Task 1: `resolveDownloadEntry`（ファイル/フォルダ判定）

**Files:**
- Modify: `apps/server/src/features/files/files.service.ts`
- Test: `apps/server/src/features/files/files.service.test.ts`

**Interfaces:**
- Consumes: `safeResolve`（`lib/safe-resolve`）、`AppError`（`lib/errors`）
- Produces: `resolveDownloadEntry(root: string, relPath: string): Promise<{ abs: string; name: string; kind: "file"; size: number } | { abs: string; name: string; kind: "dir" }>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/files/files.service.test.ts` の import に `resolveDownloadEntry` を追加し、`describe("statForDownload", ...)` の直後に新しい describe を追加:

```ts
describe("resolveDownloadEntry", () => {
  it("ファイルは kind: file とサイズを返す", async () => {
    await writeFile(path.join(root, "dl.txt"), "hello");
    const info = await resolveDownloadEntry(root, "dl.txt");
    expect(info).toEqual({
      abs: path.join(root, "dl.txt"),
      name: "dl.txt",
      kind: "file",
      size: 5,
    });
  });

  it("ディレクトリは kind: dir を返す（size は含まない）", async () => {
    await mkdir(path.join(root, "sub"));
    const info = await resolveDownloadEntry(root, "sub");
    expect(info).toEqual({ abs: path.join(root, "sub"), name: "sub", kind: "dir" });
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(resolveDownloadEntry(root, "missing"), "NOT_FOUND");
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    await expectAppError(resolveDownloadEntry(root, "../evil"), "PATH_TRAVERSAL");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.service.test.ts`
Expected: FAIL（`resolveDownloadEntry` が存在しない）

- [ ] **Step 3: 実装する**

`apps/server/src/features/files/files.service.ts` に追加（`statForDownload` の直後）:

```ts
export async function resolveDownloadEntry(
  root: string,
  relPath: string,
): Promise<
  | { abs: string; name: string; kind: "file"; size: number }
  | { abs: string; name: string; kind: "dir" }
> {
  const abs = safeResolve(root, relPath);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  if (st.isDirectory()) {
    return { abs, name: path.basename(abs), kind: "dir" };
  }
  return { abs, name: path.basename(abs), kind: "file", size: st.size };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.service.test.ts`
Expected: PASS（既存テスト含む全件）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/files/files.service.ts apps/server/src/features/files/files.service.test.ts
git commit -m "feat: ダウンロード対象がファイルかフォルダかを判定するresolveDownloadEntryを追加"
```

---

### Task 2: `createFolderZipStream`（再帰zipストリーム生成）

**Files:**
- Modify: `apps/server/src/features/files/files.service.ts`
- Test: `apps/server/src/features/files/files.service.test.ts`

**Interfaces:**
- Consumes: なし（Task 1とは独立）
- Produces: `createFolderZipStream(absDir: string): Archiver`（`Archiver` は `archiver` パッケージの型、Node `Readable` として消費可能）

- [ ] **Step 1: 依存パッケージを追加する**

```bash
npm install archiver -w @nas-fm/server
npm install -D @types/archiver adm-zip -w @nas-fm/server
```

`@types/adm-zip` が無い場合は `adm-zip` に同梱の型を使う（無ければ後続ステップで型エラーが出た時点で `@types/adm-zip` も追加する）。

- [ ] **Step 2: 失敗するテストを書く**

`apps/server/src/features/files/files.service.test.ts` の先頭 import に追加:

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { createFolderZipStream, resolveDownloadEntry /* ...既存import */ } from "./files.service";
```

（`createReadStream` は既存importに無ければ追加。`readdir`, `readFile` 等の既存importは維持）

ファイル末尾（`describe("resolveDownloadEntry", ...)` の後）に追加:

```ts
async function zipToEntries(archive: NodeJS.ReadableStream, outPath: string): Promise<string[]> {
  await pipeline(archive, createWriteStream(outPath));
  const zip = new AdmZip(outPath);
  return zip.getEntries().map((e) => e.entryName);
}

describe("createFolderZipStream", () => {
  it("フラットなフォルダの中身をzipエントリとして含む", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "a.txt"), "a");
    await writeFile(path.join(dir, "b.txt"), "b");
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out1.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("ネストしたフォルダ構造をzip内のパス階層に反映する", async () => {
    const dir = path.join(root, "folder");
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(path.join(dir, "top.txt"), "top");
    await writeFile(path.join(dir, "sub", "nested.txt"), "nested");
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out2.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["sub/nested.txt", "top.txt"]);
  });

  it("空フォルダは有効な空zipになる", async () => {
    const dir = path.join(root, "empty");
    await mkdir(dir);
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out3.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual([]);
  });

  it("シンボリックリンクはzipに含まれない", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "real.txt"), "real");
    await fs.symlink(path.join(dir, "real.txt"), path.join(dir, "link.txt"));
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out4.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["real.txt"]);
  });

  it("走査中に消えたファイルはスキップし、残りは正常に含まれる", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "gone.txt"), "gone");
    await writeFile(path.join(dir, "keep.txt"), "keep");
    const archive = createFolderZipStream(dir);
    // ストリームの消費（読み取り）が始まる前に削除する。archiver は
    // archive.file() 呼び出し時点では stat/read しない（消費時に遅延実行される）ため、
    // ここで削除すれば「走査後に消えたファイル」を確実に再現できる。
    await fs.rm(path.join(dir, "gone.txt"));
    const zipPath = path.join(root, "out5.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["keep.txt"]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.service.test.ts`
Expected: FAIL（`createFolderZipStream` が存在しない）

- [ ] **Step 4: 実装する**

`apps/server/src/features/files/files.service.ts` の先頭 import に追加:

```ts
import archiver, { type Archiver } from "archiver";
```

ファイル末尾（`resolveDownloadEntry` の後）に追加:

```ts
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

/** フォルダ配下を無圧縮zipとしてストリーミング生成する。走査は非同期でバックグラウンド実行し、Readable を即座に返す。 */
export function createFolderZipStream(absDir: string): Archiver {
  const archive = archiver("zip", { store: true });
  archive.on("warning", (err) => {
    // 走査後に消えたファイル等（ENOENT）は無視して続行。それ以外は fatal として扱う。
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      archive.destroy(err);
    }
  });
  void walkAndAppend(archive, absDir, "").then(
    () => archive.finalize(),
    (err) => archive.destroy(err),
  );
  return archive;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.service.test.ts`
Expected: PASS（6テスト追加、既存分含め全件）

- [ ] **Step 6: コミット**

```bash
git add apps/server/package.json package-lock.json apps/server/src/features/files/files.service.ts apps/server/src/features/files/files.service.test.ts
git commit -m "feat: フォルダを無圧縮zipでストリーミング生成するcreateFolderZipStreamを追加"
```

（`package-lock.json` はワークスペースルート直下に1つだけ存在する。`apps/server/package-lock.json` は無い）

---

### Task 3: `/download` ルートの分岐配線

**Files:**
- Modify: `apps/server/src/features/files/files.routes.ts`
- Test: `apps/server/src/features/files/files.routes.test.ts`

**Interfaces:**
- Consumes: `resolveDownloadEntry` / `createFolderZipStream`（Task 1, 2）
- Produces: `GET /api/download?path=<folder>` が `Content-Type: application/zip` で有効なzipを返す。`GET /api/download?path=<file>` は従来通り

- [ ] **Step 1: 既存テストを更新し、失敗するテストを追加する**

`apps/server/src/features/files/files.routes.test.ts` の `describe("GET /api/download", ...)` 内、以下のテストを**削除**:

```ts
  it("ディレクトリ指定は 400", async () => {
    await mkdir(path.join(root, "sub"));
    const app = createApp(root, authConfig);
    const res = await app.request("/api/download?path=sub", withAuth());
    expect(res.status).toBe(400);
  });
```

同じ describe 内に以下を**追加**（ファイルの先頭 import に `AdmZip` と `pipeline`/`createWriteStream` を追加する必要がある。無ければ追加）:

```ts
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
```

```ts
  it("ディレクトリ指定は zip としてストリーミング返却する", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "a.txt"), "hello");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/download?path=sub", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("sub.zip")}`,
    );
    const zipPath = path.join(root, "downloaded.zip");
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
    const zip = new AdmZip(zipPath);
    expect(zip.getEntries().map((e) => e.entryName)).toEqual(["a.txt"]);
  });

  it("未認証は 401（フォルダ指定でも変わらない）", async () => {
    await mkdir(path.join(root, "sub"));
    const app = createApp(root, authConfig);
    const res = await app.request("/api/download?path=sub");
    expect(res.status).toBe(401);
  });
```

`files.routes.test.ts` の先頭 import に `Readable` が無ければ追加（`node:stream`）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.routes.test.ts`
Expected: FAIL（フォルダ指定がまだ400を返す）

- [ ] **Step 3: 実装する**

`apps/server/src/features/files/files.routes.ts` の import を変更:

```ts
import {
  createFolderZipStream,
  listDir,
  makeDir,
  removePath,
  renamePath,
  resolveDownloadEntry,
  uploadFile,
} from "./files.service";
```

（`statForDownload` は `/preview` エンドポイントがまだ使うため import から削除しない）

`app.get("/download", ...)` を置き換え:

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

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/files/files.routes.test.ts`
Expected: PASS

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全件、回帰なし）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/files/files.routes.ts apps/server/src/features/files/files.routes.test.ts
git commit -m "feat: GET /api/downloadでフォルダ指定時にzipストリーミングを返すよう分岐"
```

---

### Task 4: フロントエンド — `RowActions` のダウンロード表示条件を変更

**Files:**
- Modify: `apps/web/src/features/file-list/components/RowActions.tsx`
- Test: `apps/web/src/features/file-list/components/RowActions.test.tsx`

**Interfaces:**
- Consumes: `api.downloadUrl`（変更なし、既存のまま）
- Produces: フォルダの操作メニューにも「ダウンロード」項目が表示される

- [ ] **Step 1: 既存テストを更新する**

`apps/web/src/features/file-list/components/RowActions.test.tsx` の以下のテストを**削除**:

```ts
  it("ディレクトリにはダウンロードリンクを出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions
        entry={dir}
        path=""
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(await screen.findByRole("menuitem", { name: /名前を変更/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /ダウンロード/ })).toBeNull();
  });
```

同じ場所に以下を**追加**:

```ts
  it("ディレクトリにもダウンロードリンク（zip、正しい href）を出す", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions
        entry={dir}
        path=""
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    const link = await screen.findByRole("menuitem", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("sub")}`);
    expect(link).toHaveAttribute("download");
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- src/features/file-list/components/RowActions.test.tsx`
Expected: FAIL（ディレクトリにダウンロードリンクがまだ出ない）

- [ ] **Step 3: 実装する**

`apps/web/src/features/file-list/components/RowActions.tsx` の以下の箇所を変更:

```tsx
        {entry.type === "file" && (
          <DropdownMenuItem asChild>
            <a href={api.downloadUrl(rel)} download>
              <Download size={16} className="mr-2" />
              ダウンロード
            </a>
          </DropdownMenuItem>
        )}
```

を、条件を外して以下に変更:

```tsx
        <DropdownMenuItem asChild>
          <a href={api.downloadUrl(rel)} download>
            <Download size={16} className="mr-2" />
            ダウンロード
          </a>
        </DropdownMenuItem>
```

（プレビュー項目 `{entry.type === "file" && (...)}` はファイル限定のまま変更しない）

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- src/features/file-list/components/RowActions.test.tsx`
Expected: PASS

Run: `npm run test -w @nas-fm/web`
Expected: PASS（全件、回帰なし）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/file-list/components/RowActions.tsx apps/web/src/features/file-list/components/RowActions.test.tsx
git commit -m "feat: フォルダの操作メニューにもダウンロード(zip)を表示"
```

---

### Task 5: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全ワークスペースの検証コマンド**

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Expected: エラーなし（`packages/shared` に既存の無関係な `.svg` テスト失敗が1件ある場合はこの機能の変更によるものではないため無視してよい。それ以外の失敗があってはならない）

- [ ] **Step 2: 実動作の確認**

1. `npm run dev` で起動し、ブラウザでログイン
2. 複数ファイルを含むフォルダを作成し、その操作メニューから「ダウンロード」をクリック
3. ダウンロードされた `<フォルダ名>.zip` を解凍し、中身のファイルとフォルダ階層が元と一致することを確認
4. 空フォルダでも同様にダウンロードでき、空のzipとして解凍できることを確認
5. 既存の単一ファイルダウンロードが引き続き正常に動作することを確認（回帰確認）

- [ ] **Step 3: 完了処理**

superpowers:finishing-a-development-branch スキルに従って完了判断する（main 直接運用のため、コミットのみで完結。push はユーザー判断）。
