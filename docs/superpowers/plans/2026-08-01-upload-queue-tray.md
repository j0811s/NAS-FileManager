# グローバルアップロードキュー + 常時表示トレイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイル（iPhone Safari）から数十〜数百枚をまとめてアップロードしたときに、進捗が分からない・画面移動で消える問題を解消する。

**Architecture:** アップロードキューをコンポーネントのローカル状態から `useSyncExternalStore` ベースの自前グローバルストアに格上げし、最大3並列でアップロードを実行する。全ルート共通でマウントする常時表示トレイ（ピル+下からせり上がるシート）でキュー全体を可視化する。

**Tech Stack:** React 19 / TanStack Query / shadcn/ui（radix-nova スタイル）/ lucide-react / sonner / Vitest + Testing Library。新規 npm 依存は追加しない。

参照 spec: `docs/superpowers/specs/2026-08-01-upload-queue-tray-design.md`

## Global Constraints

- Node は `>=24.18.0`
- 新規 npm 依存は追加しない（本プランは既存の `radix-ui` パッケージのみで完結する）
- フォーマッタ/リンタは oxfmt / oxlint（Prettier / ESLint ではない）。各タスックのコミット前に `npm run fmt` → `npm run lint:fix` → `npm run typecheck` の順で確認する（pre-commit hook でも自動実行される）
- コミットは Conventional Commits。接頭辞は英語、本文は日本語
- `verbatimModuleSyntax: true` のため、型のみの import/export は必ず `import type` / `export type`
- feature 間の import は各 feature の `index.ts`（公開境界）経由のみ。`app/` はどの feature にも属さない composition root なので、`app/providers.tsx` から `@/features/upload` を import するのは既存の `App.tsx` と同じ許容パターン

---

## Task 1: Sheet UI プリミティブの追加

`apps/web/src/components/ui/` に shadcn/ui の `Sheet`（下からせり上がるパネル）が存在しないため新設する。ネットワーク経由の shadcn CLI には依存せず、既存の `dialog.tsx`（radix-nova スタイル）と全く同じトークン・命名規則で手書きする。

**Files:**
- Create: `apps/web/src/components/ui/sheet.tsx`

**Interfaces:**
- Produces: `Sheet`（`SheetPrimitive.Root` ラッパー）, `SheetTrigger`, `SheetContent`（`side` は今回 `bottom` 固定運用、`showCloseButton?: boolean`）, `SheetHeader`, `SheetTitle`, `SheetDescription` — すべて `@/components/ui/sheet` から export

- [ ] **Step 1: `sheet.tsx` を作成する**

`apps/web/src/components/ui/dialog.tsx` と同じ `radix-ui` の `Dialog` プリミティブを使い、位置とアニメーションだけ下からのスライドに変更する。

```tsx
"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-4 rounded-t-xl bg-popover pt-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 px-4", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger };
```

- [ ] **Step 2: 型チェックを実行する**

Run: `npm run typecheck`
Expected: エラーなし（既存の warning/error が増えないこと）

- [ ] **Step 3: フォーマット・lint を実行する**

Run: `npm run fmt && npm run lint:fix`
Expected: `sheet.tsx` が整形され、lint エラーなし

- [ ] **Step 4: コミットする**

```bash
git add apps/web/src/components/ui/sheet.tsx
git commit -m "$(cat <<'EOF'
feat: Sheet UIプリミティブを追加

アップロードトレイの詳細表示に使う、下からせり上がるパネルを
dialog.tsx と同じ radix-nova スタイルで新設した
EOF
)"
```

---

## Task 2: `queryClient` を `lib/query-client.ts` に切り出す

`uploadQueueStore`（Task 3）は React コンポーネント外から `queryClient.invalidateQueries` を呼ぶ必要がある。現状 `queryClient` は `apps/web/src/app/providers.tsx` のモジュール内シングルトンで export されていない。ここから `features/upload/store/uploadQueueStore.ts` が import すると、`providers.tsx` が後で `UploadTray`（`@/features/upload` 経由）を import するようになった際に循環 import になる。共通ロジックは `lib/` に置くという `.claude/rules/features.md` の方針にも合うため、`lib/query-client.ts` に切り出す。

**Files:**
- Create: `apps/web/src/lib/query-client.ts`
- Create: `apps/web/src/lib/query-client.test.ts`
- Modify: `apps/web/src/app/providers.tsx`
- Delete: `apps/web/src/app/providers.test.ts`（内容は `query-client.test.ts` に移行）

