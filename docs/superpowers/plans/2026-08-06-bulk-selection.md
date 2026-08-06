# 複数選択・一括操作（削除・ダウンロード）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `file-list` feature にチェックボックスによる複数選択と、一括削除（ゴミ箱移動）・一括ダウンロード（zip）を追加する。

**Architecture:** サーバに `POST /api/delete-bulk`（既存 `moveToTrash` をパスごとに実行し結果配列を返す）と `POST /api/download-bulk`（既存の zip 化ロジック `walkAndAppend` を汎用化した `createSelectionZipStream` でまとめて zip 配信）を新設する。クライアントは `FileBrowser` にローカル選択状態（`selectMode`/`selectedNames`）を持ち、「選択」ボタンで既存の上部アクション行を `BulkActionToolbar` に差し替える。`FileTable`/`FileGrid` はチェックボックスの表示とクリック挙動の切り替えのみ受け持つ。

**Tech Stack:** 既存スタックのみ（Hono, React, TanStack Query, radix-ui, archiver, adm-zip）。新規 npm 依存は追加しない。

## Global Constraints

- Node は 24.18.0 以上。新規依存はこのプランでは発生しない（既存の `radix-ui` / `archiver` / `adm-zip` を再利用する）
- TypeScript: `verbatimModuleSyntax: true`（型のみの import/export は `import type` / `export type`）、`noUnusedLocals: true`、`baseUrl` は使わない
- フォーマッタ/リンタは oxfmt / oxlint。pre-commit（husky + lint-staged）で oxfmt → oxlint --fix → typecheck が自動実行される
- feature 間の import は各 feature の `index.ts`（公開境界）経由のみ。ただし同一 feature 内（`file-list` 内の components/dialogs/hooks 間）は直接 import でよい（既存コードの実態に合わせる）
- shadcn/ui の生成物は `apps/web/src/components/ui/`（features には入れない）
- server は feature ごとに `<name>.routes.ts` / `<name>.service.ts` / `<name>.schema.ts` を維持する
- パストラバーサル対策（`safeResolve`）は新規エンドポイントでも必須。ダウンロード系はストリーミング必須（`docs/spec.md` §4.3 A/B/D）
- コミットは Conventional Commits。接頭辞は英語、本文は日本語
- `packages/shared/src/types.ts` の `ApiErrorCode` は `apps/server/src/lib/errors.ts` の `statusOf()` が exhaustive switch（no default）で consume している。新しいエラーコードをこのプランで追加する必要はない（既存コードで十分）

---

### Task 1: サーバ — 一括削除API（`POST /api/delete-bulk`）

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `apps/server/src/features/files/files.schema.ts`
- Modify: `apps/server/src/features/files/files.routes.ts`
- Test: `apps/server/src/features/files/files.routes.test.ts`

**Interfaces:**
- Consumes: 既存の `moveToTrash(root: string, relPath: string): Promise<void>`（`apps/server/src/features/trash/trash.service.ts`）、既存の `AppError`（`apps/server/src/lib/errors.ts`、`.code: ApiErrorCode`）
- Produces:
  - 型 `BulkPathsRequest { paths: string[] }`（`packages/shared/src/types.ts`。Task 2 の一括ダウンロードでも再利用する）
  - 型 `BulkDeleteResult { path: string; ok: boolean; errorCode?: ApiErrorCode }` / `BulkDeleteResponse { results: BulkDeleteResult[] }`
  - 関数 `parseBulkPathsBody(value: unknown): BulkPathsRequest`（`files.schema.ts`）
  - ルート `POST /api/delete-bulk`

- [ ] **Step 1: 共有型を追加する**

`packages/shared/src/types.ts` の末尾に追加:

```ts
export interface BulkPathsRequest {
  paths: string[];
}

export interface BulkDeleteResult {
  path: string;
  ok: boolean;
  errorCode?: ApiErrorCode;
}

export interface BulkDeleteResponse {
  results: BulkDeleteResult[];
}
```

- [ ] **Step 2: 失敗する統合テストを書く**

`apps/server/src/features/files/files.routes.test.ts` の `describe("DELETE /api/delete", ...)` ブロックの直後に追加:

```ts
describe("POST /api/delete-bulk", () => {
  it("複数パスを削除しゴミ箱に移動する", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "b.txt"), "b");
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/delete-bulk",
      withAuth({
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ["a.txt", "b.txt"] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { path: string; ok: boolean }[] };
    expect(body.results).toEqual([
      { path: "a.txt", ok: true },
      { path: "b.txt", ok: true },
    ]);
    const list = await app.request("/api/list?path=", withAuth());
    expect((await list.json()).entries).toEqual([]);
  });

  it("一部が存在しない場合はそのパスのみ ok:false errorCode:NOT_FOUND を返し、他は成功する", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/delete-bulk",
      withAuth({
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ["a.txt", "missing.txt"] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { path: string; ok: boolean; errorCode?: string }[] };
    expect(body.results).toEqual([
      { path: "a.txt", ok: true },
      { path: "missing.txt", ok: false, errorCode: "NOT_FOUND" },
    ]);
  });

  it("空配列は 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/delete-bulk",
      withAuth({ method: "POST", headers: jsonHeaders, body: JSON.stringify({ paths: [] }) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("paths が無い body は 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/delete-bulk",
      withAuth({ method: "POST", headers: jsonHeaders, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- files.routes`
Expected: FAIL（`/api/delete-bulk` が存在せず 404、または `paths` 未定義のエラー）

- [ ] **Step 4: `parseBulkPathsBody` を実装する**

`apps/server/src/features/files/files.schema.ts` の末尾に追加:

```ts
export function parseBulkPathsBody(value: unknown): BulkPathsRequest {
  if (
    !isRecord(value) ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    !value.paths.every((p) => typeof p === "string" && p !== "")
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { paths: string[] } (non-empty)");
  }
  return { paths: value.paths };
}
```

ファイル先頭の import を更新:

```ts
import type { BulkPathsRequest, MkdirRequest, RenameRequest } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
```

- [ ] **Step 5: ルートを実装する**

`apps/server/src/features/files/files.routes.ts` の import を更新:

```ts
import type { BulkDeleteResponse, BulkDeleteResult, ListResponse, OkResponse } from "@nas-fm/shared";
```

```ts
import {
  optionalPath,
  parseBulkPathsBody,
  parseMkdirBody,
  parseRenameBody,
  requirePath,
} from "./files.schema";
```

`app.delete("/delete", ...)` の直後（`return app;` の前）に追加:

