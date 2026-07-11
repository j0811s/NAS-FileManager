# フォルダ階層のURLハッシュ同期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 閲覧中フォルダのパスをURLハッシュ（`#/docs/2024` 形式）に同期し、ブラウザの戻る/進む/リロード/ブックマークでフォルダ階層をナビゲートできるようにする。

**Architecture:** `window.location.hash` を唯一の情報源とする自前フック `useHashPath` を新規作成する（ルーティングライブラリは導入しない）。`FileBrowser.tsx` の `path` state（現在は素の `useState("")`）をこのフックに置き換えるだけで、既存の `useFileList(path)` / `rel()` / `Breadcrumbs` 等はそのまま動く。

**Tech Stack:** React 19、Vitest、`@testing-library/react`（`renderHook`）。

**Spec:** `docs/superpowers/specs/2026-07-11-hash-path-navigation-design.md`

## Global Constraints

- フォーマッタ/リンタは **oxfmt / oxlint**（Prettier/ESLintではない）。pre-commit（husky + lint-staged）が commit 時に oxfmt → oxlint --fix → typecheck を自動実行する
- コミットは Conventional Commits（接頭辞は英語、本文は日本語。例: `feat: ...`）
- `verbatimModuleSyntax: true` のため、型のみの import/export は必ず `import type` / `export type`
- feature間のimportは各featureの `index.ts`（公開境界）経由のみ。本計画の変更はすべて `file-list` feature内で完結する
- 新規npm依存は追加しない（`react-router-dom` 等のルーティングライブラリは導入しない。自前の `window.location.hash` + `hashchange` イベントで実装する）
- **ハッシュ形式**: `#/` + パスの各セグメントを `encodeURIComponent` してから `/` で結合。ルート（`path === ""`）はハッシュ無し
- **不正な形式のハッシュ**はサイレントにルートへフォールバックする
- **有効な形式だが存在しないフォルダを指すハッシュ**は、既存のエラー表示（`useFileList` 失敗時の「一覧の読み込みに失敗しました・再試行」）のままにする。ハッシュ層での特別なリダイレクトは行わない
- **`MoveDialog` 内の移動先フォルダ選択はハッシュと非連動のまま**（対象外）

## 前提

`FileBrowser.tsx` は別プラン（`docs/superpowers/plans/2026-07-11-preview-modal-navigation.md` の Task 2）でも変更対象になる。両プランの `FileBrowser.tsx` への変更は互いに無関係な箇所（本プランは `path` state 宣言・`openDir`・`Breadcrumbs` 呼び出し／もう一方は `previewableEntries` 等の新規追加と `PreviewDialog` の `nav` prop）を触るため、どちらを先に実行しても衝突しない。ただし実行前に一度 `apps/web/src/features/file-list/components/FileBrowser.tsx` の現在の内容を確認し、本プランの Step 3 で示す「現在の内容」と差異があれば、該当箇所（`path` state宣言・`openDir`・`<Breadcrumbs>`）だけを見つけて同様の変更を適用すること。

---

### Task 1: `useHashPath` フックを新規作成する

**Files:**
- Create: `apps/web/src/features/file-list/hooks/useHashPath.ts`
- Test: `apps/web/src/features/file-list/hooks/useHashPath.test.ts`

**Interfaces:**
- Produces: `export function useHashPath(): [string, (path: string) => void]`（返り値は `[現在のパス文字列, ナビゲート関数]`。ナビゲート関数を呼ぶと `window.location.hash` が更新され、それをきっかけに返り値のパス文字列も更新される）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/hooks/useHashPath.test.ts` を新規作成する。

```ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHashPath } from "./useHashPath";

afterEach(() => {
  window.location.hash = "";
});

