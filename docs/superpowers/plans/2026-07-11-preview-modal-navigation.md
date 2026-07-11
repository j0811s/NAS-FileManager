# プレビューモーダルの前後スライドナビゲーション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレビューモーダルを閉じずに、矢印ボタンまたは ←/→ キーで前後のファイルへ移動できるようにする。

**Architecture:** `PreviewDialog` にオプショナルな `nav` prop（矢印ボタン・カウンタ・キーボード操作を制御する値）を追加し、`FileBrowser` 側で現在表示中の並び順（`sorted`、ディレクトリ除外）から `nav` の値を計算して渡す。ナビゲーション状態は新しい state 変数を持たず、既存の `previewTarget` と `sorted` からの派生値として計算する。

**Tech Stack:** React 19、Vitest、`@testing-library/react` / `@testing-library/user-event`、`lucide-react`（アイコン、既存依存）。

**Spec:** `docs/superpowers/specs/2026-07-11-preview-modal-navigation-design.md`

## Global Constraints

- フォーマッタ/リンタは **oxfmt / oxlint**（Prettier/ESLintではない）。pre-commit（husky + lint-staged）が commit 時に oxfmt → oxlint --fix → typecheck を自動実行する
- コミットは Conventional Commits（接頭辞は英語、本文は日本語。例: `feat: ...`）
- `verbatimModuleSyntax: true` のため、型のみの import/export は必ず `import type` / `export type`
- feature間のimportは各featureの `index.ts`（公開境界）経由のみ。本計画の変更はすべて `file-list` feature内で完結する
- 新規npm依存は追加しない（アイコンは既存の `lucide-react` を使う）
- **移動対象はフォルダ内のディレクトリ以外の全ファイル**。プレビュー非対応の拡張子も移動先に含める（プレビュー可否でフィルタしない）
- **先頭/末尾ではボタンを無効化する（ループしない）**
- **タッチのスワイプジェスチャは今回のスコープ外**

## 前提

このプランの **Task 1** は `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` を変更する。同ファイルは HEIC対応プラン（`docs/superpowers/plans/2026-07-11-heic-preview.md` の Task 8）でも変更される。**このTask 1は、HEIC対応プランのTask 8が完了済みの状態のファイルを前提に書かれている。** 実行前に必ず `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` の現在の内容を確認し、もしTask 8がまだ完了していなければ、先にHEIC対応プランのTask 8を終わらせてからこのTask 1に着手すること（`HeicPreview` import・`isHeic` 分岐が無い場合は未完了）。

Task 2（`FileBrowser.tsx`）はHEIC対応プランと無関係のファイルのみを変更するため、実行順序に制約はない。

---

### Task 1: `PreviewDialog` に `nav` prop（矢印ボタン・カウンタ・キーボード操作）を追加する