**Interfaces:**
- Produces: `createAuthAwareQueryClient(): QueryClient`, `queryClient: QueryClient`（モジュール単一インスタンス）— `@/lib/query-client` から export

- [ ] **Step 1: 既存テストをコピーして import 先を変更する**

`apps/web/src/app/providers.test.ts` の内容をそのまま `apps/web/src/lib/query-client.test.ts` として作成し、import 元だけ変更する。

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { createAuthAwareQueryClient } from "./query-client";

describe("createAuthAwareQueryClient", () => {
  it("UNAUTHORIZED エラーで ['me'] を無効化する", async () => {
    const client = createAuthAwareQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    client.getMutationCache().config.onError?.(
      new ApiRequestError("UNAUTHORIZED", "x"),
      undefined,
      undefined,
      // biome/oxlint 対策で any を避けるためのダミー mutation / context
      { options: {} } as never,
      {} as never,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["me"] });
  });

  it("他のエラーでは無効化しない", async () => {
    const client = createAuthAwareQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    client
      .getMutationCache()
      .config.onError?.(
        new ApiRequestError("CONFLICT", "x"),
        undefined,
        undefined,
        { options: {} } as never,
        {} as never,
      );
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行し、モジュール未作成で失敗することを確認する**

Run: `npm run test -w @nas-fm/web -- run src/lib/query-client.test.ts`
Expected: FAIL（`./query-client` が見つからない）

- [ ] **Step 3: `query-client.ts` を作成する**

```ts
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";

export function createAuthAwareQueryClient(): QueryClient {
  const onAuthError = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "UNAUTHORIZED") {
      client.invalidateQueries({ queryKey: ["me"] });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
  });
  return client;
}

export const queryClient = createAuthAwareQueryClient();
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/lib/query-client.test.ts`
Expected: PASS（2件）

- [ ] **Step 5: `providers.tsx` を更新し、旧テストファイルを削除する**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

```bash
git rm apps/web/src/app/providers.test.ts
```

- [ ] **Step 6: 全体テスト・型チェックを実行する**

Run: `npm run test -w @nas-fm/web && npm run typecheck`
Expected: 全件 PASS、型エラーなし（`createAuthAwareQueryClient` を import していた他ファイルがないことは既に確認済み）

- [ ] **Step 7: コミットする**

```bash
git add apps/web/src/lib/query-client.ts apps/web/src/lib/query-client.test.ts apps/web/src/app/providers.tsx
git commit -m "$(cat <<'EOF'
refactor: queryClientをlib/query-client.tsに切り出す

featureストア（アップロードキュー）がReactコンポーネント外から
queryClientを参照できるようにするための移動。providers.tsxとの
循環importを避ける
EOF
)"
```

---

## Task 3: `uploadQueueStore` の基本機能（enqueue・並列3件・retry・dismiss）

**Files:**
- Create: `apps/web/src/features/upload/store/uploadQueueStore.ts`
- Create: `apps/web/src/features/upload/store/uploadQueueStore.test.ts`

**Interfaces:**
- Consumes: `api.upload(dirPath, file, opts): Promise<void>` / `ApiRequestError` from `@/lib/api`、`queryClient` from `@/lib/query-client`（Task 2）
- Produces: `type UploadItemStatus`, `type UploadItem`, `uploadQueueStore.enqueue(path: string, files: File[]): void`, `.retry(id: string): void`, `.dismiss(id: string): void`, `.clearCompleted(): void`, `.subscribe(listener: () => void): () => void`, `.getSnapshot(): UploadItem[]`, `__resetForTests(): void`（テスト専用、`uploadQueueStore` とは別 export）。`hasActiveItems()` はモジュール内部関数のまま（Task 4 の `beforeunload` ハンドラが同一モジュール内から直接呼ぶだけで外部に公開する必要はない）

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "./uploadQueueStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("uploadQueueStore", () => {
  it("enqueue でアイテムが pending として積まれる", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    expect(uploadQueueStore.getSnapshot()).toHaveLength(1);
  });

  it("同時実行数を3件に制限し、空きが出たら次を開始する", async () => {
    const deferreds = Array.from({ length: 5 }, () => deferred<void>());
    let callIndex = 0;
    vi.spyOn(api, "upload").mockImplementation(() => deferreds[callIndex++]!.promise);

    const files = Array.from({ length: 5 }, (_, i) => new File(["x"], `f${i}.txt`));
    uploadQueueStore.enqueue("docs", files);

    expect(api.upload).toHaveBeenCalledTimes(3);
    const snapshot1 = uploadQueueStore.getSnapshot();
    expect(snapshot1.filter((it) => it.status === "uploading")).toHaveLength(3);
    expect(snapshot1.filter((it) => it.status === "pending")).toHaveLength(2);

    deferreds[0]!.resolve();
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledTimes(4));
    const snapshot2 = uploadQueueStore.getSnapshot();
    expect(snapshot2.filter((it) => it.status === "uploading")).toHaveLength(3);
    expect(snapshot2.filter((it) => it.status === "done")).toHaveLength(1);
  });

  it("失敗した項目は error になり、retry で pending に戻って再送される", async () => {
    vi.spyOn(api, "upload").mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce();
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => {
      expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("error");
    });
    const id = uploadQueueStore.getSnapshot()[0]!.id;

    uploadQueueStore.retry(id);
    expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("pending");
    await vi.waitFor(() => {
      expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("done");
    });
    expect(api.upload).toHaveBeenCalledTimes(2);
  });

  it("dismiss で該当アイテムのみ除去する", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    const [first, second] = uploadQueueStore.getSnapshot();
    uploadQueueStore.dismiss(first!.id);
    expect(uploadQueueStore.getSnapshot()).toEqual([second]);
  });

  it("clearCompleted で done のみ除去し pending/uploading/error は残す", async () => {
    vi.spyOn(api, "upload").mockResolvedValueOnce().mockRejectedValueOnce(new Error("boom"));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => {
      const statuses = uploadQueueStore.getSnapshot().map((it) => it.status);
      expect(statuses.sort()).toEqual(["done", "error"]);
    });
    uploadQueueStore.clearCompleted();
    expect(uploadQueueStore.getSnapshot()).toHaveLength(1);
    expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("error");
  });

  it("subscribe したリスナーが state 変化のたびに呼ばれる", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    const listener = vi.fn();
    const unsubscribe = uploadQueueStore.subscribe(listener);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/store/uploadQueueStore.test.ts`
Expected: FAIL（`./uploadQueueStore` が見つからない）

- [ ] **Step 3: `uploadQueueStore.ts` を実装する**

```ts
import { ApiRequestError, api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export type UploadItemStatus = "pending" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  file: File;
  path: string;
  status: UploadItemStatus;
  progress: number;
  errorCode?: string;
};

const MAX_CONCURRENT = 3;

let items: UploadItem[] = [];
let activeCount = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function updateItem(id: string, patch: Partial<UploadItem>) {
  items = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  emit();
}

function hasActiveItems(): boolean {
  return items.some((it) => it.status === "pending" || it.status === "uploading");
}

function runWorker() {
  while (activeCount < MAX_CONCURRENT) {
    const next = items.find((it) => it.status === "pending");
    if (!next) return;
    activeCount++;
    updateItem(next.id, { status: "uploading" });
    void runOne(next);
  }
}

async function runOne(item: UploadItem) {
  try {
    await api.upload(item.path, item.file, {
      onProgress: (progress) => updateItem(item.id, { progress }),
    });
    updateItem(item.id, { status: "done", progress: 100 });
    queryClient.invalidateQueries({ queryKey: ["list", item.path] });
    queryClient.invalidateQueries({ queryKey: ["disk-usage"] });
  } catch (err) {
    const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
    if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
    updateItem(item.id, { status: "error", errorCode: code });
  } finally {
    activeCount--;
    runWorker();
  }
}

export const uploadQueueStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): UploadItem[] {
    return items;
  },
  enqueue(path: string, files: File[]): void {
    const newItems: UploadItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      path,
      status: "pending",
      progress: 0,
    }));
    items = [...items, ...newItems];
    emit();
    runWorker();
  },
  retry(id: string): void {
    updateItem(id, { status: "pending", progress: 0, errorCode: undefined });
    runWorker();
  },
  dismiss(id: string): void {
    items = items.filter((it) => it.id !== id);
    emit();
  },
  clearCompleted(): void {
    items = items.filter((it) => it.status !== "done");
    emit();
  },
};