```ts
  app.post("/delete-bulk", async (c) => {
    const { paths } = parseBulkPathsBody(await readJsonBody(() => c.req.json()));
    const results: BulkDeleteResult[] = [];
    for (const p of paths) {
      try {
        await moveToTrash(root, p);
        results.push({ path: p, ok: true });
      } catch (err) {
        results.push({
          path: p,
          ok: false,
          errorCode: err instanceof AppError ? err.code : "INTERNAL",
        });
      }
    }
    const res: BulkDeleteResponse = { results };
    return c.json(res);
  });
```

`AppError` は既にこのファイルで import 済み（`import { AppError } from "../../lib/errors";`）なのでそのまま使う。

- [ ] **Step 6: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- files.routes`
Expected: PASS

- [ ] **Step 7: typecheck**

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add packages/shared/src/types.ts apps/server/src/features/files/files.schema.ts apps/server/src/features/files/files.routes.ts apps/server/src/features/files/files.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: 一括削除APIを追加する

POST /api/delete-bulk で複数パスをまとめてゴミ箱に移動する。1件の失敗
で全体を止めず、パスごとの成功/失敗を results 配列で返す
EOF
)"
```

---

### Task 2: サーバ — 一括ダウンロードAPI（`POST /api/download-bulk`）

**Files:**
- Modify: `packages/shared/src/types.ts`（Task 1 で `BulkPathsRequest` を追加済み。このタスクでの追加は無し）
- Modify: `apps/server/src/features/files/files.service.ts`
- Modify: `apps/server/src/features/files/files.routes.ts`
- Test: `apps/server/src/features/files/files.service.test.ts`
- Test: `apps/server/src/features/files/files.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 の `BulkPathsRequest`、`parseBulkPathsBody`。既存の `walkAndAppend(archive: Archiver, absDir: string, zipPrefix: string): Promise<void>`（`files.service.ts` 内 private 関数、同ファイル内なのでそのまま呼べる）、`safeResolve(root: string, relPath: string): string`（`apps/server/src/lib/safe-resolve.ts`）
- Produces: 関数 `createSelectionZipStream(root: string, relPaths: string[]): Archiver`（`files.service.ts`）、ルート `POST /api/download-bulk`

- [ ] **Step 1: 失敗する service テストを書く**

`apps/server/src/features/files/files.service.test.ts` の `describe("createFolderZipStream", ...)` ブロックの直後に追加:

```ts
describe("createSelectionZipStream", () => {
  it("選択した複数ファイルをzip直下に含む", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    await writeFile(path.join(root, "b.txt"), "b");
    const archive = createSelectionZipStream(root, ["a.txt", "b.txt"]);
    const zipPath = path.join(root, "sel1.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("選択したフォルダはフォルダ名をプレフィックスにして中身を含む", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "inner.txt"), "inner");
    const archive = createSelectionZipStream(root, ["sub"]);
    const zipPath = path.join(root, "sel2.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["sub/inner.txt"]);
  });

  it("ファイルとフォルダの混在選択を1つのzipにまとめる", async () => {
    await writeFile(path.join(root, "top.txt"), "top");
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "inner.txt"), "inner");
    const archive = createSelectionZipStream(root, ["top.txt", "sub"]);
    const zipPath = path.join(root, "sel3.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["sub/inner.txt", "top.txt"]);
  });

  it("走査開始後に消えていたパスは無視して他の選択項目を含む", async () => {
    await writeFile(path.join(root, "keep.txt"), "keep");
    const archive = createSelectionZipStream(root, ["keep.txt", "missing.txt"]);
    const zipPath = path.join(root, "sel4.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["keep.txt"]);
  });

  it("パストラバーサルを含む選択は zip 化を失敗させる", async () => {
    const archive = createSelectionZipStream(root, ["../evil"]);
    const zipPath = path.join(root, "sel5.zip");
    await expect(zipToEntries(archive, zipPath)).rejects.toThrow();
  });
});
```

`import` に `createSelectionZipStream` を追加:

```ts
import {
  createFolderZipStream,
  createSelectionZipStream,
  listDir,
  makeDir,
  renamePath,
  resolveDownloadEntry,
  statForDownload,
  uploadFile,
} from "./files.service";
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- files.service`
Expected: FAIL（`createSelectionZipStream` は存在しない）

- [ ] **Step 3: `createSelectionZipStream` を実装する**

`apps/server/src/features/files/files.service.ts` の `createFolderZipStream` の直後に追加:

```ts
/** 複数の選択項目（ファイル/フォルダ混在可）を1つの無圧縮zipとしてストリーミング生成する。 */
export function createSelectionZipStream(root: string, relPaths: string[]): Archiver {
  const archive = new ZipArchive({ store: true });
  const handleError = (err: unknown) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      archive.destroy(err as Error);
    }
  };
  archive.on("warning", handleError);
  archive.on("error", handleError);
  void (async () => {
    for (const relPath of relPaths) {
      const abs = safeResolve(root, relPath);
      const st = await fs.stat(abs).catch(() => null);
      if (!st) continue;
      const name = path.basename(abs);
      if (st.isDirectory()) {
        await walkAndAppend(archive, abs, name);
      } else if (st.isFile()) {
        archive.file(abs, { name });
      }
    }
  })().then(
    () => archive.finalize(),
    (err) => archive.destroy(err as Error),
  );
  return archive;
}
```

- [ ] **Step 4: service テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- files.service`
Expected: PASS

- [ ] **Step 5: 失敗する route テストを書く**

`apps/server/src/features/files/files.routes.test.ts` の `describe("POST /api/delete-bulk", ...)` ブロックの直後に追加:

```ts
describe("POST /api/download-bulk", () => {
  it("複数選択をまとめて1つのzipで返す", async () => {
    await writeFile(path.join(root, "a.txt"), "a");
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub", "inner.txt"), "inner");
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/download-bulk",
      withAuth({
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ["a.txt", "sub"] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("zip");
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names.sort()).toEqual(["a.txt", "sub/inner.txt"]);
  });

  it("パストラバーサルを含む選択はストリーム開始前に 400 + PATH_TRAVERSAL を返す", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/download-bulk",
      withAuth({
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ paths: ["../evil"] }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("PATH_TRAVERSAL");
  });

  it("空配列は 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/download-bulk",
      withAuth({ method: "POST", headers: jsonHeaders, body: JSON.stringify({ paths: [] }) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
});
```

