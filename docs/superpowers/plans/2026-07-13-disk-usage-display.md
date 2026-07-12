# ディスク使用量表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ヘッダーに NAS 共有ディスクの空き/使用容量（`df` 相当）を常時表示し、90% 以上の使用率で警告色にする。

**Architecture:** サーバに `node:fs/promises` の `statfs` を使う新規 feature `disk-usage` を追加し `GET /api/disk-usage` を生やす。フロントは対応する新規 feature `disk-usage` で React Query フックとバッジコンポーネントを実装し、`App.tsx` の `Header` に配線する。アップロード/削除成功時に該当クエリを invalidate して値を追従させる。

**Tech Stack:** Hono（サーバ）、React + `@tanstack/react-query`（フロント）、Vitest + Testing Library。既存依存のみで完結（新規パッケージ追加なし）。

## Global Constraints

- 対象 spec: `docs/superpowers/specs/2026-07-13-disk-usage-display-design.md`
- Node は `>=24.18.0`（`node:fs/promises` の `statfs` は標準で利用可能）
- 新規依存は追加しない
- feature 間の import は各 feature の `index.ts` 経由のみ（`.claude/rules/features.md`）
- 型のみの import/export は `import type` / `export type`（`verbatimModuleSyntax: true`、`.claude/rules/typescript.md`）
- server は feature ごとに `<name>.routes.ts` / `<name>.service.ts` をまとめる
- コミットメッセージは Conventional Commits（接頭辞は英語、本文は日本語）
- `statfs` 失敗時はハンドラ個別の try/catch をせず、既存の `app.onError` の `INTERNAL`/500 フォールバックに任せる

---

### Task 1: shared に `DiskUsageResponse` 型を追加

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `DiskUsageResponse { total: number; used: number; free: number }`（`packages/shared` からの named export）

- [ ] **Step 1: `packages/shared/src/types.ts` の末尾に型を追加**

`packages/shared/src/types.ts` の末尾（`AuthStatus` の後）に追記:

```ts
export interface DiskUsageResponse {
  total: number;
  used: number;
  free: number;
}
```

- [ ] **Step 2: `packages/shared/src/index.ts` の export type 一覧に追加**

`packages/shared/src/index.ts` の1行目〜11行目の `export type { ... } from "./types";` ブロックに `DiskUsageResponse` を追加（アルファベット順、既存の並びに合わせる）:

```ts
export type {
  ApiError,
  ApiErrorCode,
  AuthStatus,
  DiskUsageResponse,
  FileEntry,
  FileType,
  ListResponse,
  LoginRequest,
  MkdirRequest,
  OkResponse,
  RenameRequest,
} from "./types";
```

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `npm run typecheck -w @nas-fm/shared`
Expected: エラーなし（`@nas-fm/shared` はソース参照でビルド不要）

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat: DiskUsageResponse型を追加