describe("useHashPath", () => {
  it("初期ハッシュ無しではpathは空文字", () => {
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("");
  });

  it("初期ハッシュ #/docs/2024 はpath 'docs/2024' になる", () => {
    window.location.hash = "#/docs/2024";
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("docs/2024");
  });

  it("日本語・スペースを含むセグメントを正しくデコードする", () => {
    window.location.hash = `#/${encodeURIComponent("2024 レポート")}`;
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("2024 レポート");
  });

  it("不正な%エンコードのハッシュは空文字にフォールバックする", () => {
    window.location.hash = "#/%zz";
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("");
  });

  it("navigateを呼ぶとハッシュが更新される", () => {
    const { result } = renderHook(() => useHashPath());
    act(() => {
      result.current[1]("docs");
    });
    expect(window.location.hash).toBe("#/docs");
  });

  it("navigate('')を呼ぶとハッシュがクリアされる", () => {
    window.location.hash = "#/docs";
    const { result } = renderHook(() => useHashPath());
    act(() => {
      result.current[1]("");
    });
    expect(window.location.hash).toBe("");
  });

  it("hashchangeイベントでpathが追従する(戻る/進む相当)", () => {
    const { result } = renderHook(() => useHashPath());
    act(() => {
      window.location.hash = "#/docs/2024";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(result.current[0]).toBe("docs/2024");
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- useHashPath`
Expected: FAIL — `./useHashPath` モジュールが存在せず import エラーになる

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/hooks/useHashPath.ts` を新規作成する。

```ts
import { useEffect, useState } from "react";

function encodeHashPath(path: string): string {
  if (!path) return "";
  return "/" + path.split("/").map(encodeURIComponent).join("/");
}

function decodeHashPath(hash: string): string {
  const trimmed = hash.replace(/^#\/?/, "");
  if (!trimmed) return "";
  try {
    return trimmed.split("/").map(decodeURIComponent).join("/");
  } catch {
    return "";
  }
}

export function useHashPath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => decodeHashPath(window.location.hash));

  useEffect(() => {
    function handleHashChange() {
      setPath(decodeHashPath(window.location.hash));
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function navigate(next: string) {
    window.location.hash = encodeHashPath(next);
  }

  return [path, navigate];
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- useHashPath`
Expected: PASS（全7テスト）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/hooks/useHashPath.ts apps/web/src/features/file-list/hooks/useHashPath.test.ts
git commit -m "$(cat <<'EOF'
feat: フォルダパスをURLハッシュに同期するuseHashPathフックを追加

EOF
)"
```

---

### Task 2: `FileBrowser` の閲覧パスをURLハッシュに切り替える

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- Test: `apps/web/src/features/file-list/components/FileBrowser.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `useHashPath(): [string, (path: string) => void]`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/components/FileBrowser.test.tsx` の import 行を以下に変更する（`act` を追加）。

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { FileBrowser } from "./FileBrowser";
```

既存の `afterEach` を以下に変更する（`window.location.hash` のリセットを追加。テスト間でハッシュ状態が汚染されるのを防ぐ）。

```ts
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = "";
});
```

`describe("FileBrowser", ...)` ブロックの末尾（最後の `it("ソートメニューの選択で並び順が変わる", ...)` の直後、ブロックを閉じる `});` の直前）に以下を追加する。

```ts
  it("URLハッシュを指定してマウントすると、そのフォルダの一覧を取得する", async () => {
    window.location.hash = "#/docs";
    const list = vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === "docs"
          ? [{ name: "inner.txt", size: 1, mtime: 0, type: "file" as const }]
          : [],
    }));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("inner.txt")).toBeInTheDocument());
    expect(list).toHaveBeenCalledWith("docs");
  });

  it("フォルダを開くとURLハッシュに新しいセグメントが追加される", async () => {
    vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [{ name: "docs", size: 0, mtime: 0, type: "dir" as const }]
          : [],
    }));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    await userEvent.click(screen.getByText("docs"));
    await waitFor(() => expect(window.location.hash).toBe("#/docs"));
  });

  it("hashchangeで前のハッシュに戻すと、対応するフォルダの一覧表示に戻る", async () => {
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

    act(() => {
      window.location.hash = "";
      window.dispatchEvent(new Event("hashchange"));
    });

    await waitFor(() => expect(screen.queryByText("inner.txt")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledWith("");
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: 新規3テストがFAIL。1つ目はハッシュが無視され `path` の初期値が常に `""` のため `api.list` が `"docs"` で呼ばれず `inner.txt` が表示されずタイムアウトする。2つ目は `setPath` がURLハッシュを更新しないため `window.location.hash` が `""` のままで `toBe("#/docs")` に失敗する。3つ目は `hashchange` を購読していないため `path` が `"docs"` のまま変わらず `inner.txt` が表示され続け、`not.toBeInTheDocument()` に失敗する

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/components/FileBrowser.tsx` の現在の内容を確認する。以下のような内容になっているはずである（別プランによる変更が既に入っていても、`path` state宣言・`openDir`・`<Breadcrumbs>` の3箇所は変わっていないはず）。

```tsx
export function FileBrowser() {
  const [path, setPath] = useState("");
```

これを以下に変更する（import文に `useHashPath` を追加する）。

```tsx
import { useMemo, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { FolderPlus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/features/upload";
import { useFileList } from "../hooks/useFileList";
import { useFileMutations } from "../hooks/useFileMutations";
import { useHashPath } from "../hooks/useHashPath";
import { type SortDir, type SortKey, sortEntries } from "../sort";
```

（`import { useHashPath } from "../hooks/useHashPath";` の1行を、既存の `useFileMutations` importの直後に追加する）

`const [path, setPath] = useState("");` を以下に置き換える。

```tsx
  const [path, navigate] = useHashPath();
```

`function openDir(name: string) { setPath(path ? \`${path}/${name}\` : name); }` を以下に置き換える。

```tsx
  function openDir(name: string) {
    navigate(path ? `${path}/${name}` : name);
  }
```

`<Breadcrumbs path={path} onNavigate={setPath} />` を以下に置き換える。

```tsx
      <Breadcrumbs path={path} onNavigate={navigate} />
```

`setPath` を参照している箇所は上記3箇所のみ（`path` state宣言・`openDir`・`Breadcrumbs`）であることを確認する。他の箇所（`useFileList(path)` / `rel()` / `UploadDropzone` の `path` prop / `MoveDialog` の `currentPath`）は `path` を読むだけで `setPath` を呼んでいないため無変更のままでよい。

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: PASS（全テスト）

- [ ] **Step 5: 型チェックとフロント全体のテスト**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

Run: `npm run test -w @nas-fm/web`
Expected: PASS（全テストスイート）

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/components/FileBrowser.tsx apps/web/src/features/file-list/components/FileBrowser.test.tsx
git commit -m "$(cat <<'EOF'
feat: フォルダの閲覧パスをURLハッシュと同期する

EOF
)"
```

---

## 完了確認

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

Run: `npm run test -w @nas-fm/web`
Expected: 全テストPASS

Run: `npm run lint`
Expected: エラー無し