- [ ] **Step 6: route テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- files.routes`
Expected: FAIL（`/api/download-bulk` が存在せず 404）

- [ ] **Step 7: ルートを実装する**

`apps/server/src/features/files/files.routes.ts` の import に `safeResolve` と `createSelectionZipStream` を追加:

```ts
import { safeResolve } from "../../lib/safe-resolve";
```

```ts
import {
  createFolderZipStream,
  createSelectionZipStream,
  listDir,
  makeDir,
  renamePath,
  resolveDownloadEntry,
  statForDownload,
  uploadFile,
} from "./files.service";
```

`app.post("/delete-bulk", ...)` の直後（`return app;` の前）に追加:

```ts
  app.post("/download-bulk", async (c) => {
    const { paths } = parseBulkPathsBody(await readJsonBody(() => c.req.json()));
    // zip ストリーミング開始前に全パスを検証し、トラバーサル等は 400 として返す
    // （ストリーム開始後は Content-Type 200 が確定済みで status を変更できないため）
    for (const p of paths) {
      safeResolve(root, p);
    }
    const archive = createSelectionZipStream(root, paths);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", contentDisposition("選択項目.zip"));
    return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
  });
```

- [ ] **Step 8: route テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- files.routes`
Expected: PASS

- [ ] **Step 9: 全体テスト + typecheck**

Run: `npm run test -w @nas-fm/server && npm run typecheck -w @nas-fm/server`
Expected: 全て PASS

- [ ] **Step 10: コミット**

```bash
git add apps/server/src/features/files/files.service.ts apps/server/src/features/files/files.service.test.ts apps/server/src/features/files/files.routes.ts apps/server/src/features/files/files.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: 一括ダウンロードAPIを追加する

POST /api/download-bulk で複数選択（ファイル/フォルダ混在可）を1つの
zipにまとめてストリーミング返却する。既存の createFolderZipStream の
走査ロジック（walkAndAppend）を再利用した。パストラバーサルはzip
ストリーム開始前に検証し400で弾く
EOF
)"
```

---

### Task 3: クライアント — Checkbox UI と一括操作用APIクライアント