EOF
)"
```

---

### Task 2: サーバ `disk-usage.service.ts` — `getDiskUsage`

**Files:**
- Create: `apps/server/src/features/disk-usage/disk-usage.service.ts`
- Test: `apps/server/src/features/disk-usage/disk-usage.service.test.ts`

**Interfaces:**
- Consumes: `DiskUsageResponse`（Task 1、`@nas-fm/shared`）
- Produces: `getDiskUsage(root: string): Promise<DiskUsageResponse>`（Task 3 が消費）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/disk-usage/disk-usage.service.test.ts` を新規作成:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDiskUsage } from "./disk-usage.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-disk-usage-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("getDiskUsage", () => {
  it("total/used/free が整合する値を返す", async () => {
    const result = await getDiskUsage(root);
    expect(result.total).toBeGreaterThan(0);
    expect(result.free).toBeGreaterThanOrEqual(0);
    expect(result.used).toBeGreaterThanOrEqual(0);
    expect(result.used + result.free).toBe(result.total);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- disk-usage.service`
Expected: FAIL（`disk-usage.service` モジュールが存在しない）

- [ ] **Step 3: 最小実装を書く**

`apps/server/src/features/disk-usage/disk-usage.service.ts` を新規作成:

```ts
import fs from "node:fs/promises";
import type { DiskUsageResponse } from "@nas-fm/shared";

export async function getDiskUsage(root: string): Promise<DiskUsageResponse> {
  const stat = await fs.statfs(root);
  const total = stat.blocks * stat.bsize;
  // bavail: 一般ユーザーが実際に書き込める空き容量（root 予約分を除く）。df の Available と同じ考え方。
  const free = stat.bavail * stat.bsize;
  const used = total - free;
  return { total, used, free };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- disk-usage.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/features/disk-usage/disk-usage.service.ts apps/server/src/features/disk-usage/disk-usage.service.test.ts
git commit -m "$(cat <<'EOF'
feat: statfsでディスク使用量を取得するgetDiskUsageを追加

EOF
)"
```

---

### Task 3: サーバ `disk-usage.routes.ts` と `app.ts` への配線

**Files:**
- Create: `apps/server/src/features/disk-usage/disk-usage.routes.ts`
- Test: `apps/server/src/features/disk-usage/disk-usage.routes.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `getDiskUsage(root: string): Promise<DiskUsageResponse>`（Task 2）
- Produces: `createDiskUsageRoutes(root: string): Hono`（`app.ts` が消費）、エンドポイント `GET /api/disk-usage`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/disk-usage/disk-usage.routes.test.ts` を新規作成:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiskUsageResponse } from "@nas-fm/shared";
import { createApp } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";

let root: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-disk-usage-routes-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

describe("GET /api/disk-usage", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/disk-usage");
    expect(res.status).toBe(401);
  });

  it("認証済みは 200 + total/used/free", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/disk-usage", withAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiskUsageResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.used + body.free).toBe(body.total);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- disk-usage.routes`
Expected: FAIL（`/api/disk-usage` が未定義のため 404、または `disk-usage.routes` モジュールが存在せずインポートエラー）

- [ ] **Step 3: ルートを実装**

`apps/server/src/features/disk-usage/disk-usage.routes.ts` を新規作成:

```ts
import { Hono } from "hono";
import type { DiskUsageResponse } from "@nas-fm/shared";
import { getDiskUsage } from "./disk-usage.service";

export function createDiskUsageRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/disk-usage", async (c) => {
    const res: DiskUsageResponse = await getDiskUsage(root);
    return c.json(res);
  });

  return app;
}
```

- [ ] **Step 4: `app.ts` に配線**

`apps/server/src/app.ts` の import ブロック（`createFilesRoutes` の import の直後）に追加:

```ts
import { createDiskUsageRoutes } from "./features/disk-usage/disk-usage.routes";
```

`apps/server/src/app.ts` の `app.route("/api", createFilesRoutes(root));` の直後に追加:

```ts
  app.route("/api", createDiskUsageRoutes(root));
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- disk-usage.routes`
Expected: PASS

- [ ] **Step 6: サーバ全体のテストと型チェックが通ることを確認**

Run: `npm run test -w @nas-fm/server && npm run typecheck -w @nas-fm/server`
Expected: PASS（既存テストに影響がないこと）

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/features/disk-usage/disk-usage.routes.ts apps/server/src/features/disk-usage/disk-usage.routes.test.ts apps/server/src/app.ts
git commit -m "$(cat <<'EOF'
feat: GET /api/disk-usage エンドポイントを追加

EOF
)"
```

---

### Task 4: フロント `api.diskUsage()`

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `DiskUsageResponse`（Task 1、`@nas-fm/shared`）、既存の `request()` ヘルパー（`apps/web/src/lib/api.ts` 内、認証エラー等を `ApiRequestError` に変換する）
- Produces: `api.diskUsage(): Promise<DiskUsageResponse>`（Task 5 が消費）

- [ ] **Step 1: import に型を追加**

`apps/web/src/lib/api.ts` の1行目を変更:

```ts
import type { AuthStatus, DiskUsageResponse, ListResponse } from "@nas-fm/shared";
```

- [ ] **Step 2: `diskUsage` メソッドを追加**

`apps/web/src/lib/api.ts` の `me` メソッド定義の直後（`async me(): Promise<AuthStatus> { ... },` の後）に追加:

```ts
  async diskUsage(): Promise<DiskUsageResponse> {
    const res = await request("/api/disk-usage");
    return (await res.json()) as DiskUsageResponse;
  },
```

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat: api.diskUsage()を追加

EOF
)"
```

---

### Task 5: フロント `useDiskUsage` フック

**Files:**
- Create: `apps/web/src/features/disk-usage/hooks/useDiskUsage.ts`
- Test: `apps/web/src/features/disk-usage/hooks/useDiskUsage.test.tsx`

**Interfaces:**
- Consumes: `api.diskUsage(): Promise<DiskUsageResponse>`（Task 4）
- Produces: `useDiskUsage()`（React Query の `UseQueryResult<DiskUsageResponse>`、queryKey `["disk-usage"]`。Task 6 が消費）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/disk-usage/hooks/useDiskUsage.test.tsx` を新規作成:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useDiskUsage } from "./useDiskUsage";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useDiskUsage", () => {
  it("ディスク使用量を取得する", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({ total: 100, used: 40, free: 60 });
    const { result } = renderHook(() => useDiskUsage(), { wrapper });
    await waitFor(() =>
      expect(result.current.data).toEqual({ total: 100, used: 40, free: 60 }),
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- useDiskUsage`
Expected: FAIL（`useDiskUsage` モジュールが存在しない）

- [ ] **Step 3: 最小実装を書く**

`apps/web/src/features/disk-usage/hooks/useDiskUsage.ts` を新規作成:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useDiskUsage() {
  return useQuery({
    queryKey: ["disk-usage"],
    queryFn: () => api.diskUsage(),
    retry: false,
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- useDiskUsage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/disk-usage/hooks/useDiskUsage.ts apps/web/src/features/disk-usage/hooks/useDiskUsage.test.tsx
git commit -m "$(cat <<'EOF'
feat: useDiskUsageフックを追加

EOF
)"
```

---

### Task 6: フロント `DiskUsageBadge` コンポーネントと feature の公開境界

**Files:**
- Create: `apps/web/src/features/disk-usage/components/DiskUsageBadge.tsx`
- Test: `apps/web/src/features/disk-usage/components/DiskUsageBadge.test.tsx`
- Create: `apps/web/src/features/disk-usage/index.ts`

**Interfaces:**
- Consumes: `useDiskUsage()`（Task 5）
- Produces: `DiskUsageBadge`（React コンポーネント。Task 7 が `@/features/disk-usage` 経由で消費）。`useDiskUsage` も `index.ts` から再エクスポートする（feature の公開境界の慣例上、`auth` feature が `useAuth` を公開しているのに合わせる）。Task 8/9 は `["disk-usage"]` という queryKey 文字列リテラルを直接使うのみで、`useDiskUsage` 自体は消費しない（既存の `["list", path]` / `["me"]` も同様にリテラルを都度書く慣例に合わせる）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/disk-usage/components/DiskUsageBadge.test.tsx` を新規作成:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { DiskUsageBadge } from "./DiskUsageBadge";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("DiskUsageBadge", () => {
  it("データ取得前は何も描画しない", () => {
    vi.spyOn(api, "diskUsage").mockImplementation(() => new Promise(() => {}));
    const { container } = render(<DiskUsageBadge />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("使用率90%未満は通常色で GB 表示する", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 50 * 1024 ** 3,
      free: 50 * 1024 ** 3,
    });
    render(<DiskUsageBadge />, { wrapper });
    const el = await screen.findByText("50.0GB / 100.0GB");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-destructive");
  });

  it("使用率90%以上は警告色になる", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 95 * 1024 ** 3,
      free: 5 * 1024 ** 3,
    });
    render(<DiskUsageBadge />, { wrapper });
    const el = await screen.findByText("95.0GB / 100.0GB");
    expect(el.className).toContain("text-destructive");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- DiskUsageBadge`
Expected: FAIL（`DiskUsageBadge` モジュールが存在しない）

- [ ] **Step 3: 最小実装を書く**

`apps/web/src/features/disk-usage/components/DiskUsageBadge.tsx` を新規作成:

```tsx
import { useDiskUsage } from "../hooks/useDiskUsage";

function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export function DiskUsageBadge() {
  const { data } = useDiskUsage();
  if (!data) return null;

  const ratio = data.used / data.total;
  const className = ratio >= 0.9 ? "text-destructive" : "text-muted-foreground";

  return (
    <span className={`text-sm ${className}`}>
      {formatGB(data.used)} / {formatGB(data.total)}
    </span>
  );
}
```

- [ ] **Step 4: `index.ts` を新規作成**

`apps/web/src/features/disk-usage/index.ts` を新規作成:

```ts
export { DiskUsageBadge } from "./components/DiskUsageBadge";
export { useDiskUsage } from "./hooks/useDiskUsage";
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- DiskUsageBadge`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/disk-usage/components/DiskUsageBadge.tsx apps/web/src/features/disk-usage/components/DiskUsageBadge.test.tsx apps/web/src/features/disk-usage/index.ts
git commit -m "$(cat <<'EOF'
feat: DiskUsageBadgeコンポーネントを追加

EOF
)"
```

---

### Task 7: `App.tsx` の `Header` に配線

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/App.test.tsx`

**Interfaces:**
- Consumes: `DiskUsageBadge`（Task 6、`@/features/disk-usage` 経由）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/app/App.test.tsx` の3つ目のテスト（`"認証済みでは一覧（ログアウト）を表示する"`）を以下のように変更（`api.diskUsage` のモックと表示アサーションを追加）:

```tsx
  it("認証済みでは一覧（ログアウト）とディスク使用量を表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: true });
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 50 * 1024 ** 3,
      free: 50 * 1024 ** 3,
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument(),
    );
    expect(screen.getByText("50.0GB / 100.0GB")).toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- App.test`
Expected: FAIL（`DiskUsageBadge` が未配線のため `"50.0GB / 100.0GB"` が見つからない）

- [ ] **Step 3: `App.tsx` に配線**

`apps/web/src/app/App.tsx` を全体置き換え:

```tsx
import { AuthGate, LogoutButton, useAuth } from "@/features/auth";
import { DiskUsageBadge } from "@/features/disk-usage";
import { FileBrowser } from "@/features/file-list";
import { Providers } from "./providers";

function Header() {
  const { data } = useAuth();
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <h1 className="text-xl font-semibold">NAS-FileManager</h1>
      <div className="flex items-center gap-4">
        {data?.authenticated && <DiskUsageBadge />}
        {data?.authenticated && <LogoutButton />}
      </div>
    </header>
  );
}

export function App() {
  return (
    <Providers>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="p-6">
          <AuthGate>
            <FileBrowser />
          </AuthGate>
        </main>
      </div>
    </Providers>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- App.test`
Expected: PASS

- [ ] **Step 5: Web の全テストと型チェックが通ることを確認**

Run: `npm run test -w @nas-fm/web && npm run typecheck -w @nas-fm/web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/App.tsx apps/web/src/app/App.test.tsx
git commit -m "$(cat <<'EOF'
feat: ヘッダーにディスク使用量バッジを表示する

EOF
)"
```

---

### Task 8: アップロード成功時に disk-usage を再取得

**Files:**
- Modify: `apps/web/src/features/upload/hooks/useUpload.ts`
- Modify: `apps/web/src/features/upload/hooks/useUpload.test.tsx`

**Interfaces:**
- Consumes: なし（React Query の `queryKey: ["disk-usage"]` は Task 5 で定義済み。文字列キーとして参照するのみで型的な依存はない）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/upload/hooks/useUpload.test.tsx` の `describe("useUpload", ...)` ブロック内に以下のテストを追加（末尾のテストの後、`});` の直前）:

```tsx
  it("アップロード成功で disk-usage も再取得する", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpload("docs"), { wrapper: wrapperWithClient(client) });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["disk-usage"] });
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- useUpload`
Expected: FAIL（`["disk-usage"]` の invalidate が呼ばれていない）

- [ ] **Step 3: 実装を変更**

`apps/web/src/features/upload/hooks/useUpload.ts` の26〜28行目付近、`try` ブロック内の `qc.invalidateQueries({ queryKey: ["list", path] });` の直後に1行追加:

```ts
        await api.upload(path, file, { onProgress: setProgress });
        toast.success(`${file.name} をアップロードしました`);
        qc.invalidateQueries({ queryKey: ["list", path] });
        qc.invalidateQueries({ queryKey: ["disk-usage"] });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- useUpload`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/upload/hooks/useUpload.ts apps/web/src/features/upload/hooks/useUpload.test.tsx
git commit -m "$(cat <<'EOF'
feat: アップロード成功時にディスク使用量を再取得する

EOF
)"
```