export function __resetForTests(): void {
  items = [];
  activeCount = 0;
  listeners.clear();
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/store/uploadQueueStore.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: フォーマット・lint・型チェック**

Run: `npm run fmt && npm run lint:fix && npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add apps/web/src/features/upload/store/uploadQueueStore.ts apps/web/src/features/upload/store/uploadQueueStore.test.ts
git commit -m "$(cat <<'EOF'
feat: アップロードキューストアの基本機能を追加

コンポーネントのライフサイクルに依存しないグローバルなアップロード
キューを新設。最大3並列で実行し、失敗した項目は個別に再試行できる
EOF
)"
```

---

## Task 4: サマリートースト・beforeunload 連携

**Files:**
- Modify: `apps/web/src/features/upload/store/uploadQueueStore.ts`
- Modify: `apps/web/src/features/upload/store/uploadQueueStore.test.ts`

**Interfaces:**
- Consumes: `toast` from `"sonner"`
- Produces: 追加の公開APIなし（挙動のみ追加）

- [ ] **Step 1: 失敗するテストを追記する**

`uploadQueueStore.test.ts` の `describe` ブロック内に追記:

```ts
import { toast } from "sonner";
// 既存 import に追加

describe("uploadQueueStore のサマリートースト", () => {
  it("全件成功でサマリー成功トーストを1回出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("2件アップロードしました");
  });

  it("一部失敗ありでサマリー失敗トーストを出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValueOnce().mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith("1件成功、1件失敗しました");
  });

  it("全件失敗でサマリー失敗トーストを出す", async () => {
    vi.spyOn(api, "upload").mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith("1件のアップロードに失敗しました");
  });

  it("未クリアの既存 done 項目は次のサマリーに含めない", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));

    uploadQueueStore.enqueue("docs", [new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(2));
    expect(success).toHaveBeenLastCalledWith("1件アップロードしました");
  });
});

describe("uploadQueueStore の beforeunload 連携", () => {
  it("未完了アイテムがある間はタブを閉じる操作をブロックする", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("未完了アイテムがなければタブを閉じる操作をブロックしない", () => {
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/store/uploadQueueStore.test.ts`
Expected: 新規追加分が FAIL（トースト未発火、`preventDefault` 未呼び出し）

- [ ] **Step 3: `uploadQueueStore.ts` にサマリートーストと beforeunload を実装する**

`import` に `toast` を追加し、`settledSinceToast` の集計と `emitSummaryToast` を追加。`runOne` の `finally` ブロックと、モジュール末尾の `beforeunload` 登録を変更する。

```ts
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

// ...(UploadItemStatus / UploadItem / MAX_CONCURRENT / items / activeCount / listeners / emit / updateItem / hasActiveItems / runWorker はそのまま)

let settledSinceToast = { done: 0, error: 0 };

function emitSummaryToast(doneCount: number, errorCount: number) {
  if (errorCount === 0) {
    toast.success(`${doneCount}件アップロードしました`);
    return;
  }
  if (doneCount === 0) {
    toast.error(`${errorCount}件のアップロードに失敗しました`);
    return;
  }
  toast.error(`${doneCount}件成功、${errorCount}件失敗しました`);
}

async function runOne(item: UploadItem) {
  try {
    await api.upload(item.path, item.file, {
      onProgress: (progress) => updateItem(item.id, { progress }),
    });
    updateItem(item.id, { status: "done", progress: 100 });
    settledSinceToast = { ...settledSinceToast, done: settledSinceToast.done + 1 };
    queryClient.invalidateQueries({ queryKey: ["list", item.path] });
    queryClient.invalidateQueries({ queryKey: ["disk-usage"] });
  } catch (err) {
    const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
    if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
    updateItem(item.id, { status: "error", errorCode: code });
    settledSinceToast = { ...settledSinceToast, error: settledSinceToast.error + 1 };
  } finally {
    activeCount--;
    if (!hasActiveItems() && (settledSinceToast.done > 0 || settledSinceToast.error > 0)) {
      emitSummaryToast(settledSinceToast.done, settledSinceToast.error);
      settledSinceToast = { done: 0, error: 0 };
    }
    runWorker();
  }
}

// uploadQueueStore の中身は変更なし

export function __resetForTests(): void {
  items = [];
  activeCount = 0;
  settledSinceToast = { done: 0, error: 0 };
  listeners.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!hasActiveItems()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/store/uploadQueueStore.test.ts`
Expected: PASS（Task 3 の6件 + 新規6件 = 12件）

- [ ] **Step 5: フォーマット・lint・型チェック**

Run: `npm run fmt && npm run lint:fix && npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add apps/web/src/features/upload/store/uploadQueueStore.ts apps/web/src/features/upload/store/uploadQueueStore.test.ts
git commit -m "$(cat <<'EOF'
feat: アップロードキューにサマリー通知とタブ離脱警告を追加

ファイル単位のトーストを廃止し、バッチが完全に片付いた時点で
1回だけ成功/失敗件数のサマリートーストを出すようにした。
beforeunloadの警告もグローバルキューの未完了状態を見るように変更
EOF
)"
```

---

## Task 5: `useUploadQueue` フック

**Files:**
- Create: `apps/web/src/features/upload/hooks/useUploadQueue.ts`
- Create: `apps/web/src/features/upload/hooks/useUploadQueue.test.tsx`

**Interfaces:**
- Consumes: `uploadQueueStore.subscribe` / `.getSnapshot` from `../store/uploadQueueStore`（Task 3/4）
- Produces: `useUploadQueue(): UploadItem[]`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { useUploadQueue } from "./useUploadQueue";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("useUploadQueue", () => {
  it("ストアの現在のアイテム一覧を返す", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useUploadQueue());
    expect(result.current).toEqual([]);

    act(() => {
      uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    });
    expect(result.current).toHaveLength(1);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/hooks/useUploadQueue.test.tsx`
Expected: FAIL（`./useUploadQueue` が見つからない）

- [ ] **Step 3: `useUploadQueue.ts` を実装する**

```ts
import { useSyncExternalStore } from "react";
import { type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";

export function useUploadQueue(): UploadItem[] {
  return useSyncExternalStore(uploadQueueStore.subscribe, uploadQueueStore.getSnapshot);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/hooks/useUploadQueue.test.tsx`
Expected: PASS

- [ ] **Step 5: フォーマット・lint・型チェック**

Run: `npm run fmt && npm run lint:fix && npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add apps/web/src/features/upload/hooks/useUploadQueue.ts apps/web/src/features/upload/hooks/useUploadQueue.test.tsx
git commit -m "$(cat <<'EOF'
feat: uploadQueueStoreを購読するuseUploadQueueフックを追加
EOF
)"
```

---

## Task 6: `UploadDropzone` を enqueue 呼び出しに書き換え、`useUpload` を削除

**Files:**
- Modify: `apps/web/src/features/upload/components/UploadDropzone.tsx`
- Modify: `apps/web/src/features/upload/components/UploadDropzone.test.tsx`
- Delete: `apps/web/src/features/upload/hooks/useUpload.ts`
- Delete: `apps/web/src/features/upload/hooks/useUpload.test.tsx`

**Interfaces:**
- Consumes: `uploadQueueStore.enqueue` from `../store/uploadQueueStore`（Task 3）
- Produces: `UploadDropzone` の公開 props（`{ path: string }`）は変更なし

- [ ] **Step 1: `UploadDropzone.test.tsx` を書き換える（先にテストを変更）**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadDropzone } from "./UploadDropzone";

beforeEach(() => {
  __resetForTests();
  vi.spyOn(uploadQueueStore, "enqueue").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("UploadDropzone", () => {
  it("ファイル選択でキューに現在パスで積む", async () => {
    render(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(uploadQueueStore.enqueue).toHaveBeenCalledWith("docs", [expect.any(File)]);
  });

  it("選択後に input の値をリセットし同じファイルを再選択できるようにする", async () => {
    render(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(input.value).toBe("");
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadDropzone.test.tsx`
Expected: FAIL（`UploadDropzone` はまだ `api.upload` を直接呼んでおり `uploadQueueStore.enqueue` が呼ばれない）

- [ ] **Step 3: `UploadDropzone.tsx` を書き換える**

```tsx
import { type DragEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { uploadQueueStore } from "../store/uploadQueueStore";

export function UploadDropzone({ path }: { path: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    uploadQueueStore.enqueue(path, Array.from(files));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <Card
      className={`flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed p-8 text-center transition-colors ${
        dragOver
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/30 bg-muted hover:bg-accent"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Upload size={32} className={dragOver ? "text-primary" : "text-muted-foreground"} />
      <p className="text-sm font-medium">
        ここにドラッグ＆ドロップ、またはクリックしてアップロード
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="upload-input"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadDropzone.test.tsx`
Expected: PASS

- [ ] **Step 5: `useUpload` を削除する**

```bash
git rm apps/web/src/features/upload/hooks/useUpload.ts apps/web/src/features/upload/hooks/useUpload.test.tsx
```

- [ ] **Step 6: フォーマット・lint・型チェック・全体テスト**

Run: `npm run fmt && npm run lint:fix && npm run typecheck && npm run test -w @nas-fm/web`
Expected: エラーなし、全テスト PASS（`useUpload` を参照していた箇所が無いこと。`features/upload/index.ts` は `UploadDropzone` のみを export しており、`useUpload` は元々公開していないため他ファイルへの影響なし）

- [ ] **Step 7: コミットする**

```bash
git add apps/web/src/features/upload/components/UploadDropzone.tsx apps/web/src/features/upload/components/UploadDropzone.test.tsx
git commit -m "$(cat <<'EOF'
refactor: UploadDropzoneをアップロードキューへのenqueueに変更

自前の進捗バー表示とuseUploadフックを廃止し、グローバルキューに
積むだけの薄いコンポーネントにした。進捗表示は後続タスクで追加する
アップロードトレイに一本化する
EOF
)"
```

---

## Task 7: `UploadTraySheet`（キュー一覧の中身）

**Files:**
- Create: `apps/web/src/features/upload/components/UploadTraySheet.tsx`
- Create: `apps/web/src/features/upload/components/UploadTraySheet.test.tsx`

**Interfaces:**
- Consumes: `type UploadItem` from `../store/uploadQueueStore`（Task 3）、`uploadQueueStore.retry` / `.dismiss` / `.clearCompleted`、`errorMessage` from `@/lib/error-messages`、`Sheet系` は使わない（このコンポーネント自体は `Sheet` の中身の JSX だけを提供する）、`Button` / `Progress` / `SheetHeader` / `SheetTitle` / `SheetDescription` from `@/components/ui/*`（Task 1）
- Produces: `UploadTraySheetContent({ items: UploadItem[] }): JSX.Element`

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadTraySheetContent } from "./UploadTraySheet";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

function makeItem(overrides: Partial<UploadItem>): UploadItem {
  return {
    id: "1",
    file: new File(["x"], "a.txt"),
    path: "docs",
    status: "pending",
    progress: 0,
    ...overrides,
  };
}

describe("UploadTraySheetContent", () => {
  it("ファイル名を一覧表示する", () => {
    render(<UploadTraySheetContent items={[makeItem({ file: new File(["x"], "photo.jpg") })]} />);
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
  });

  it("失敗した項目にエラーメッセージと再試行ボタンを表示し、押すと retry を呼ぶ", async () => {
    const retry = vi.spyOn(uploadQueueStore, "retry").mockImplementation(() => {});
    render(<UploadTraySheetContent items={[makeItem({ status: "error", errorCode: "CONFLICT" })]} />);
    expect(screen.getByText("同名の項目が既に存在します")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(retry).toHaveBeenCalledWith("1");
  });

  it("完了項目がある場合のみ「完了済みをクリア」ボタンを表示する", () => {
    const { rerender } = render(
      <UploadTraySheetContent items={[makeItem({ status: "pending" })]} />,
    );
    expect(screen.queryByText("完了済みをクリア")).not.toBeInTheDocument();
    rerender(<UploadTraySheetContent items={[makeItem({ status: "done" })]} />);
    expect(screen.getByText("完了済みをクリア")).toBeInTheDocument();
  });

  it("「完了済みをクリア」クリックで clearCompleted を呼ぶ", async () => {
    const clearCompleted = vi.spyOn(uploadQueueStore, "clearCompleted").mockImplementation(() => {});
    render(<UploadTraySheetContent items={[makeItem({ status: "done" })]} />);
    await userEvent.click(screen.getByText("完了済みをクリア"));
    expect(clearCompleted).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadTraySheet.test.tsx`
Expected: FAIL（`./UploadTraySheet` が見つからない）

- [ ] **Step 3: `UploadTraySheet.tsx` を実装する**

```tsx
import { Check, File, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/error-messages";
import { type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url || broken) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
        <File size={18} className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className="size-10 shrink-0 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function UploadTrayItemRow({ item }: { item: UploadItem }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Thumbnail file={item.file} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.file.name}</p>
        {item.status === "uploading" && <Progress value={item.progress} className="mt-1 h-1.5" />}
        {item.status === "error" && (
          <p className="text-xs text-destructive">{errorMessage(item.errorCode ?? "INTERNAL")}</p>
        )}
      </div>
      {item.status === "done" && <Check size={18} className="shrink-0 text-primary" />}
      {item.status === "error" && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => uploadQueueStore.retry(item.id)}
          aria-label="再試行"
        >
          <RotateCcw size={16} />
        </Button>
      )}
      {(item.status === "done" || item.status === "error") && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => uploadQueueStore.dismiss(item.id)}
          aria-label="削除"
        >
          <X size={16} />
        </Button>
      )}
    </li>
  );
}

export function UploadTraySheetContent({ items }: { items: UploadItem[] }) {
  const hasCompleted = items.some((it) => it.status === "done");
  return (
    <>
      <SheetHeader>
        <SheetTitle>アップロード状況</SheetTitle>
        <SheetDescription>
          アップロード中はタブを閉じたり他のアプリに切り替えないでください
        </SheetDescription>
      </SheetHeader>
      <ul className="max-h-96 overflow-y-auto px-4">
        {items.map((item) => (
          <UploadTrayItemRow key={item.id} item={item} />
        ))}
      </ul>
      {hasCompleted && (
        <div className="px-4 pb-4">
          <Button variant="outline" onClick={() => uploadQueueStore.clearCompleted()}>
            完了済みをクリア
          </Button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadTraySheet.test.tsx`
Expected: PASS（4件）

- [ ] **Step 5: フォーマット・lint・型チェック**

Run: `npm run fmt && npm run lint:fix && npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミットする**

```bash
git add apps/web/src/features/upload/components/UploadTraySheet.tsx apps/web/src/features/upload/components/UploadTraySheet.test.tsx
git commit -m "$(cat <<'EOF'
feat: アップロードキュー一覧を表示するUploadTraySheetを追加

ファイルごとのサムネイル・進捗・エラー内容・再試行/削除ボタンを
一覧表示する。画像以外やHEIC非対応ブラウザではファイルアイコンに
フォールバックする
EOF
)"
```

---

## Task 8: `UploadTray`（常時表示ピル + Sheet 統合）

**Files:**
- Create: `apps/web/src/features/upload/components/UploadTray.tsx`
- Create: `apps/web/src/features/upload/components/UploadTray.test.tsx`
- Modify: `apps/web/src/features/upload/index.ts`

**Interfaces:**
- Consumes: `useUploadQueue` from `../hooks/useUploadQueue`（Task 5）、`UploadTraySheetContent` from `./UploadTraySheet`（Task 7）、`Sheet` / `SheetTrigger` / `SheetContent` from `@/components/ui/sheet`（Task 1）
- Produces: `UploadTray(): JSX.Element | null`、`features/upload` の公開 export に追加

- [ ] **Step 1: 失敗するテストを書く**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadTray } from "./UploadTray";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("UploadTray", () => {
  it("キューが空のときは何も描画しない", () => {
    const { container } = render(<UploadTray />);
    expect(container).toBeEmptyDOMElement();
  });

  it("アップロード中は件数と%を表示する", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    expect(screen.getByText("アップロード中 0/1件 (0%)")).toBeInTheDocument();
  });

  it("全件完了後は完了件数の表示に切り替わる", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    expect(await screen.findByText("アップロード完了 1件")).toBeInTheDocument();
  });

  it("クリックで詳細シートを開く", async () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    await userEvent.click(screen.getByRole("button", { name: /アップロード中/ }));
    expect(screen.getByText("アップロード状況")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadTray.test.tsx`
Expected: FAIL（`./UploadTray` が見つからない）

- [ ] **Step 3: `UploadTray.tsx` を実装する**

```tsx
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useUploadQueue } from "../hooks/useUploadQueue";
import { UploadTraySheetContent } from "./UploadTraySheet";

export function UploadTray() {
  const items = useUploadQueue();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const activeCount = items.filter(
    (it) => it.status === "pending" || it.status === "uploading",
  ).length;
  const doneCount = items.filter((it) => it.status === "done").length;
  const errorCount = items.filter((it) => it.status === "error").length;
  const percent = Math.round((doneCount / items.length) * 100);

  const label =
    activeCount > 0
      ? `アップロード中 ${doneCount}/${items.length}件 (${percent}%)`
      : errorCount > 0
        ? `アップロード完了（${errorCount}件失敗）`
        : `アップロード完了 ${doneCount}件`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed right-4 bottom-4 z-40 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
        >
          {label}
        </button>
      </SheetTrigger>
      <SheetContent>
        <UploadTraySheetContent items={items} />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npm run test -w @nas-fm/web -- run src/features/upload/components/UploadTray.test.tsx`
Expected: PASS（4件）

- [ ] **Step 5: `index.ts` に公開 export を追加する**

```ts
export { UploadDropzone } from "./components/UploadDropzone";
export { UploadTray } from "./components/UploadTray";
```

- [ ] **Step 6: フォーマット・lint・型チェック**

Run: `npm run fmt && npm run lint:fix && npm run typecheck`
Expected: エラーなし

- [ ] **Step 7: コミットする**

```bash
git add apps/web/src/features/upload/components/UploadTray.tsx apps/web/src/features/upload/components/UploadTray.test.tsx apps/web/src/features/upload/index.ts
git commit -m "$(cat <<'EOF'
feat: 常時表示のアップロードトレイUploadTrayを追加

キューが空でなければ画面右下にピルを表示し、タップで詳細シートを
開けるようにした。まだどのルートにもマウントしていない
EOF
)"
```

---

## Task 9: `providers.tsx` に `UploadTray` を配線

**Files:**
- Modify: `apps/web/src/app/providers.tsx`

**Interfaces:**
- Consumes: `UploadTray` from `@/features/upload`（Task 8）

- [ ] **Step 1: `providers.tsx` に `UploadTray` を追加する**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { UploadTray } from "@/features/upload";
import { queryClient } from "@/lib/query-client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <UploadTray />
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: 全体テスト・型チェック・lint を実行する**

Run: `npm run test -w @nas-fm/web && npm run typecheck && npm run lint`
Expected: 全件 PASS、エラーなし

- [ ] **Step 3: コミットする**

```bash
git add apps/web/src/app/providers.tsx
git commit -m "$(cat <<'EOF'
feat: UploadTrayを全ルート共通でマウントする

Providers内で常時レンダーすることで、フォルダを移動しても
アップロード進捗の可視性が失われないようにした
EOF
)"
```

---

## Task 10: 手動動作確認・最終チェック

コードは Task 9 までで完成している。ここではブラウザで実際に触って確認する。

**Files:** なし（確認のみ。問題が見つかった場合はその場で修正し追加コミットする）

- [ ] **Step 1: 開発サーバを起動する**

Run: `npm run dev`

- [ ] **Step 2: 複数ファイルのアップロードで全体進捗が見えることを確認する**

ブラウザで `http://localhost:5173`（または表示された Vite のポート）を開き、5〜10個程度のファイルをまとめてドラッグ&ドロップまたは選択する。画面右下にピルが表示され「アップロード中 x/y件 (z%)」のように更新されること、タップで詳細シートが開き各ファイルの状態が見えることを確認する。

- [ ] **Step 3: フォルダ移動してもキューが消えないことを確認する**

アップロード中に別のフォルダへ移動し、ピルが表示され続けること、進捗が更新され続けることを確認する。

- [ ] **Step 4: 失敗時の再試行を確認する**

同名ファイルを2回アップロードするなどして `CONFLICT` エラーを発生させ、詳細シートにエラーメッセージと再試行ボタンが出ること、再試行を押すと再度アップロードが走る（同じ理由で失敗する場合は再度エラー表示になる）ことを確認する。

- [ ] **Step 5: 完了後のサマリートーストとクリア操作を確認する**

バッチが完了した際にファイル単位ではなく1回だけのサマリートーストが出ることを確認する。詳細シートの「完了済みをクリア」でdone項目が消えることを確認する。

- [ ] **Step 6: 開発サーバを終了し、最終確認コマンドを流す**

Run: `npm run typecheck && npm run lint && npm run fmt:check && npm run test`
Expected: 全て成功

問題が見つかった場合は該当タスクの実装を修正し、`fix:` または `refactor:` のコミットを追加する。
