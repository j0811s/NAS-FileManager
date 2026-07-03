# Phase 3: フロントエンド UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/web` に Phase 1 のファイル操作 API を使う UI（一覧・パンくず・ソート・ダウンロード・アップロード・フォルダ作成/リネーム/削除・トースト通知）を実装する。

**Architecture:** Tailwind v4 + shadcn/ui（Open Code）でUIプリミティブ、`lib/api.ts` に fetch/XHR の API クライアントを集約、TanStack Query（`useQuery`/`useMutation` + `invalidateQueries`）でサーバ状態、features 構成（`file-list` / `upload`）で機能を縦割り。設計は `docs/superpowers/specs/2026-07-03-phase3-web-ui-design.md`。

**Tech Stack:** React 19 / Vite 8 / Tailwind CSS v4 (`@tailwindcss/vite`) / shadcn/ui / @tanstack/react-query / lucide-react / sonner / Vitest + @testing-library/react

## Global Constraints

- **依存追加**: `.npmrc` が `save-exact` / `min-release-age=3` / `engine-strict` を強制。新規依存は**バージョン無指定**で `npm install <pkg> -w @nas-fm/web`（shadcn/tailwind が入れる Radix 等も exact 固定される）。公開3日未満の版が弾かれたら、直近の3日以上経過版を明示指定してよい
- **TypeScript**: `erasableSyntaxOnly` 有効 → parameter property・enum 禁止（クラスはフィールド明示代入）。`verbatimModuleSyntax` 有効 → 型のみ import/export は `import type` / `export type`。`baseUrl` は使わない・`paths` の値は相対（`./src/*`）
- **import 規約**: feature 間 import は各 feature の `index.ts`（公開境界）経由のみ。同一 feature 内は相対 import 可。UI プリミティブは `@/components/ui/*`、共通は `@/lib/*`。`@nas-fm/shared` からは**型のみ**
- **テスト**: Vitest（jsdom）。`@testing-library/react` + `@testing-library/user-event`。API は `@/lib/api` をモック。TanStack Query はテスト用に `retry: false` の QueryClient でラップ
- **ツール/コミット**: oxfmt / oxlint（Prettier/ESLint ではない）。pre-commit で lint-staged（oxfmt → oxlint --fix → 全ワークスペース typecheck）が自動実行。1タスク=1コミット。Conventional Commits（接頭辞英語、本文日本語）
- **禁止**: `curl` / `wget` / `rm -rf` / `env` / `printenv` / `git push --force`。`.env*` は読まない。Node 24.16.0 固定

---

## File Structure

```
apps/web/
├─ components.json                         # T1: shadcn 設定
├─ vite.config.ts                          # T1: tailwind plugin + test.setupFiles
├─ tsconfig.json                           # T1: compilerOptions.paths（shadcn の alias 解決用）
├─ src/
│  ├─ index.css                            # T1: Tailwind + shadcn テーマ
│  ├─ main.tsx                             # T1: index.css を import
│  ├─ test/setup.ts                        # T1: jest-dom + jsdom ポリフィル
│  ├─ app/
│  │  ├─ App.tsx                           # T1: Providers + ヘッダ（T3 で FileBrowser 追加）
│  │  ├─ App.test.tsx                      # T1/T3: 更新
│  │  └─ providers.tsx                     # T1: QueryClientProvider + Sonner Toaster
│  ├─ lib/
│  │  ├─ utils.ts                          # T1: cn()（shadcn 生成）
│  │  ├─ api.ts                            # T2: API クライアント（fetch + XHR upload）
│  │  ├─ api.test.ts                       # T2
│  │  ├─ error-messages.ts                 # T2: ApiErrorCode→日本語
│  │  └─ error-messages.test.ts            # T2
│  ├─ components/ui/                        # T1: shadcn 生成物
│  └─ features/
│     ├─ file-list/
│     │  ├─ sort.ts / sort.test.ts         # T2: sortEntries
│     │  ├─ hooks/useFileList.ts           # T3
│     │  ├─ hooks/useFileMutations.ts      # T5
│     │  ├─ components/Breadcrumbs.tsx     # T3
│     │  ├─ components/FileTable.tsx       # T3
│     │  ├─ components/FileBrowser.tsx     # T3（T4/T5/T6 で拡張）
│     │  ├─ components/RowActions.tsx      # T4
│     │  ├─ dialogs/MkdirDialog.tsx        # T5
│     │  ├─ dialogs/RenameDialog.tsx       # T5
│     │  ├─ dialogs/DeleteDialog.tsx       # T5
│     │  ├─ *.test.tsx                      # 各タスク
│     │  └─ index.ts                        # T3: FileBrowser を export
│     └─ upload/
│        ├─ hooks/useUpload.ts             # T6
│        ├─ components/UploadDropzone.tsx  # T6
│        ├─ *.test.tsx                      # T6
│        └─ index.ts                        # T6
```

`apps/web/src/features/{file-list,upload}/.gitkeep`、`components/ui/.gitkeep`、`lib/.gitkeep` は実ファイル追加時に削除する。

---

### Task 1: 基盤セットアップ（Tailwind v4 + shadcn/ui + Providers + テスト基盤）