---

### Task 9: 削除成功時に disk-usage を再取得

**Files:**
- Modify: `apps/web/src/features/file-list/hooks/useFileMutations.ts`
- Modify: `apps/web/src/features/file-list/hooks/useFileMutations.test.tsx`

**Interfaces:**
- Consumes: なし（Task 8 と同様、`queryKey: ["disk-usage"]` を文字列として参照するのみ）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/hooks/useFileMutations.test.tsx` の `describe("useFileMutations", ...)` ブロック内、既存の3つ目のテスト（`"失敗時も一覧を再取得し古い表示を修復する"`）の後に追加:

```tsx
  it("削除成功時に disk-usage も再取得する", async () => {
    vi.spyOn(api, "remove").mockResolvedValue();
    vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations("docs"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    result.current.remove.mutate("docs/gone.txt");
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["disk-usage"] }),
    );
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- useFileMutations`
Expected: FAIL（`["disk-usage"]` の invalidate が呼ばれていない）

- [ ] **Step 3: 実装を変更**

`apps/web/src/features/file-list/hooks/useFileMutations.ts` の `remove` の定義（39〜46行目）を変更:

```ts
  const remove = useMutation({
    mutationFn: (target: string) => api.remove(target),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      toast.success("削除しました");
    },
    onError: onErrorAndRefresh,
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- useFileMutations`
Expected: PASS

- [ ] **Step 5: web ワークスペース全体のテスト・lint・型チェックが通ることを確認**

Run: `npm run test -w @nas-fm/web && npm run lint && npm run typecheck`
Expected: PASS（モノレポ全体で影響がないこと）

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/file-list/hooks/useFileMutations.ts apps/web/src/features/file-list/hooks/useFileMutations.test.tsx
git commit -m "$(cat <<'EOF'
feat: 削除成功時にディスク使用量を再取得する

EOF
)"
```

---

## 完了後の確認

- `npm run dev` でサーバ・フロントを起動し、ブラウザでログイン後にヘッダーへ `XX.XGB / YY.YGB` 形式の表示が出ることを目視確認する
- アップロード・削除を行い、表示が更新されることを確認する
- ローカルの実ディスクは通常90%未満のため、警告色（`text-destructive`）の見た目は自動テストのスクリーンショットではなく、ブラウザの開発者ツールで一時的に `useDiskUsage` のモック値を差し替えるか、コンポーネントテストの結果で確認する