**Files:**
- Modify: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx`
- Test: `apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx`

**Interfaces:**
- Produces: `export interface PreviewNav { hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; position: { index: number; total: number } | null; }`。`PreviewDialog` は既存props（`open`, `onOpenChange`, `name`, `path`）に加えて `nav?: PreviewNav` を受け取る

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx` の先頭 import を以下に変更する（`fireEvent` と `userEvent` を追加）。

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "./PreviewDialog";
```

ファイル末尾（既存の `describe("PreviewDialog", ...)` ブロックの閉じ `});` の後）に以下の新しい `describe` ブロックを追加する。

```tsx
describe("PreviewDialog nav", () => {
  it("nav未指定時は矢印ボタン・カウンタが描画されない", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.jpg" path="a.jpg" />);
    expect(screen.queryByRole("button", { name: "前のファイル" })).toBeNull();
    expect(screen.queryByRole("button", { name: "次のファイル" })).toBeNull();
  });

  it("nav指定時、矢印ボタンとカウンタが表示される", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{
          hasPrev: true,
          hasNext: true,
          onPrev: () => {},
          onNext: () => {},
          position: { index: 3, total: 12 },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "前のファイル" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次のファイル" })).toBeInTheDocument();
    expect(screen.getByText("3 / 12")).toBeInTheDocument();
  });

  it("次のファイルボタンをクリックするとonNextが呼ばれる", async () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev: () => {}, onNext, position: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "次のファイル" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("前のファイルボタンをクリックするとonPrevが呼ばれる", async () => {
    const onPrev = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev, onNext: () => {}, position: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "前のファイル" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("hasPrev: false のとき前のファイルボタンがdisabled", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: false, hasNext: true, onPrev: () => {}, onNext: () => {}, position: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "前のファイル" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次のファイル" })).not.toBeDisabled();
  });

  it("hasNext: false のとき次のファイルボタンがdisabled", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: false, onPrev: () => {}, onNext: () => {}, position: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "次のファイル" })).toBeDisabled();
  });

  it("ArrowRightキーでonNextが呼ばれる", () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev: () => {}, onNext, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("ArrowLeftキーでonPrevが呼ばれる", () => {
    const onPrev = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev, onNext: () => {}, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("hasNext: false のときArrowRightキーを送ってもonNextは呼ばれない", () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: false, onPrev: () => {}, onNext, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- PreviewDialog`
Expected: 新しい `describe("PreviewDialog nav", ...)` の9テストが全てFAIL（`PreviewDialog` が `nav` propを受け取らず、矢印ボタン・カウンタが一切描画されないため、`getByRole("button", {name: "前のファイル"})` 等が要素を見つけられずエラーになる）。既存の `describe("PreviewDialog", ...)` の4テストはこの時点でも引き続きPASSする

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` の現在の内容を確認する。**HEIC対応プランのTask 8が完了していれば**、以下のような内容になっているはずである（`HeicPreview` import・`isHeic` 分岐を含む）。

```tsx
import { classifyPreview } from "@nas-fm/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { HeicPreview } from "./HeicPreview";
import { TextPreview } from "./TextPreview";

export function PreviewDialog({
  open,
  onOpenChange,
  name,
  path,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
}) {
  const kind = classifyPreview(name);
  const isHeic = name.toLowerCase().endsWith(".heic");
  const url = api.previewUrl(path);
  const downloadHref = api.downloadUrl(path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {open && kind === "image" && !isHeic && (
          <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
        )}
        {open && kind === "image" && isHeic && (
          <HeicPreview
            key={path}
            name={name}
            url={api.thumbnailUrl(path, "preview")}
            downloadHref={downloadHref}
          />
        )}
        {open && kind === "video" && <video controls src={url} className="max-h-[70vh] w-full" />}
        {open && kind === "text" && <TextPreview url={url} />}
        {open && kind === null && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-muted-foreground">プレビューできません</p>
            <Button asChild>
              <a href={downloadHref} download>
                ダウンロード
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

このファイル全体を、以下の内容に置き換える。

```tsx
import { useEffect } from "react";
import { classifyPreview } from "@nas-fm/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { HeicPreview } from "./HeicPreview";
import { TextPreview } from "./TextPreview";

export interface PreviewNav {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: { index: number; total: number } | null;
}

export function PreviewDialog({
  open,
  onOpenChange,
  name,
  path,
  nav,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
  nav?: PreviewNav;
}) {
  const kind = classifyPreview(name);
  const isHeic = name.toLowerCase().endsWith(".heic");
  const url = api.previewUrl(path);
  const downloadHref = api.downloadUrl(path);

  useEffect(() => {
    if (!open || !nav) return;
    function handleKeyDown(e: KeyboardEvent) {
      // <video controls> にフォーカスがある場合、ブラウザ標準のシーク操作(←/→)と衝突するため
      // ナビゲーションをスキップする
      if (document.activeElement instanceof HTMLVideoElement) return;
      if (e.key === "ArrowLeft" && nav.hasPrev) nav.onPrev();
      if (e.key === "ArrowRight" && nav.hasNext) nav.onNext();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, nav]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="truncate">{name}</DialogTitle>
            {nav?.position && (
              <span className="shrink-0 text-sm text-muted-foreground">
                {nav.position.index} / {nav.position.total}
              </span>
            )}
          </div>
        </DialogHeader>
        {open && (
          <div className="relative">
            {kind === "image" && !isHeic && (
              <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
            )}
            {kind === "image" && isHeic && (
              <HeicPreview
                key={path}
                name={name}
                url={api.thumbnailUrl(path, "preview")}
                downloadHref={downloadHref}
              />
            )}
            {kind === "video" && <video controls src={url} className="max-h-[70vh] w-full" />}
            {kind === "text" && <TextPreview url={url} />}
            {kind === null && (
              <div className="space-y-3 py-6 text-center">
                <p className="text-muted-foreground">プレビューできません</p>
                <Button asChild>
                  <a href={downloadHref} download>
                    ダウンロード
                  </a>
                </Button>
              </div>
            )}
            {nav && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="前のファイル"
                  disabled={!nav.hasPrev}
                  onClick={nav.onPrev}
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="次のファイル"
                  disabled={!nav.hasNext}
                  onClick={nav.onNext}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
                >
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**もしHEIC対応プランのTask 8がまだ完了しておらず、`HeicPreview` importや `isHeic` 分岐が現在のファイルに存在しない場合は、この置き換え内容から `HeicPreview` の import と `isHeic` 関連の2ブロック（`kind === "image" && !isHeic` / `kind === "image" && isHeic`）を除いて、元の `kind === "image"` の単一分岐（`{kind === "image" && (<img .../>)}`）のまま適用すること。**

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- PreviewDialog`
Expected: PASS（既存4テスト＋新規9テスト、計13テスト）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/dialogs/PreviewDialog.tsx apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: プレビューモーダルに前後ナビゲーション(矢印・キー操作)を追加

EOF
)"
```

---

### Task 2: `FileBrowser` に前後ナビゲーション状態を配線する

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- Test: `apps/web/src/features/file-list/components/FileBrowser.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `PreviewDialog` の `nav?: PreviewNav` prop

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/components/FileBrowser.test.tsx` の末尾（最後の `it("ソートメニューの選択で並び順が変わる", ...)` の直後、`describe` ブロックを閉じる `});` の直前）に以下を追加する。import文の変更は不要（`within` と `userEvent` は既にimport済み）。

```ts
  it("ファイルをクリックしてモーダルを開き、次のファイルボタンで次のファイルに切り替わる", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "docs", size: 0, mtime: 0, type: "dir" },
        { name: "a.jpg", size: 1, mtime: 0, type: "file" },
        { name: "b.jpg", size: 1, mtime: 0, type: "file" },
      ],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.jpg")).toBeInTheDocument());

    await userEvent.click(screen.getByText("a.jpg"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img", { name: "a.jpg" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "次のファイル" }));
    expect(within(dialog).getByRole("img", { name: "b.jpg" })).toBeInTheDocument();
  });

  it("先頭では前のファイルボタンがdisabled、末尾では次のファイルボタンがdisabled", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "a.jpg", size: 1, mtime: 0, type: "file" },
        { name: "b.jpg", size: 1, mtime: 0, type: "file" },
      ],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.jpg")).toBeInTheDocument());

    await userEvent.click(screen.getByText("a.jpg"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "前のファイル" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "次のファイル" })).not.toBeDisabled();

    await userEvent.click(within(dialog).getByRole("button", { name: "次のファイル" }));
    expect(within(dialog).getByRole("button", { name: "次のファイル" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "前のファイル" })).not.toBeDisabled();
  });

  it("ディレクトリはナビゲーション対象から除外される", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "a.jpg", size: 1, mtime: 0, type: "file" },
        { name: "docs", size: 0, mtime: 0, type: "dir" },
        { name: "z.jpg", size: 1, mtime: 0, type: "file" },
      ],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.jpg")).toBeInTheDocument());

    await userEvent.click(screen.getByText("a.jpg"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "次のファイル" }));
    expect(within(dialog).getByRole("img", { name: "z.jpg" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: 新規3テストがFAIL（`FileBrowser` が `PreviewDialog` に `nav` を渡していないため、モーダル内に「前のファイル」「次のファイル」ボタンが描画されず、`within(dialog).getByRole("button", {name: "次のファイル"})` が要素を見つけられずエラーになる）

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/components/FileBrowser.tsx` の `const rel = (name: string) => (path ? \`${path}/${name}\` : name);` の行の直後、`return (` の直前に以下を追加する。

```tsx
  const previewableEntries = useMemo(
    () => sorted.filter((entry) => entry.type !== "dir"),
    [sorted],
  );
  const previewIndex = previewTarget
    ? previewableEntries.findIndex((entry) => entry.name === previewTarget.name)
    : -1;

  function navigatePreview(delta: number) {
    const next = previewableEntries[previewIndex + delta];
    if (next) setPreviewTarget(next);
  }
```

（`useMemo` は既にファイル冒頭で `import { useMemo, useState } from "react";` としてimport済みのため、import文の変更は不要）

次に、ファイル末尾付近の `<PreviewDialog>` 呼び出しを以下のように変更する。

現在:
```tsx
      <PreviewDialog
        open={previewTarget !== null}
        onOpenChange={(v) => !v && setPreviewTarget(null)}
        name={previewTarget?.name ?? ""}
        path={previewTarget ? rel(previewTarget.name) : ""}
      />
```

変更後:
```tsx
      <PreviewDialog
        open={previewTarget !== null}
        onOpenChange={(v) => !v && setPreviewTarget(null)}
        name={previewTarget?.name ?? ""}
        path={previewTarget ? rel(previewTarget.name) : ""}
        nav={{
          hasPrev: previewIndex > 0,
          hasNext: previewIndex >= 0 && previewIndex < previewableEntries.length - 1,
          onPrev: () => navigatePreview(-1),
          onNext: () => navigatePreview(1),
          position:
            previewIndex >= 0
              ? { index: previewIndex + 1, total: previewableEntries.length }
              : null,
        }}
      />
```

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
feat: FileBrowserからプレビューモーダルへ前後ナビゲーション状態を渡す

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