**Files:**
- Create: `apps/web/src/components/ui/checkbox.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 1/2 の `BulkDeleteResponse`（`@nas-fm/shared`）、既存の `request()` / `JSON_HEADERS`（`apps/web/src/lib/api.ts` 内）
- Produces: `Checkbox` コンポーネント（`@/components/ui/checkbox`。props は `React.ComponentProps<typeof CheckboxPrimitive.Root>` — `checked: boolean | "indeterminate"`, `onCheckedChange: (checked: boolean | "indeterminate") => void`, `aria-label` 等）、`api.deleteBulk(paths: string[]): Promise<BulkDeleteResponse>`、`api.downloadBulk(paths: string[]): Promise<void>`

- [ ] **Step 1: Checkbox コンポーネントを作成する**

`apps/web/src/components/ui/checkbox.tsx` を新規作成（既存の `label.tsx` と同じ radix-ui ラップの型式）:

```tsx
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground dark:data-[state=checked]:bg-primary data-[state=checked]:border-primary focus-visible:border-ring focus-visible:ring-ring/50 size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
```

このファイルに対する専用テストは作らない（既存の `dialog.tsx` / `sheet.tsx` 等の shadcn 生成物と同様、消費側コンポーネントのテストで間接的に検証する）。

- [ ] **Step 2: 失敗する api.ts テストを書く**

`apps/web/src/lib/api.test.ts` の末尾に追加:

```ts
describe("api.deleteBulk", () => {
  it("paths を JSON body で POST し結果を返す", async () => {
    mockFetch(200, { results: [{ path: "a.txt", ok: true }] });
    const res = await api.deleteBulk(["a.txt"]);
    expect(res).toEqual({ results: [{ path: "a.txt", ok: true }] });
    expect(fetch).toHaveBeenCalledWith(
      "/api/delete-bulk",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ paths: ["a.txt"] }) }),
    );
  });

  it("失敗時は ApiRequestError", async () => {
    mockFetch(400, { error: { code: "INVALID_REQUEST", message: "x" } });
    await expect(api.deleteBulk([])).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("api.downloadBulk", () => {
  it("paths を POST し、返った blob をアンカークリックで保存する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["zip-bytes"]), { status: 200 })),
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === "a") el.click = clickSpy;
        return el;
      });

    await api.downloadBulk(["a.txt", "b.txt"]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/download-bulk",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ paths: ["a.txt", "b.txt"] }) }),
    );
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    createElementSpy.mockRestore();
  });

  it("失敗時は ApiRequestError", async () => {
    mockFetch(500, { error: { code: "INTERNAL", message: "x" } });
    await expect(api.downloadBulk(["a.txt"])).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- src/lib/api.test.ts`
Expected: FAIL（`api.deleteBulk` / `api.downloadBulk` が存在しない）

- [ ] **Step 4: `api.ts` に追加する**

`apps/web/src/lib/api.ts` の import に `BulkDeleteResponse` を追加:

```ts
import type {
  AuthStatus,
  BulkDeleteResponse,
  DiskUsageResponse,
  ListResponse,
  SearchResponse,
  TrashListResponse,
} from "@nas-fm/shared";
```

`api` オブジェクトの `async remove(...)` の直後に追加:

```ts
  async deleteBulk(paths: string[]): Promise<BulkDeleteResponse> {
    const res = await request("/api/delete-bulk", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ paths }),
    });
    return (await res.json()) as BulkDeleteResponse;
  },

  async downloadBulk(paths: string[]): Promise<void> {
    const res = await request("/api/download-bulk", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ paths }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "選択項目.zip";
    a.click();
    URL.revokeObjectURL(url);
  },
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 6: typecheck**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add apps/web/src/components/ui/checkbox.tsx apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "$(cat <<'EOF'
feat: Checkboxコンポーネントと一括操作用APIクライアントを追加する
EOF
)"
```

---

### Task 4: クライアント — FileTable/FileGrid に複数選択UIを追加

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileTable.tsx`
- Modify: `apps/web/src/features/file-list/components/FileTable.test.tsx`
- Modify: `apps/web/src/features/file-list/components/FileGrid.tsx`
- Modify: `apps/web/src/features/file-list/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `Checkbox`（`@/components/ui/checkbox`）
- Produces: `FileTable`/`FileGrid` に追加された props — `selectMode: boolean`, `selectedNames: Set<string>`, `onToggleSelect: (name: string) => void`（Task 7 で `FileBrowser` から渡す）

- [ ] **Step 1: 失敗する FileTable テストを書く**

`apps/web/src/features/file-list/components/FileTable.test.tsx` に以下のヘルパーとテストを追加。ファイル冒頭に共通 props ヘルパーを追加:

```tsx
function baseProps(overrides: Partial<Parameters<typeof FileTable>[0]> = {}) {
  return {
    entries,
    sortKey: "name" as const,
    sortDir: "asc" as const,
    onSortChange: () => {},
    onOpenDir: () => {},
    onPreview: () => {},
    path: "",
    onRename: () => {},
    onDelete: () => {},
    onMove: () => {},
    selectMode: false,
    selectedNames: new Set<string>(),
    onToggleSelect: () => {},
    ...overrides,
  };
}
```

`describe("FileTable", ...)` 内の末尾に追加:

```tsx
  it("selectMode時はチェックボックス列を表示する", () => {
    render(<FileTable {...baseProps({ selectMode: true })} />);
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "a.txt を選択" })).toBeInTheDocument();
  });

  it("selectMode時でなければチェックボックスを表示しない", () => {
    render(<FileTable {...baseProps({ selectMode: false })} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("チェックボックスクリックで onToggleSelect のみ呼ぶ(開く/プレビューは呼ばれない)", async () => {
    const onToggleSelect = vi.fn();
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    render(
      <FileTable {...baseProps({ selectMode: true, onToggleSelect, onOpenDir, onPreview })} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "sub を選択" }));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith("sub");
    expect(onOpenDir).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("selectMode時は行クリックでも onToggleSelect を呼ぶ(開く/プレビューは呼ばれない)", async () => {
    const onToggleSelect = vi.fn();
    const onOpenDir = vi.fn();
    render(<FileTable {...baseProps({ selectMode: true, onToggleSelect, onOpenDir })} />);
    await userEvent.click(screen.getByText("sub"));
    expect(onToggleSelect).toHaveBeenCalledWith("sub");
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("選択済みの行はチェックボックスがチェックされる", () => {
    render(<FileTable {...baseProps({ selectMode: true, selectedNames: new Set(["a.txt"]) })} />);
    expect(screen.getByRole("checkbox", { name: "a.txt を選択" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).not.toBeChecked();
  });

  it("selectMode時は操作メニューを表示しない", () => {
    render(<FileTable {...baseProps({ selectMode: true })} />);
    expect(screen.queryByRole("button", { name: "操作メニュー" })).not.toBeInTheDocument();
  });
```

**注意:** このステップ以降、既存テストケース（Step 1 より前にある全てのテスト）は `baseProps()` を使わず個別に `<FileTable entries={...} ... />` を直書きしたままで良い（変更不要）。新規テストのみ `baseProps()` を使う。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileTable`
Expected: FAIL（`selectMode` 等の props が無く型エラー、チェックボックスが存在しない）

- [ ] **Step 3: FileTable を実装する**

`apps/web/src/features/file-list/components/FileTable.tsx` を以下のように変更する。

import に `Checkbox` を追加:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
```

関数シグネチャを変更:

```tsx
export function FileTable({
  entries,
  sortKey,
  sortDir,
  onSortChange,
  onOpenDir,
  onPreview,
  path,
  onRename,
  onDelete,
  onMove,
  selectMode,
  selectedNames,
  onToggleSelect,
}: {
  entries: FileEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  path: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  selectMode: boolean;
  selectedNames: Set<string>;
  onToggleSelect: (name: string) => void;
}) {
```

`TableHeader` 内の `TableRow` の先頭に条件付きで空ヘッダーを追加:

```tsx
        <TableRow>
          {selectMode && <TableHead className="w-10" />}
          <TableHead>
```

（既存の `名前` の `TableHead` の直前に挿入する）

`TableBody` 内の行 `onClick` を変更:

```tsx
          <TableRow
            key={entry.name}
            className="cursor-pointer"
            onClick={() =>
              selectMode
                ? onToggleSelect(entry.name)
                : entry.type === "dir"
                  ? onOpenDir(entry.name)
                  : onPreview(entry)
            }
          >
            {selectMode && (
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`${entry.name} を選択`}
                  checked={selectedNames.has(entry.name)}
                  onCheckedChange={() => onToggleSelect(entry.name)}
                />
              </TableCell>
            )}
            <TableCell>
```

（既存の名前セル `<TableCell>` の直前に挿入する）

最後の操作メニューセルを変更:

```tsx
            <TableCell onClick={(e) => e.stopPropagation()}>
              {!selectMode && (
                <RowActions
                  entry={entry}
                  path={path}
                  onPreview={onPreview}
                  onRename={onRename}
                  onDelete={onDelete}
                  onMove={onMove}
                />
              )}
            </TableCell>
```

- [ ] **Step 4: FileTable テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- FileTable`
Expected: PASS（既存テストも含め全て）

- [ ] **Step 5: 失敗する FileGrid テストを書く**

`apps/web/src/features/file-list/components/FileGrid.test.tsx` の `renderGrid` ヘルパーを変更:

```tsx
function renderGrid(overrides: Partial<Parameters<typeof FileGrid>[0]> = {}) {
  return render(
    <FileGrid
      entries={entries}
      path=""
      onOpenDir={() => {}}
      onPreview={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onMove={() => {}}
      selectMode={false}
      selectedNames={new Set<string>()}
      onToggleSelect={() => {}}
      {...overrides}
    />,
  );
}
```

`describe("FileGrid", ...)` の末尾に追加:

```tsx
  it("selectMode時は各カードにチェックボックスを表示する", () => {
    renderGrid({ selectMode: true });
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "doc.pdf を選択" })).toBeInTheDocument();
  });

  it("selectMode時でなければチェックボックスを表示しない", () => {
    renderGrid({ selectMode: false });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("selectMode時はカードクリックで onToggleSelect のみ呼ぶ", async () => {
    const onToggleSelect = vi.fn();
    const onOpenDir = vi.fn();
    renderGrid({ selectMode: true, onToggleSelect, onOpenDir });
    await userEvent.click(screen.getByText("sub"));
    expect(onToggleSelect).toHaveBeenCalledWith("sub");
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("選択済みのカードはチェックボックスがチェックされる", () => {
    renderGrid({ selectMode: true, selectedNames: new Set(["doc.pdf"]) });
    expect(screen.getByRole("checkbox", { name: "doc.pdf を選択" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).not.toBeChecked();
  });

  it("selectMode時は操作メニューを表示しない", () => {
    renderGrid({ selectMode: true });
    expect(screen.queryByRole("button", { name: "操作メニュー" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileGrid`
Expected: FAIL（`selectMode` 等の props が無く型エラー）

- [ ] **Step 7: FileGrid を実装する**

`apps/web/src/features/file-list/components/FileGrid.tsx` の import に `Checkbox` を追加:

```tsx
import { Checkbox } from "@/components/ui/checkbox";
```

関数シグネチャを変更:

```tsx
export function FileGrid({
  entries,
  path,
  onOpenDir,
  onPreview,
  onRename,
  onDelete,
  onMove,
  selectMode,
  selectedNames,
  onToggleSelect,
}: {
  entries: FileEntry[];
  path: string;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
  selectMode: boolean;
  selectedNames: Set<string>;
  onToggleSelect: (name: string) => void;
}) {
```

カードの `onClick` を変更:

```tsx
        <div
          key={entry.name}
          className="relative cursor-pointer overflow-hidden rounded-lg border"
          onClick={() =>
            selectMode
              ? onToggleSelect(entry.name)
              : entry.type === "dir"
                ? onOpenDir(entry.name)
                : onPreview(entry)
          }
        >
```

RowActions のラッパー div を変更し、その直後にチェックボックス用の div を追加:

```tsx
          {!selectMode && (
            <div
              className="absolute top-1 right-1 rounded-md bg-background/80"
              onClick={(e) => e.stopPropagation()}
            >
              <RowActions
                entry={entry}
                path={path}
                onPreview={onPreview}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
              />
            </div>
          )}
          {selectMode && (
            <div className="absolute top-1 left-1 z-10" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                aria-label={`${entry.name} を選択`}
                checked={selectedNames.has(entry.name)}
                onCheckedChange={() => onToggleSelect(entry.name)}
                className="bg-background"
              />
            </div>
          )}
```

- [ ] **Step 8: FileGrid テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- FileGrid`
Expected: PASS

- [ ] **Step 9: FileBrowser の呼び出しを一時的に更新（型エラー解消のため）**

`FileBrowser.tsx` はまだ Task 7 で本格的に配線するが、この時点で `FileTable`/`FileGrid` の呼び出し箇所が新しい必須 props 無しで型エラーになる。ビルドを通すため、`apps/web/src/features/file-list/components/FileBrowser.tsx` の `<FileTable ...>` と `<FileGrid ...>` 呼び出しに一時的に固定値を渡す:

```tsx
      {data && viewMode === "table" && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          path={path}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
          selectMode={false}
          selectedNames={EMPTY_SELECTION}
          onToggleSelect={() => {}}
        />
      )}
      {data && viewMode === "grid" && (
        <FileGrid
          entries={sorted}
          path={path}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
          selectMode={false}
          selectedNames={EMPTY_SELECTION}
          onToggleSelect={() => {}}
        />
      )}
```

ファイル冒頭（`VIEW_MODE_KEY` の定義の近く）に定数を追加:

```tsx
const EMPTY_SELECTION = new Set<string>();
```

Task 7 でこれらは実際の選択状態に置き換わる。

- [ ] **Step 10: typecheck + 全体テスト**

Run: `npm run typecheck -w @nas-fm/web && npm run test -w @nas-fm/web`
Expected: 全て PASS（`noUnusedLocals` に注意。`EMPTY_SELECTION` は Step 9 で実際に使用されるため未使用エラーにはならない）

- [ ] **Step 11: コミット**

```bash
git add apps/web/src/features/file-list/components/FileTable.tsx apps/web/src/features/file-list/components/FileTable.test.tsx apps/web/src/features/file-list/components/FileGrid.tsx apps/web/src/features/file-list/components/FileGrid.test.tsx apps/web/src/features/file-list/components/FileBrowser.tsx
git commit -m "$(cat <<'EOF'
feat: FileTable/FileGridに複数選択UIを追加する

selectMode時はチェックボックス列/オーバーレイを表示し、行・カードの
クリックを選択トグルに切り替える。FileBrowser からの実配線はTask 7で
行うため、ここでは selectMode=false の固定値を渡す
EOF
)"
```

---

### Task 5: クライアント — BulkActionToolbar と BulkDeleteDialog

**Files:**
- Create: `apps/web/src/features/file-list/components/BulkActionToolbar.tsx`
- Create: `apps/web/src/features/file-list/components/BulkActionToolbar.test.tsx`
- Create: `apps/web/src/features/file-list/dialogs/BulkDeleteDialog.tsx`
- Create: `apps/web/src/features/file-list/dialogs/BulkDeleteDialog.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `Checkbox`、既存の `Button`（`@/components/ui/button`）、既存の `AlertDialog*`（`@/components/ui/alert-dialog`、`DeleteDialog.tsx` と同じ構成）
- Produces:
  - `BulkActionToolbar` props: `{ selectedCount: number; totalCount: number; onSelectAll: () => void; onExit: () => void; onDelete: () => void; onDownload: () => void; pending: boolean }`
  - `BulkDeleteDialog` props: `{ open: boolean; onOpenChange: (v: boolean) => void; targetCount: number; onConfirm: () => void }`

- [ ] **Step 1: 失敗する BulkActionToolbar テストを書く**

`apps/web/src/features/file-list/components/BulkActionToolbar.test.tsx` を新規作成:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkActionToolbar } from "./BulkActionToolbar";

function baseProps(overrides: Partial<Parameters<typeof BulkActionToolbar>[0]> = {}) {
  return {
    selectedCount: 2,
    totalCount: 5,
    onSelectAll: () => {},
    onExit: () => {},
    onDelete: () => {},
    onDownload: () => {},
    pending: false,
    ...overrides,
  };
}

describe("BulkActionToolbar", () => {
  it("選択件数を表示する", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 3 })} />);
    expect(screen.getByText("3件選択中")).toBeInTheDocument();
  });

  it("未選択(0件)では全選択チェックボックスは unchecked", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 0, totalCount: 5 })} />);
    expect(screen.getByRole("checkbox", { name: "全選択" })).not.toBeChecked();
  });

  it("全件選択済みでは全選択チェックボックスは checked", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 5, totalCount: 5 })} />);
    expect(screen.getByRole("checkbox", { name: "全選択" })).toBeChecked();
  });

  it("全選択チェックボックスクリックで onSelectAll を呼ぶ", async () => {
    const onSelectAll = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onSelectAll })} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "全選択" }));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it("選択解除ボタンで onExit を呼ぶ", async () => {
    const onExit = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onExit })} />);
    await userEvent.click(screen.getByRole("button", { name: "選択解除" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("ダウンロード/削除ボタンでそれぞれ onDownload/onDelete を呼ぶ", async () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onDownload, onDelete })} />);
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onDownload).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it("selectedCount が 0 のときダウンロード/削除ボタンは disabled", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 0 })} />);
    expect(screen.getByRole("button", { name: "ダウンロード" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });

  it("pending時はダウンロード/削除ボタンは disabled", () => {
    render(<BulkActionToolbar {...baseProps({ pending: true })} />);
    expect(screen.getByRole("button", { name: "ダウンロード" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- BulkActionToolbar`
Expected: FAIL（`BulkActionToolbar` が存在しない）

- [ ] **Step 3: BulkActionToolbar を実装する**

`apps/web/src/features/file-list/components/BulkActionToolbar.tsx` を新規作成:

```tsx
import { Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function BulkActionToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onExit,
  onDelete,
  onDownload,
  pending,
}: {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onExit: () => void;
  onDelete: () => void;
  onDownload: () => void;
  pending: boolean;
}) {
  const disabled = pending || selectedCount === 0;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="sm" onClick={onExit}>
        <X size={16} className="mr-2" />
        選択解除
      </Button>
      <Checkbox
        aria-label="全選択"
        checked={selectedCount === 0 ? false : selectedCount === totalCount ? true : "indeterminate"}
        onCheckedChange={onSelectAll}
      />
      <span className="text-sm text-muted-foreground">{selectedCount}件選択中</span>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={onDownload} disabled={disabled}>
          <Download size={16} className="mr-2" />
          ダウンロード
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={disabled}>
          <Trash2 size={16} className="mr-2" />
          削除
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- BulkActionToolbar`
Expected: PASS

- [ ] **Step 5: 失敗する BulkDeleteDialog テストを書く**

`apps/web/src/features/file-list/dialogs/BulkDeleteDialog.test.tsx` を新規作成:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkDeleteDialog } from "./BulkDeleteDialog";

describe("BulkDeleteDialog", () => {
  it("件数を含む確認文言を表示し、確定で onConfirm を呼ぶ", async () => {
    const onConfirm = vi.fn();
    render(
      <BulkDeleteDialog open onOpenChange={() => {}} targetCount={8} onConfirm={onConfirm} />,
    );
    expect(screen.getByText(/選択した8件/)).toBeInTheDocument();
    expect(screen.getByText(/ゴミ箱に移動します/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- BulkDeleteDialog`
Expected: FAIL（`BulkDeleteDialog` が存在しない）

- [ ] **Step 7: BulkDeleteDialog を実装する**

`apps/web/src/features/file-list/dialogs/BulkDeleteDialog.tsx` を新規作成（`DeleteDialog.tsx` と同構造）:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BulkDeleteDialog({
  open,
  onOpenChange,
  targetCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetCount: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>削除の確認</AlertDialogTitle>
          <AlertDialogDescription>
            選択した{targetCount}
            件をゴミ箱に移動します。フォルダの場合は中身ごと移動されます。ゴミ箱の項目は30日後に自動的に完全削除されます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>削除する</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- BulkDeleteDialog`
Expected: PASS

- [ ] **Step 9: typecheck**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラーなし

- [ ] **Step 10: コミット**

```bash
git add apps/web/src/features/file-list/components/BulkActionToolbar.tsx apps/web/src/features/file-list/components/BulkActionToolbar.test.tsx apps/web/src/features/file-list/dialogs/BulkDeleteDialog.tsx apps/web/src/features/file-list/dialogs/BulkDeleteDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: BulkActionToolbarとBulkDeleteDialogを追加する
EOF
)"
```

---

### Task 6: クライアント — useFileMutations に一括削除・一括ダウンロードを追加

**Files:**
- Modify: `apps/web/src/features/file-list/hooks/useFileMutations.ts`
- Modify: `apps/web/src/features/file-list/hooks/useFileMutations.test.tsx`

**Interfaces:**
- Consumes: Task 3 の `api.deleteBulk` / `api.downloadBulk`
- Produces: `useFileMutations(path)` の戻り値に `bulkDelete`（`useMutation` の結果。`mutationFn: (paths: string[]) => Promise<BulkDeleteResponse>`）と `bulkDownload`（`mutationFn: (paths: string[]) => Promise<void>`）を追加

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/hooks/useFileMutations.test.tsx` の末尾（`describe("useFileMutations", ...)` の閉じ括弧の直前）に追加:

```tsx
  it("bulkDelete: 全成功時は成功トーストを出しinvalidateする", async () => {
    vi.spyOn(api, "deleteBulk").mockResolvedValue({
      results: [
        { path: "docs/a.txt", ok: true },
        { path: "docs/b.txt", ok: true },
      ],
    });
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations("docs"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    result.current.bulkDelete.mutate(["docs/a.txt", "docs/b.txt"]);
    await waitFor(() => expect(success).toHaveBeenCalledWith("2件削除しました"));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["list", "docs"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["disk-usage"] });
  });

  it("bulkDelete: 一部失敗時は失敗件数を含むエラートーストを出す", async () => {
    vi.spyOn(api, "deleteBulk").mockResolvedValue({
      results: [
        { path: "docs/a.txt", ok: true },
        { path: "docs/b.txt", ok: false, errorCode: "NOT_FOUND" },
      ],
    });
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.bulkDelete.mutate(["docs/a.txt", "docs/b.txt"]);
    await waitFor(() => expect(error).toHaveBeenCalledWith("1件削除しました（1件失敗）"));
  });

  it("bulkDownload: api.downloadBulk を呼ぶ", async () => {
    const downloadBulk = vi.spyOn(api, "downloadBulk").mockResolvedValue();
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.bulkDownload.mutate(["docs/a.txt"]);
    await waitFor(() => expect(downloadBulk).toHaveBeenCalledWith(["docs/a.txt"]));
  });

  it("bulkDownload: 失敗時はエラートーストを出す", async () => {
    vi.spyOn(api, "downloadBulk").mockRejectedValue(new ApiRequestError("INTERNAL", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.bulkDownload.mutate(["docs/a.txt"]);
    await waitFor(() => expect(error).toHaveBeenCalled());
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- useFileMutations`
Expected: FAIL（`bulkDelete`/`bulkDownload` が戻り値に無い）

- [ ] **Step 3: `useFileMutations` を実装する**

`apps/web/src/features/file-list/hooks/useFileMutations.ts` の `remove` の直後、`return { mkdir, rename, remove };` の前に追加:

```ts
  const bulkDelete = useMutation({
    mutationFn: (paths: string[]) => api.deleteBulk(paths),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      const failed = res.results.filter((r) => !r.ok).length;
      const succeeded = res.results.length - failed;
      if (failed > 0) {
        toast.error(`${succeeded}件削除しました（${failed}件失敗）`);
      } else {
        toast.success(`${succeeded}件削除しました`);
      }
    },
    onError: onErrorAndRefresh,
  });

  const bulkDownload = useMutation({
    mutationFn: (paths: string[]) => api.downloadBulk(paths),
    onError: (err: unknown) => toastError(err),
  });
```

`return` 文を変更:

```ts
  return { mkdir, rename, remove, bulkDelete, bulkDownload };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- useFileMutations`
Expected: PASS

- [ ] **Step 5: typecheck**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/hooks/useFileMutations.ts apps/web/src/features/file-list/hooks/useFileMutations.test.tsx
git commit -m "$(cat <<'EOF'
feat: useFileMutationsに一括削除・一括ダウンロードを追加する
EOF
)"
```

---

### Task 7: クライアント — FileBrowser に複数選択・一括操作を配線

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- Modify: `apps/web/src/features/file-list/components/FileBrowser.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `FileTable`/`FileGrid` の `selectMode`/`selectedNames`/`onToggleSelect` props、Task 5 の `BulkActionToolbar`/`BulkDeleteDialog`、Task 6 の `bulkDelete`/`bulkDownload`

- [ ] **Step 1: 失敗する統合テストを書く**

`apps/web/src/features/file-list/components/FileBrowser.test.tsx` の末尾（最後の `describe` の閉じ括弧の直前、トップレベルの `describe("FileBrowser", ...)` 内)に追加:

```tsx
  describe("複数選択・一括操作", () => {
    it("「選択」ボタンで選択モードに入りツールバーが表示される", async () => {
      vi.spyOn(api, "list").mockResolvedValue({
        path: "",
        entries: [
          { name: "a.txt", size: 1, mtime: 0, type: "file" },
          { name: "b.txt", size: 1, mtime: 0, type: "file" },
        ],
      });
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

      await userEvent.click(screen.getByRole("button", { name: "選択" }));
      expect(screen.getByText("0件選択中")).toBeInTheDocument();
    });

    it("チェックボックスで選択すると件数が増え、全選択チェックボックスで全件選択・解除できる", async () => {
      vi.spyOn(api, "list").mockResolvedValue({
        path: "",
        entries: [
          { name: "a.txt", size: 1, mtime: 0, type: "file" },
          { name: "b.txt", size: 1, mtime: 0, type: "file" },
        ],
      });
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "選択" }));

      await userEvent.click(screen.getByRole("checkbox", { name: "a.txt を選択" }));
      expect(screen.getByText("1件選択中")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("checkbox", { name: "全選択" }));
      expect(screen.getByText("2件選択中")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("checkbox", { name: "全選択" }));
      expect(screen.getByText("0件選択中")).toBeInTheDocument();
    });

    it("削除ボタン→確認ダイアログ→確定で bulkDelete を呼び選択モードを終了する", async () => {
      vi.spyOn(api, "list").mockResolvedValue({
        path: "",
        entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
      });
      const deleteBulk = vi.spyOn(api, "deleteBulk").mockResolvedValue({
        results: [{ path: "a.txt", ok: true }],
      });
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "選択" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "a.txt を選択" }));

      await userEvent.click(screen.getByRole("button", { name: "削除" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "削除する" }));

      await waitFor(() => expect(deleteBulk).toHaveBeenCalledWith(["a.txt"]));
      expect(screen.queryByText(/件選択中/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "選択" })).toBeInTheDocument();
    });

    it("ダウンロードボタンで bulkDownload を呼び、選択モードは維持される", async () => {
      vi.spyOn(api, "list").mockResolvedValue({
        path: "",
        entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
      });
      const downloadBulk = vi.spyOn(api, "downloadBulk").mockResolvedValue();
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "選択" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "a.txt を選択" }));

      await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));

      await waitFor(() => expect(downloadBulk).toHaveBeenCalledWith(["a.txt"]));
      expect(screen.getByText("1件選択中")).toBeInTheDocument();
    });

    it("フォルダ移動で選択モード・選択状態がリセットされる", async () => {
      vi.spyOn(api, "list").mockImplementation(async (path) => ({
        path,
        entries:
          path === ""
            ? [{ name: "docs", size: 0, mtime: 0, type: "dir" as const }]
            : [{ name: "inner.txt", size: 1, mtime: 0, type: "file" as const }],
      }));
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "選択" }));
      expect(screen.getByText("0件選択中")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "選択解除" }));
      await userEvent.click(screen.getByText("docs"));

      await waitFor(() => expect(screen.getByText("inner.txt")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "選択" })).toBeInTheDocument();
    });

    it("選択解除ボタンで選択モードを終了する", async () => {
      vi.spyOn(api, "list").mockResolvedValue({
        path: "",
        entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
      });
      renderWithClient(<FileBrowser />);
      await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
      await userEvent.click(screen.getByRole("button", { name: "選択" }));
      await userEvent.click(screen.getByRole("button", { name: "選択解除" }));
      expect(screen.getByRole("button", { name: "選択" })).toBeInTheDocument();
      expect(screen.queryByText(/件選択中/)).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: FAIL（「選択」ボタンが存在しない）

- [ ] **Step 3: FileBrowser を実装する**

`apps/web/src/features/file-list/components/FileBrowser.tsx` の import を変更:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { FolderPlus, LayoutGrid, List, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/features/upload";
import { api } from "@/lib/api";
import { useFileList } from "../hooks/useFileList";
import { useFileMutations } from "../hooks/useFileMutations";
import { useHashPath } from "@/lib/useHashPath";
import { type SortDir, type SortKey, sortEntries } from "../sort";
import { MkdirDialog } from "../dialogs/MkdirDialog";
import { RenameDialog } from "../dialogs/RenameDialog";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { BulkDeleteDialog } from "../dialogs/BulkDeleteDialog";
import { MoveDialog } from "../dialogs/MoveDialog";
import { PreviewDialog } from "../dialogs/PreviewDialog";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileTable } from "./FileTable";
import { FileGrid } from "./FileGrid";
import { SortMenu } from "./SortMenu";
import { BulkActionToolbar } from "./BulkActionToolbar";
```

`EMPTY_SELECTION` 定数は削除する（実際の state に置き換わるため）。

`FileBrowser` 関数内、`const [previewTarget, ...]` の直後に選択状態を追加:

```tsx
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
```

`useFileList`/`useFileMutations` の行を変更:

```tsx
  const { data, isLoading, isError, refetch } = useFileList(path);
  const { mkdir, rename, remove, bulkDelete, bulkDownload } = useFileMutations(path);
```

既存の `const rel = useCallback(...)` の行（テンプレートリテラルで相対パスを組み立てている既存の関数）の直後、かつ `const previewableEntries = useMemo(...)` の直前に、フォルダ移動時の選択リセットと選択操作の関数を追加する:

```tsx
  useEffect(() => {
    setSelectMode(false);
    setSelectedNames(new Set());
  }, [path]);

  function toggleSelect(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedNames((prev) =>
      prev.size === sorted.length ? new Set() : new Set(sorted.map((e) => e.name)),
    );
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedNames(new Set());
  }
  function confirmBulkDelete() {
    bulkDelete.mutate([...selectedNames].map(rel));
    setBulkDeleteOpen(false);
    exitSelectMode();
  }
```

上部アクション行（`<div className="flex flex-wrap items-center justify-end gap-2">` から対応する `</div>` まで）を丸ごと置き換える:

```tsx
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selectMode ? (
          <BulkActionToolbar
            selectedCount={selectedNames.size}
            totalCount={sorted.length}
            onSelectAll={toggleSelectAll}
            onExit={exitSelectMode}
            onDelete={() => setBulkDeleteOpen(true)}
            onDownload={() => bulkDownload.mutate([...selectedNames].map(rel))}
            pending={bulkDelete.isPending || bulkDownload.isPending}
          />
        ) : (
          <>
            {viewMode === "grid" && (
              <SortMenu
                sortKey={sortKey}
                sortDir={sortDir}
                onSortKeyChange={setSortKey}
                onSortDirChange={setSortDir}
              />
            )}
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-label="グリッド表示"
              onClick={() => changeViewMode("grid")}
            >
              <LayoutGrid size={16} />
            </Button>
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="icon"
              aria-label="テーブル表示"
              onClick={() => changeViewMode("table")}
            >
              <List size={16} />
            </Button>
            <Button size="sm" onClick={() => setMkdirOpen(true)}>
              <FolderPlus size={16} className="mr-2" />
              新しいフォルダ
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
              <MousePointerClick size={16} className="mr-2" />
              選択
            </Button>
          </>
        )}
      </div>
```

`FileTable`/`FileGrid` 呼び出しの `selectMode={false}` / `selectedNames={EMPTY_SELECTION}` / `onToggleSelect={() => {}}` を実値に置き換える:

```tsx
      {data && viewMode === "table" && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          path={path}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
          selectMode={selectMode}
          selectedNames={selectedNames}
          onToggleSelect={toggleSelect}
        />
      )}
      {data && viewMode === "grid" && (
        <FileGrid
          entries={sorted}
          path={path}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
          selectMode={selectMode}
          selectedNames={selectedNames}
          onToggleSelect={toggleSelect}
        />
      )}
```

`<DeleteDialog .../>` の直後に `BulkDeleteDialog` を追加:

```tsx
      <BulkDeleteDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        targetCount={selectedNames.size}
        onConfirm={confirmBulkDelete}
      />
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: PASS

- [ ] **Step 5: 全体テスト + typecheck + lint**

Run: `npm run test && npm run typecheck && npm run lint`
Expected: 全て PASS（`apps/web`/`App.test.tsx` 等の既存の無関係なテストも含め green であること。既知の事前不具合は無い状態のはず — もし失敗があれば、このタスクの変更による新規デグレか、環境依存かを切り分けること）

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/components/FileBrowser.tsx apps/web/src/features/file-list/components/FileBrowser.test.tsx
git commit -m "$(cat <<'EOF'
feat: FileBrowserに複数選択・一括操作を配線する

「選択」ボタンで選択モードに入り、上部アクション行がBulkActionToolbar
に切り替わる。フォルダ移動時は選択状態をリセットする。削除は確認後に
選択モードを終了し、ダウンロードは非破壊操作のため選択を維持する
EOF
)"
```

---

### Task 8: 手動QA（Playwright）

**Files:** なし（コード変更を伴わない検証タスク）

**Interfaces:** Consumes: Task 1〜7 の全機能

- [ ] **Step 1: 開発サーバを起動する**

Run: `npm run dev`

- [ ] **Step 2: ブラウザでログインし、テスト用ファイルを用意する**

Playwright MCP でログイン後、複数のテストファイル（画像2〜3枚、通常ファイル1〜2個、フォルダ1個程度）を配置したフォルダを用意する。

- [ ] **Step 3: テーブル表示での選択・一括削除・一括ダウンロードを確認する**

- 「選択」ボタンでツールバーに切り替わることを確認
- 数件チェックし、件数表示が正しいことを確認
- 「全選択」チェックボックスで全選択/解除が効くことを確認
- 「削除」→確認ダイアログ→確定で、選択した項目が一覧から消え、選択モードが終了することを確認
- 別の数件を選択し「ダウンロード」→ 1つのzipファイルとして保存され、選択モードが維持されることを確認

- [ ] **Step 4: グリッド表示で同様の確認を行う**

サムネイル左上にチェックボックスが表示され、右上の操作メニューが選択モード中は消えることを確認する。

- [ ] **Step 5: フォルダ移動での選択リセットを確認する**

選択モード中にフォルダを開こうとしても選択トグルになり遷移しないこと、「選択解除」でモードを抜けた後にフォルダを開くと選択状態が残っていないことを確認する。

- [ ] **Step 6: モバイル幅での表示を確認する**

ブラウザ幅を狭くし（例: 390px）、ツールバーのボタン・チェックボックスが崩れずタップ可能なサイズであることを確認する。

- [ ] **Step 7: 気になった点があれば記録し、必要なら追加の修正コミットを行う**

このタスクはコードのコミットを前提としない。ただし QA で発見した不具合を直した場合は、通常のタスクと同様にテスト→実装→コミットのサイクルで対応する。

---

## Self-Review メモ（このプラン作成時に実施済み）

- 設計docの `BulkDeleteRequest`/`BulkDownloadRequest`（2つの同一構造の型）は `BulkPathsRequest` 1つに統合した（DRY）
- 設計docの `deleteBulk`/`downloadBulk` の実装は、既存の共通ヘルパー `request()`（非ok時に `ApiRequestError` を投げる）をそのまま使う形に修正した（設計doc時点のプレースホルダー的な `fetch` 直書きを解消）
- 設計docでは「BulkActionToolbarに全選択」「FileTableヘッダにも全選択」の両方に触れていたが、単一の選択元にするため全選択操作は `BulkActionToolbar` のみに統一し、`FileTable` のヘッダは列位置合わせ用の空セルのみとした
- BulkDeleteDialog の文言は実際の `DeleteDialog.tsx` の実装（「ゴミ箱に移動します」）に合わせた（設計doc執筆時点の想定文言「削除しますか」から修正）
- 一括削除は確認ダイアログの確定と同時に選択モードを終了する（既存の単発削除 `DeleteDialog` の `onConfirm` が mutation の結果を待たずダイアログを閉じる実装に合わせた、設計docの「成功後にクリア」から簡略化）
- 一括ダウンロードは、zipストリーミング開始前に全パスを `safeResolve` で検証し、パストラバーサルを含む場合は 400 で弾くようにした（設計doc執筆時点では検討していなかった、ストリーム開始後はHTTPステータスを変更できないという制約への対応）