**Files:**
- Modify: `apps/web/package.json`（deps）, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/main.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`
- Create: `apps/web/components.json`, `apps/web/src/index.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/app/providers.tsx`, `apps/web/src/test/setup.ts`, `apps/web/src/components/ui/*`（shadcn 生成）

**Interfaces:**
- Produces: `Providers`（`{ children }` を QueryClientProvider + `<Toaster />` でラップ）。shadcn UI プリミティブ（`@/components/ui/button` 等）。`cn()`（`@/lib/utils`）。テスト用 jsdom セットアップ

- [ ] **Step 1: 依存を追加**

```bash
npm install tailwindcss @tailwindcss/vite @tanstack/react-query lucide-react sonner -w @nas-fm/web
npm install -D @testing-library/jest-dom @testing-library/user-event -w @nas-fm/web
```

- [ ] **Step 2: `apps/web/tsconfig.json` に paths を追加（shadcn の alias 解決用）**

このファイルは solution スタイルで `tsc` が直接コンパイルしない（`typecheck` は tsconfig.app.json / tsconfig.node.json を使う）ため、`compilerOptions.paths` を足しても TS エラーにならない。shadcn CLI がこの alias を読む。

`apps/web/tsconfig.json`（全置換）:
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }],
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

- [ ] **Step 3: `apps/web/vite.config.ts` を全置換（tailwind plugin + test setup）**

```ts
/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 4: `apps/web/src/index.css` を作成（最小。shadcn init がテーマを追記する）**

```css
@import "tailwindcss";
```

`apps/web/src/main.tsx` の先頭に CSS import を追加（既存の import 群の一番上）:
```tsx
import "./index.css";
```

- [ ] **Step 5: shadcn 初期化とコンポーネント追加**

非対話フラグで実行する。`components.json` が生成され、`src/lib/utils.ts`（`cn`）と CSS テーマが用意される。

```bash
cd apps/web
npx shadcn@latest init --yes --base-color neutral
npx shadcn@latest add button table dialog alert-dialog dropdown-menu input breadcrumb sonner progress card --yes
cd ../..
```

もし init が「No import alias found」等で失敗する場合は、Step 2 の `paths` が入っているか確認する。`components.json` の `aliases` は `{ "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" }` であること。`src/components/ui/` にコンポーネントが生成されれば成功。

- [ ] **Step 6: `apps/web/src/app/providers.tsx` を作成**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 7: `apps/web/src/app/App.tsx` を全置換（ヘッダのみ。FileBrowser は T3 で追加）**

```tsx
import { Providers } from "./providers";

export function App() {
  return (
    <Providers>
      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b px-6 py-4">
          <h1 className="text-xl font-semibold">NAS-FileManager</h1>
        </header>
        <main className="p-6" />
      </div>
    </Providers>
  );
}
```

- [ ] **Step 8: `apps/web/src/test/setup.ts` を作成（jest-dom + jsdom ポリフィル）**

Radix UI（Dialog/DropdownMenu 等）は jsdom に無い pointer/scroll API を使うため最小ポリフィルを入れる。

```ts
import "@testing-library/jest-dom/vitest";

// jsdom は以下を実装しないため Radix UI 用にポリフィルする
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
```

- [ ] **Step 9: `apps/web/src/app/App.test.tsx` を全置換（ヘッダ表示を確認）**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("ヘッダにアプリ名を表示する", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: 空 .gitkeep を削除して検証**

```bash
rm -f apps/web/src/lib/.gitkeep apps/web/src/components/ui/.gitkeep
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
npm run build -w @nas-fm/web
```
Expected: テスト PASS、typecheck 0、build 成功（Tailwind が効いた dist 生成）。

- [ ] **Step 11: コミット**

```bash
git add -A
git commit -m "feat: Web に Tailwind と shadcn/ui の基盤を導入"
```

---

### Task 2: API クライアント・エラーメッセージ・ソート（純ロジック）

**Files:**
- Create: `apps/web/src/lib/api.ts` + `api.test.ts`, `apps/web/src/lib/error-messages.ts` + `error-messages.test.ts`, `apps/web/src/features/file-list/sort.ts` + `sort.test.ts`

**Interfaces:**
- Consumes: `@nas-fm/shared` の型（`ListResponse`, `ApiErrorCode`, `FileEntry`）
- Produces:
  - `class ApiRequestError extends Error { readonly code: string }`
  - `api.list(path: string): Promise<ListResponse>` / `api.mkdir(path: string): Promise<void>` / `api.rename(from: string, to: string): Promise<void>` / `api.remove(path: string): Promise<void>` / `api.downloadUrl(path: string): string` / `api.upload(dirPath: string, file: File, opts?: { onProgress?: (pct: number) => void }): Promise<void>`
  - `errorMessage(code: string): string`
  - `type SortKey = "name" | "size" | "mtime"` / `type SortDir = "asc" | "desc"` / `sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[]`

- [ ] **Step 1: error-messages のテストを書く**

`apps/web/src/lib/error-messages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-messages";

describe("errorMessage", () => {
  it.each([
    "PATH_TRAVERSAL",
    "INVALID_REQUEST",
    "NOT_A_DIRECTORY",
    "IS_A_DIRECTORY",
    "NOT_FOUND",
    "CONFLICT",
    "INTERNAL",
  ])("%s に日本語メッセージがある", (code) => {
    const msg = errorMessage(code);
    expect(msg).toBeTruthy();
    expect(msg).not.toBe(code);
  });

  it("未知コードは汎用メッセージ", () => {
    expect(errorMessage("SOMETHING_ELSE")).toBe("エラーが発生しました");
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL（`./error-messages` が無い）

- [ ] **Step 3: `apps/web/src/lib/error-messages.ts` を実装**

```ts
import type { ApiErrorCode } from "@nas-fm/shared";

const MESSAGES: Record<ApiErrorCode, string> = {
  PATH_TRAVERSAL: "不正なパスです",
  INVALID_REQUEST: "不正な操作です",
  NOT_A_DIRECTORY: "フォルダではありません",
  IS_A_DIRECTORY: "フォルダは直接操作できません",
  NOT_FOUND: "見つかりませんでした",
  CONFLICT: "同名の項目が既に存在します",
  INTERNAL: "サーバでエラーが発生しました",
};

export function errorMessage(code: string): string {
  return MESSAGES[code as ApiErrorCode] ?? "エラーが発生しました";
}
```

- [ ] **Step 4: sort のテストを書く**

`apps/web/src/features/file-list/sort.test.ts`:
```ts
import type { FileEntry } from "@nas-fm/shared";
import { describe, expect, it } from "vitest";
import { sortEntries } from "./sort";

const entries: FileEntry[] = [
  { name: "b.txt", size: 30, mtime: 200, type: "file" },
  { name: "sub", size: 0, mtime: 100, type: "dir" },
  { name: "a.txt", size: 10, mtime: 300, type: "file" },
];

describe("sortEntries", () => {
  it("ディレクトリを常に先頭にする", () => {
    const r = sortEntries(entries, "name", "asc");
    expect(r[0].type).toBe("dir");
  });

  it("名前昇順（ディレクトリ優先）", () => {
    expect(sortEntries(entries, "name", "asc").map((e) => e.name)).toEqual(["sub", "a.txt", "b.txt"]);
  });

  it("サイズ降順でもディレクトリは先頭", () => {
    const r = sortEntries(entries, "size", "desc");
    expect(r[0].name).toBe("sub");
    expect(r.slice(1).map((e) => e.name)).toEqual(["b.txt", "a.txt"]);
  });

  it("元配列を破壊しない", () => {
    const copy = [...entries];
    sortEntries(entries, "name", "asc");
    expect(entries).toEqual(copy);
  });
});
```

- [ ] **Step 5: `apps/web/src/features/file-list/sort.ts` を実装**

```ts
import type { FileEntry } from "@nas-fm/shared";

export type SortKey = "name" | "size" | "mtime";
export type SortDir = "asc" | "desc";

export function sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    let cmp: number;
    if (key === "name") cmp = a.name.localeCompare(b.name, "ja");
    else if (key === "size") cmp = a.size - b.size;
    else cmp = a.mtime - b.mtime;
    return cmp * factor;
  });
}
```

- [ ] **Step 6: api のテストを書く**

`apps/web/src/lib/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./api";

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.list", () => {
  it("list を GET し JSON を返す", async () => {
    mockFetch(200, { path: "docs", entries: [] });
    const res = await api.list("docs");
    expect(res).toEqual({ path: "docs", entries: [] });
    expect(fetch).toHaveBeenCalledWith("/api/list?path=docs");
  });

  it("非 2xx は ApiRequestError（code 付き）を throw", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "not found" } });
    await expect(api.list("x")).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.list("x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("api.mkdir / rename / remove", () => {
  it("mkdir は JSON body で POST", async () => {
    mockFetch(201, { ok: true });
    await api.mkdir("docs/new");
    expect(fetch).toHaveBeenCalledWith(
      "/api/mkdir",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("remove は DELETE", async () => {
    mockFetch(200, { ok: true });
    await api.remove("docs/a.txt");
    expect(fetch).toHaveBeenCalledWith(
      "/api/delete?path=docs%2Fa.txt",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("api.downloadUrl", () => {
  it("パスをエンコードした download URL を返す", () => {
    expect(api.downloadUrl("docs/レポート.txt")).toBe(
      `/api/download?path=${encodeURIComponent("docs/レポート.txt")}`,
    );
  });
});
```

- [ ] **Step 7: `apps/web/src/lib/api.ts` を実装**

```ts
import type { ListResponse } from "@nas-fm/shared";

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let code = "INTERNAL";
    let message = "エラーが発生しました";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // JSON でないレスポンスは汎用エラーのままにする
    }
    throw new ApiRequestError(code, message);
  }
  return res;
}

const JSON_HEADERS = { "content-type": "application/json" };

export const api = {
  async list(path: string): Promise<ListResponse> {
    const res = await request(`/api/list?path=${encodeURIComponent(path)}`);
    return (await res.json()) as ListResponse;
  },

  async mkdir(path: string): Promise<void> {
    await request("/api/mkdir", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ path }),
    });
  },

  async rename(from: string, to: string): Promise<void> {
    await request("/api/rename", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ from, to }),
    });
  },

  async remove(path: string): Promise<void> {
    await request(`/api/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  },

  downloadUrl(path: string): string {
    return `/api/download?path=${encodeURIComponent(path)}`;
  },

  upload(
    dirPath: string,
    file: File,
    opts: { onProgress?: (pct: number) => void } = {},
  ): Promise<void> {
    const rel = dirPath ? `${dirPath}/${file.name}` : file.name;
    const url = `/api/upload?path=${encodeURIComponent(rel)}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && opts.onProgress) {
          opts.onProgress((e.loaded / e.total) * 100);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let code = "INTERNAL";
        let message = "アップロードに失敗しました";
        try {
          const body = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } };
          code = body.error?.code ?? code;
          message = body.error?.message ?? message;
        } catch {
          // 非 JSON は汎用エラー
        }
        reject(new ApiRequestError(code, message));
      });
      xhr.addEventListener("error", () => reject(new ApiRequestError("INTERNAL", "ネットワークエラー")));
      xhr.send(file);
    });
  },
};
```

- [ ] **Step 8: 全テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts apps/web/src/lib/error-messages.ts apps/web/src/lib/error-messages.test.ts apps/web/src/features/file-list/sort.ts apps/web/src/features/file-list/sort.test.ts
git commit -m "feat: Web の API クライアントとソート・エラーメッセージを追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 3: 一覧・パンくず・ソート（読み取り専用ブラウジング）

**Files:**
- Create: `apps/web/src/features/file-list/hooks/useFileList.ts`, `components/Breadcrumbs.tsx`, `components/FileTable.tsx`, `components/FileBrowser.tsx`, `index.ts`, および対応テスト
- Modify: `apps/web/src/app/App.tsx`（FileBrowser を配置）, `apps/web/src/app/App.test.tsx`

**Interfaces:**
- Consumes: `api`（`@/lib/api`）, `sortEntries`/`SortKey`/`SortDir`（`../sort`）, shared `FileEntry`
- Produces:
  - `useFileList(path: string)` → TanStack Query の結果（`data: ListResponse | undefined`, `isLoading`, `isError`, `refetch`）
  - `Breadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void })`
  - `FileTable({ entries, sortKey, sortDir, onSortChange, onOpenDir }: { entries: FileEntry[]; sortKey: SortKey; sortDir: SortDir; onSortChange: (key: SortKey) => void; onOpenDir: (name: string) => void })`
  - `FileBrowser()`（内部で現在パスを state 管理）
  - `index.ts` が `FileBrowser` を export

- [ ] **Step 1: useFileList のテストを書く**

`apps/web/src/features/file-list/hooks/useFileList.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useFileList } from "./useFileList";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useFileList", () => {
  it("指定パスの一覧を取得する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "docs", entries: [] });
    const { result } = renderHook(() => useFileList("docs"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.list).toHaveBeenCalledWith("docs");
    expect(result.current.data).toEqual({ path: "docs", entries: [] });
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL（`./useFileList` が無い）

- [ ] **Step 3: `hooks/useFileList.ts` を実装**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useFileList(path: string) {
  return useQuery({
    queryKey: ["list", path],
    queryFn: () => api.list(path),
  });
}
```

- [ ] **Step 4: Breadcrumbs のテストを書く**

`apps/web/src/features/file-list/components/Breadcrumbs.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("ルートと各階層を表示する", () => {
    render(<Breadcrumbs path="docs/2024" onNavigate={() => {}} />);
    expect(screen.getByText("ホーム")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("階層クリックでそのパスへ遷移する", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path="docs/2024" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("docs"));
    expect(onNavigate).toHaveBeenCalledWith("docs");
  });

  it("ホームクリックで空パスへ", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path="docs" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("ホーム"));
    expect(onNavigate).toHaveBeenCalledWith("");
  });
});
```

- [ ] **Step 5: `components/Breadcrumbs.tsx` を実装**

```tsx
import { Fragment } from "react";
import { Button } from "@/components/ui/button";

export function Breadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path ? path.split("/") : [];
  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="パンくず">
      <Button variant="ghost" size="sm" onClick={() => onNavigate("")}>
        ホーム
      </Button>
      {segments.map((seg, i) => {
        const target = segments.slice(0, i + 1).join("/");
        return (
          <Fragment key={target}>
            <span className="text-muted-foreground">/</span>
            <Button variant="ghost" size="sm" onClick={() => onNavigate(target)}>
              {seg}
            </Button>
          </Fragment>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 6: FileTable のテストを書く**

`apps/web/src/features/file-list/components/FileTable.test.tsx`:
```tsx
import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTable } from "./FileTable";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "a.txt", size: 12, mtime: 1700000000000, type: "file" },
];

describe("FileTable", () => {
  it("エントリ名を表示する", () => {
    render(
      <FileTable entries={entries} sortKey="name" sortDir="asc" onSortChange={() => {}} onOpenDir={() => {}} />,
    );
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("ディレクトリ名クリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    render(
      <FileTable entries={entries} sortKey="name" sortDir="asc" onSortChange={() => {}} onOpenDir={onOpenDir} />,
    );
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("名前ヘッダクリックで onSortChange('name')", async () => {
    const onSortChange = vi.fn();
    render(
      <FileTable entries={entries} sortKey="name" sortDir="asc" onSortChange={onSortChange} onOpenDir={() => {}} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前/ }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });
});
```

- [ ] **Step 7: `components/FileTable.tsx` を実装**

```tsx
import type { FileEntry } from "@nas-fm/shared";
import { File, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SortDir, SortKey } from "../sort";

function formatSize(entry: FileEntry): string {
  if (entry.type === "dir") return "—";
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 * 1024) return `${(entry.size / 1024).toFixed(1)} KB`;
  return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
}

export function FileTable({
  entries,
  sortKey,
  sortDir,
  onSortChange,
  onOpenDir,
}: {
  entries: FileEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  onOpenDir: (name: string) => void;
}) {
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("name")}>
              名前{arrow("name")}
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("size")}>
              サイズ{arrow("size")}
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("mtime")}>
              更新日時{arrow("mtime")}
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.name}>
            <TableCell>
              <span className="flex items-center gap-2">
                {entry.type === "dir" ? <Folder size={16} /> : <File size={16} />}
                {entry.type === "dir" ? (
                  <button type="button" className="hover:underline" onClick={() => onOpenDir(entry.name)}>
                    {entry.name}
                  </button>
                ) : (
                  <span>{entry.name}</span>
                )}
              </span>
            </TableCell>
            <TableCell>{formatSize(entry)}</TableCell>
            <TableCell>{new Date(entry.mtime).toLocaleString("ja-JP")}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 8: FileBrowser のテストを書く**

`apps/web/src/features/file-list/components/FileBrowser.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { FileBrowser } from "./FileBrowser";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("FileBrowser", () => {
  it("一覧を表示する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "docs", size: 0, mtime: 0, type: "dir" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
  });

  it("フォルダを開くとそのパスで再取得する", async () => {
    const list = vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [{ name: "docs", size: 0, mtime: 0, type: "dir" as const }]
          : [{ name: "inner.txt", size: 1, mtime: 0, type: "file" as const }],
    }));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    await userEvent.click(screen.getByText("docs"));
    await waitFor(() => expect(screen.getByText("inner.txt")).toBeInTheDocument());
    expect(list).toHaveBeenCalledWith("docs");
  });

  it("取得失敗時にエラーと再試行を表示する", async () => {
    vi.spyOn(api, "list").mockRejectedValue(new Error("boom"));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText(/読み込みに失敗/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: `components/FileBrowser.tsx` を実装**

```tsx
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFileList } from "../hooks/useFileList";
import { type SortKey, sortEntries, type SortDir } from "../sort";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileTable } from "./FileTable";

export function FileBrowser() {
  const [path, setPath] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { data, isLoading, isError, refetch } = useFileList(path);

  const sorted = useMemo(
    () => (data ? sortEntries(data.entries, sortKey, sortDir) : []),
    [data, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openDir(name: string) {
    setPath(path ? `${path}/${name}` : name);
  }

  return (
    <div className="space-y-4">
      <Breadcrumbs path={path} onNavigate={setPath} />
      {isLoading && <p className="text-muted-foreground">読み込み中…</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-destructive">一覧の読み込みに失敗しました。</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            再試行
          </Button>
        </div>
      )}
      {data && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 10: `features/file-list/index.ts` を作成し App に配置**

`apps/web/src/features/file-list/index.ts`:
```ts
export { FileBrowser } from "./components/FileBrowser";
```

`apps/web/src/app/App.tsx` の `<main className="p-6" />` を置換:
```tsx
        <main className="p-6">
          <FileBrowser />
        </main>
```
`App.tsx` 冒頭に import 追加:
```tsx
import { FileBrowser } from "@/features/file-list";
```

`apps/web/src/app/App.test.tsx` を更新（App が list を呼ぶのでモックする）:
```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

describe("App", () => {
  it("ヘッダにアプリ名を表示する", () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    render(<App />);
    expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: 検証してコミット**

```bash
rm -f apps/web/src/features/file-list/.gitkeep
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add -A
git commit -m "feat: ファイル一覧・パンくず・ソートを追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 4: ダウンロードと行アクション（DropdownMenu）

**Files:**
- Create: `apps/web/src/features/file-list/components/RowActions.tsx` + `RowActions.test.tsx`
- Modify: `apps/web/src/features/file-list/components/FileTable.tsx`（各行に RowActions 列を追加）

**Interfaces:**
- Consumes: `api.downloadUrl`（`@/lib/api`）, shared `FileEntry`
- Produces: `RowActions({ entry, path, onRename, onDelete }: { entry: FileEntry; path: string; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void })`（`onRename`/`onDelete` は Task 5 で接続。本タスクはダウンロードのみ機能）

- [ ] **Step 1: RowActions のテストを書く**

`apps/web/src/features/file-list/components/RowActions.test.tsx`:
```tsx
import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RowActions } from "./RowActions";

const file: FileEntry = { name: "a.txt", size: 1, mtime: 0, type: "file" };

describe("RowActions", () => {
  it("ファイルにダウンロードリンク（正しい href）を出す", () => {
    render(<RowActions entry={file} path="docs" onRename={() => {}} onDelete={() => {}} />);
    const link = screen.getByRole("link", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.txt")}`);
    expect(link).toHaveAttribute("download");
  });

  it("ディレクトリにはダウンロードリンクを出さない", () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(<RowActions entry={dir} path="" onRename={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole("link", { name: /ダウンロード/ })).toBeNull();
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL（`./RowActions` が無い）

- [ ] **Step 3: `components/RowActions.tsx` を実装**

ダウンロードリンクは DropdownMenu を開かなくても検証できるよう、メニュー外の要素としても機能する `<a>` を含める。ここでは shadcn の `DropdownMenu` にダウンロード/リネーム/削除を並べる。ダウンロードは `asChild` で `<a>` を使う。

```tsx
import type { FileEntry } from "@nas-fm/shared";
import { Download, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

export function RowActions({
  entry,
  path,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  path: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  const rel = path ? `${path}/${entry.name}` : entry.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="操作メニュー">
          <MoreVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entry.type === "file" && (
          <DropdownMenuItem asChild>
            <a href={api.downloadUrl(rel)} download>
              <Download size={16} className="mr-2" />
              ダウンロード
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onRename(entry)}>
          <Pencil size={16} className="mr-2" />
          名前を変更
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(entry)}>
          <Trash2 size={16} className="mr-2" />
          削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

※ jsdom では DropdownMenu の中身は開かないと DOM に出ないことがあるが、`DropdownMenuItem asChild` の `<a>` は Radix が常にレンダリングするか閉時は portal 未マウントの場合がある。テストが `link` を見つけられない場合は、ダウンロードリンクを RowActions 直下（メニュー外）にも小さく置く方式へ切り替えてよい。まずは上記で試し、テストが赤ければメニューを開く操作（`userEvent.click(getByLabelText("操作メニュー"))`）をテストに足す。

- [ ] **Step 4: FileTable に操作列を追加**

`FileTable.tsx` の props に `path`・`onRename`・`onDelete` を追加し、各行末尾に `RowActions` 列を足す。ヘッダに空の `<TableHead />` を1つ追加。変更後の props 型と行末:

props 型を更新:
```tsx
export function FileTable({
  entries,
  sortKey,
  sortDir,
  onSortChange,
  onOpenDir,
  path,
  onRename,
  onDelete,
}: {
  entries: FileEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  onOpenDir: (name: string) => void;
  path: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
```
ヘッダ行末に追加:
```tsx
          <TableHead className="w-12" />
```
各 `TableRow` の末尾（更新日時セルの後）に追加:
```tsx
            <TableCell>
              <RowActions entry={entry} path={path} onRename={onRename} onDelete={onDelete} />
            </TableCell>
```
`FileTable.tsx` 冒頭に import 追加:
```tsx
import { RowActions } from "./RowActions";
```

- [ ] **Step 5: FileBrowser から新 props を渡す（onRename/onDelete は暫定 no-op）**

`FileBrowser.tsx` の `<FileTable .../>` に props を追加（Task 5 でダイアログに接続するため、暫定で空関数）:
```tsx
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          path={path}
          onRename={() => {}}
          onDelete={() => {}}
        />
```

既存の `FileTable.test.tsx` の呼び出しにも `path`・`onRename`・`onDelete` を追加（型エラー回避）:
```tsx
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={() => {}}
        path=""
        onRename={() => {}}
        onDelete={() => {}}
      />
```
（3箇所すべてに追加する）

- [ ] **Step 6: 検証してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add -A
git commit -m "feat: 行アクションとダウンロードを追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 5: フォルダ作成・リネーム・削除（mutations + ダイアログ）

**Files:**
- Create: `apps/web/src/features/file-list/hooks/useFileMutations.ts` + test, `dialogs/MkdirDialog.tsx`, `dialogs/RenameDialog.tsx`, `dialogs/DeleteDialog.tsx` + tests
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`（ダイアログ状態・新規フォルダボタン・RowActions 接続）

**Interfaces:**
- Consumes: `api`（mkdir/rename/remove）, `errorMessage`（`@/lib/error-messages`）, `ApiRequestError`, `toast`（sonner）
- Produces:
  - `useFileMutations(path: string)` → `{ mkdir, rename, remove }`（各 `useMutation`。成功で `invalidateQueries(["list", path])` + 成功トースト、失敗で `errorMessage(code)` のエラートースト）。`mkdir.mutate(name)`, `rename.mutate({ from, to })`, `remove.mutate(target)`
  - `MkdirDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (name: string) => void })`
  - `RenameDialog({ open, onOpenChange, currentName, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; currentName: string; onSubmit: (newName: string) => void })`
  - `DeleteDialog({ open, onOpenChange, targetName, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; targetName: string; onConfirm: () => void })`

- [ ] **Step 1: useFileMutations のテストを書く**

`apps/web/src/features/file-list/hooks/useFileMutations.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api";
import { useFileMutations } from "./useFileMutations";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useFileMutations", () => {
  it("mkdir は現在パス配下に作成し成功トーストを出す", async () => {
    const mkdir = vi.spyOn(api, "mkdir").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.mkdir.mutate("new");
    await waitFor(() => expect(mkdir).toHaveBeenCalledWith("docs/new"));
    await waitFor(() => expect(success).toHaveBeenCalled());
  });

  it("失敗時は code に応じたエラートーストを出す", async () => {
    vi.spyOn(api, "mkdir").mockRejectedValue(new ApiRequestError("CONFLICT", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations(""), { wrapper });
    result.current.mkdir.mutate("dup");
    await waitFor(() => expect(error).toHaveBeenCalledWith("同名の項目が既に存在します"));
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL（`./useFileMutations` が無い）

- [ ] **Step 3: `hooks/useFileMutations.ts` を実装**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

function toastError(err: unknown): void {
  const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
  toast.error(errorMessage(code));
}

export function useFileMutations(path: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["list", path] });
  const join = (name: string) => (path ? `${path}/${name}` : name);

  const mkdir = useMutation({
    mutationFn: (name: string) => api.mkdir(join(name)),
    onSuccess: () => {
      invalidate();
      toast.success("フォルダを作成しました");
    },
    onError: toastError,
  });

  const rename = useMutation({
    mutationFn: (v: { from: string; to: string }) => api.rename(v.from, v.to),
    onSuccess: () => {
      invalidate();
      toast.success("名前を変更しました");
    },
    onError: toastError,
  });

  const remove = useMutation({
    mutationFn: (target: string) => api.remove(target),
    onSuccess: () => {
      invalidate();
      toast.success("削除しました");
    },
    onError: toastError,
  });

  return { mkdir, rename, remove };
}
```

- [ ] **Step 4: ダイアログのテストを書く**

`apps/web/src/features/file-list/dialogs/MkdirDialog.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MkdirDialog } from "./MkdirDialog";

describe("MkdirDialog", () => {
  it("入力して作成すると onSubmit に名前を渡す", async () => {
    const onSubmit = vi.fn();
    render(<MkdirDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("フォルダ名"), "photos");
    await userEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(onSubmit).toHaveBeenCalledWith("photos");
  });

  it("空名では onSubmit を呼ばない", async () => {
    const onSubmit = vi.fn();
    render(<MkdirDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

`apps/web/src/features/file-list/dialogs/DeleteDialog.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";

describe("DeleteDialog", () => {
  it("削除確認で onConfirm を呼ぶ", async () => {
    const onConfirm = vi.fn();
    render(<DeleteDialog open onOpenChange={() => {}} targetName="a.txt" onConfirm={onConfirm} />);
    expect(screen.getByText(/a\.txt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: ダイアログ3種を実装**

`apps/web/src/features/file-list/dialogs/MkdirDialog.tsx`:
```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MkdirDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setName("");
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新しいフォルダ</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="mkdir-name">フォルダ名</Label>
          <Input id="mkdir-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={submit}>作成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
※ `Label` が未追加なら `npx shadcn@latest add label --yes` を実行（`apps/web` で）。

`apps/web/src/features/file-list/dialogs/RenameDialog.tsx`:
```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RenameDialog({
  open,
  onOpenChange,
  currentName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentName: string;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  useEffect(() => setName(currentName), [currentName]);
  function submit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === currentName) {
      onOpenChange(false);
      return;
    }
    onSubmit(trimmed);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>名前を変更</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-name">新しい名前</Label>
          <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={submit}>変更</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/file-list/dialogs/DeleteDialog.tsx`:
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

export function DeleteDialog({
  open,
  onOpenChange,
  targetName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetName: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>削除の確認</AlertDialogTitle>
          <AlertDialogDescription>
            「{targetName}」を削除します。フォルダの場合は中身ごと削除されます。この操作は取り消せません。
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

- [ ] **Step 6: FileBrowser にダイアログ状態・新規フォルダボタン・接続を追加**

`FileBrowser.tsx` を更新（mutations とダイアログ state を追加、RowActions のコールバックを接続）:
```tsx
import { useMemo, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFileList } from "../hooks/useFileList";
import { useFileMutations } from "../hooks/useFileMutations";
import { type SortDir, type SortKey, sortEntries } from "../sort";
import { MkdirDialog } from "../dialogs/MkdirDialog";
import { RenameDialog } from "../dialogs/RenameDialog";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileTable } from "./FileTable";

export function FileBrowser() {
  const [path, setPath] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const { data, isLoading, isError, refetch } = useFileList(path);
  const { mkdir, rename, remove } = useFileMutations(path);

  const sorted = useMemo(
    () => (data ? sortEntries(data.entries, sortKey, sortDir) : []),
    [data, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  function openDir(name: string) {
    setPath(path ? `${path}/${name}` : name);
  }
  const rel = (name: string) => (path ? `${path}/${name}` : name);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Breadcrumbs path={path} onNavigate={setPath} />
        <Button size="sm" onClick={() => setMkdirOpen(true)}>
          <FolderPlus size={16} className="mr-2" />
          新しいフォルダ
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">読み込み中…</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-destructive">一覧の読み込みに失敗しました。</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            再試行
          </Button>
        </div>
      )}
      {data && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          path={path}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
        />
      )}

      <MkdirDialog open={mkdirOpen} onOpenChange={setMkdirOpen} onSubmit={(name) => mkdir.mutate(name)} />
      <RenameDialog
        open={renameTarget !== null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        currentName={renameTarget?.name ?? ""}
        onSubmit={(newName) => {
          if (renameTarget) rename.mutate({ from: rel(renameTarget.name), to: rel(newName) });
          setRenameTarget(null);
        }}
      />
      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        targetName={deleteTarget?.name ?? ""}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(rel(deleteTarget.name));
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 7: 検証してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add -A
git commit -m "feat: フォルダ作成・リネーム・削除のダイアログと操作を追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 6: アップロード（D&D + 進捗）

**Files:**
- Create: `apps/web/src/features/upload/hooks/useUpload.ts` + test, `components/UploadDropzone.tsx` + test, `index.ts`
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`（ドロップゾーンを配置）

**Interfaces:**
- Consumes: `api.upload`（`@/lib/api`）, `errorMessage`, `toast`, shadcn `Progress`/`Card`
- Produces:
  - `useUpload(path: string)` → `{ upload: (file: File) => Promise<void>; progress: number | null; isUploading: boolean }`
  - `UploadDropzone({ path }: { path: string })`
  - `features/upload/index.ts` が `UploadDropzone` を export

- [ ] **Step 1: useUpload のテストを書く**

`apps/web/src/features/upload/hooks/useUpload.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUpload } from "./useUpload";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useUpload", () => {
  it("アップロード成功で成功トーストを出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const { result } = renderHook(() => useUpload("docs"), { wrapper });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(api.upload).toHaveBeenCalledWith("docs", expect.any(File), expect.any(Object));
    expect(success).toHaveBeenCalled();
  });

  it("失敗でエラートーストを出す", async () => {
    vi.spyOn(api, "upload").mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useUpload(""), { wrapper });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL（`./useUpload` が無い）

- [ ] **Step 3: `hooks/useUpload.ts` を実装**

```ts
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

export function useUpload(path: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setProgress(0);
      try {
        await api.upload(path, file, { onProgress: setProgress });
        toast.success(`${file.name} をアップロードしました`);
        qc.invalidateQueries({ queryKey: ["list", path] });
      } catch (err) {
        const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
        toast.error(errorMessage(code));
      } finally {
        setProgress(null);
      }
    },
    [path, qc],
  );

  return { upload, progress, isUploading: progress !== null };
}
```

- [ ] **Step 4: UploadDropzone のテストを書く**

`apps/web/src/features/upload/components/UploadDropzone.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { UploadDropzone } from "./UploadDropzone";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("UploadDropzone", () => {
  it("ファイル選択で api.upload を現在パスで呼ぶ", async () => {
    const upload = vi.spyOn(api, "upload").mockResolvedValue();
    renderWithClient(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(upload).toHaveBeenCalledWith("docs", expect.any(File), expect.any(Object));
  });
});
```

- [ ] **Step 5: `components/UploadDropzone.tsx` を実装**

```tsx
import { type DragEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useUpload } from "../hooks/useUpload";

export function UploadDropzone({ path }: { path: string }) {
  const { upload, progress, isUploading } = useUpload(path);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      await upload(file);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <Card
      className={`flex cursor-pointer flex-col items-center gap-2 border-dashed p-6 text-center ${dragOver ? "bg-accent" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Upload size={20} />
      <p className="text-sm text-muted-foreground">
        ここにドラッグ＆ドロップ、またはクリックしてアップロード
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="upload-input"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {isUploading && progress !== null && <Progress value={progress} className="w-full" />}
    </Card>
  );
}
```

- [ ] **Step 6: `features/upload/index.ts` を作成し FileBrowser に配置**

`apps/web/src/features/upload/index.ts`:
```ts
export { UploadDropzone } from "./components/UploadDropzone";
```

`FileBrowser.tsx` に import と配置を追加（`Breadcrumbs` 行の下、テーブルの上あたり）:
```tsx
import { UploadDropzone } from "@/features/upload";
```
`{data && (`ブロックの直前に:
```tsx
      <UploadDropzone path={path} />
```

- [ ] **Step 7: 検証してコミット**

```bash
rm -f apps/web/src/features/upload/.gitkeep
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add -A
git commit -m "feat: ドラッグ&ドロップのアップロードと進捗表示を追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 7: 全体検証・実疎通・ロードマップ更新

**Files:**
- Modify: `docs/roadmap.md`（Phase 3 チェック更新）

- [ ] **Step 1: ルートで全チェック**

```bash
npm run typecheck && npm run test && npm run lint && npm run fmt:check && npm run build
```
Expected: すべて成功（server の既存テスト + web の新規テスト、build で `apps/web/dist` 生成）。`fmt:check` が差分を出したら `npm run fmt` して再確認。

- [ ] **Step 2: dev で実疎通（手動・任意）**

`npm run dev` で web + server を起動し、ブラウザで `http://localhost:5173` を開く。`.dev-share` を NAS_ROOT として、フォルダ作成→アップロード→一覧表示→ダウンロード→リネーム→削除が UI から一通り動くことを確認する。確認後サーバを停止。

（この手順は環境依存のため、CI 的検証は Step 1 のテストで担保。実施できない場合はスキップ可。）

- [ ] **Step 3: `docs/roadmap.md` の Phase 3 を更新**

Phase 3 セクションの各 `- [ ]` を対応するものは `- [x]` に変更する。`auth` feature のログイン画面は Phase 2 に依存するため `- [ ]` のまま残し、行末に「（Phase 2 実装後）」と注記する。

- [ ] **Step 4: コミット**

```bash
git add docs/roadmap.md
git commit -m "chore: Phase 3 UI 完了に合わせてロードマップを更新"
```

---

## Self-Review（実施済み）

**1. Spec coverage:** 設計 spec の各項目→タスク対応 — スタック/セットアップ(T1) / API クライアント(T2) / features 構成(T1-T6) / 一覧・パンくず・ソート(T3) / ダウンロード・行アクション(T4) / mkdir・rename・delete + ダイアログ(T5) / アップロード D&D・進捗(T6) / TanStack Query 無効化再取得(T3,T5,T6) / エラーコード→日本語トースト(T2,T5,T6) / テスト方針(全タスク) / 認証除外(非ゴール順守)。ギャップなし。

**2. Placeholder scan:** TBD/TODO なし。全コードステップに実コードを記載。shadcn 生成物のみ CLI に委譲（プロジェクト独自ファイルは全て明記）。

**3. Type consistency:** `api`（list/mkdir/rename/remove/downloadUrl/upload）・`ApiRequestError.code`・`errorMessage(code)`・`sortEntries(entries,key,dir)`/`SortKey`/`SortDir`・`useFileList`/`useFileMutations`（mkdir.mutate(name)/rename.mutate({from,to})/remove.mutate(target)）・`useUpload`（upload/progress/isUploading）・各コンポーネント props を全タスク間で照合。`FileTable` の props 拡張（T4 で path/onRename/onDelete 追加）は T3 の呼び出し3箇所（本体+テスト2）を T4 Step 5 で更新済み。整合。

**注記（リスク）:** shadcn CLI（init/add）はネットワーク＋対話的要素があり、alias 解決（tsconfig paths）と min-release-age で詰まる可能性がある。T1 に回避策（tsconfig.json への paths 追加、フラグ指定、3日以上経過版の明示）を記載済み。Radix UI の jsdom 動作は setup.ts のポリフィルで担保、DropdownMenu 内リンクのテストが不安定な場合の代替も T4 に明記。
