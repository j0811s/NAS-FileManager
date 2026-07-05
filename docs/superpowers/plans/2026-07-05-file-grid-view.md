# ファイル一覧グリッド（サムネイル）表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ファイル一覧にグリッド（サムネイル）表示を追加し、デフォルト表示にする。

**Architecture:** `FileTable` と並列に `FileGrid` コンポーネントを新設し、`FileBrowser` が `viewMode` state（localStorage 永続化、デフォルト `"grid"`）で出し分ける。サムネイルは既存の inline 配信 API（`api.previewUrl()`、Range 対応済み）を `<img>` / `<video src="...#t=1">` に直接指定。グリッド表示中のソートは新設の `SortMenu`（DropdownMenu ベース）で行い、`sortKey` / `sortDir` state はテーブルと共有する。

**Tech Stack:** React 19 + Vite / Vitest + Testing Library / shadcn/ui（既存コンポーネントのみ、新規追加なし）/ lucide-react

**Spec:** `docs/superpowers/specs/2026-07-05-file-grid-view-design.md`

## Global Constraints

- 依存関係の追加なし・サーバ/shared の変更なし（`apps/web` のみ）
- 型のみの import は必ず `import type`（`verbatimModuleSyntax: true` でエラーになる）
- コミットは Conventional Commits（接頭辞は英語、本文・要約は日本語。例: `feat: グリッド表示を追加`）
- pre-commit で oxfmt → oxlint --fix → typecheck が自動で走る（手動整形は不要。コミットが落ちたらエラーを読んで直す）
- UI 文言は日本語
- テスト実行: `npm run test -w @nas-fm/web -- <ファイル名パターン>`（vitest run に渡る）
- localStorage キーは `nas-fm:view-mode`、値は `"table" | "grid"`、未保存・不正値は `"grid"` 扱い

---

### Task 1: FileGrid コンポーネント

**Files:**
- Create: `apps/web/src/features/file-list/components/FileGrid.tsx`
- Test: `apps/web/src/features/file-list/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `classifyPreview(filename): "image" | "video" | "text" | null`（`@nas-fm/shared`）/ `api.previewUrl(path): string`（`@/lib/api`、`/api/preview?path=<encoded>` を返す）/ `RowActions`（`./RowActions`、props: `entry, path, onPreview, onRename, onDelete, onMove`）
- Produces: `FileGrid` コンポーネント。props: `{ entries: FileEntry[]; path: string; onOpenDir: (name: string) => void; onPreview: (entry: FileEntry) => void; onRename: (entry: FileEntry) => void; onDelete: (entry: FileEntry) => void; onMove: (entry: FileEntry) => void }`（Task 2 の FileBrowser が使用）

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/components/FileGrid.test.tsx` を新規作成:

```tsx
import type { FileEntry } from "@nas-fm/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileGrid } from "./FileGrid";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "cat.jpg", size: 100, mtime: 1700000000000, type: "file" },
  { name: "mov.mp4", size: 200, mtime: 1700000000000, type: "file" },
  { name: "doc.pdf", size: 300, mtime: 1700000000000, type: "file" },
];

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
      {...overrides}
    />,
  );
}

describe("FileGrid", () => {
  it("エントリ名を表示する", () => {
    renderGrid();
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });

  it("フォルダカードのクリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    renderGrid({ onOpenDir });
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("ファイルカードのクリックで onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    renderGrid({ onPreview });
    await userEvent.click(screen.getByText("doc.pdf"));
    expect(onPreview).toHaveBeenCalledWith(entries[3]);
  });

  it("操作メニューのクリックでは onOpenDir/onPreview を呼ばない", async () => {
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    renderGrid({ onOpenDir, onPreview });
    await userEvent.click(screen.getAllByRole("button", { name: "操作メニュー" })[0]);
    expect(onOpenDir).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("画像は previewUrl を src に持つ遅延読み込み img を描画する", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=cat.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("サブフォルダ内では path を含めた previewUrl になる", () => {
    renderGrid({ path: "photos" });
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=photos%2Fcat.jpg");
  });

  it("動画は #t=1 付き previewUrl の video を描画する", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/api/preview?path=mov.mp4#t=1");
    expect(video?.getAttribute("preload")).toBe("metadata");
  });

  it("その他ファイルとフォルダはサムネイルを持たない", () => {
    const { container } = renderGrid({ entries: [entries[0], entries[3]] });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("画像の読み込み失敗でアイコンにフォールバックする", () => {
    renderGrid();
    fireEvent.error(screen.getByAltText("cat.jpg"));
    expect(screen.queryByAltText("cat.jpg")).not.toBeInTheDocument();
    expect(screen.getByText("cat.jpg")).toBeInTheDocument(); // 名前は残る
  });

  it("動画の読み込み失敗でアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(container.querySelector("video")).toBeNull();
  });

  it("映像トラックの無い動画(videoWidth=0)はアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video") as HTMLVideoElement;
    // jsdom の videoWidth は常に 0
    fireEvent(video, new Event("loadedmetadata"));
    expect(container.querySelector("video")).toBeNull();
  });

  it("映像トラックがあれば動画を維持する", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { value: 640 });
    fireEvent(video, new Event("loadedmetadata"));
    expect(container.querySelector("video")).not.toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileGrid`
Expected: FAIL（`./FileGrid` が解決できない旨のエラー）

- [ ] **Step 3: FileGrid を実装**

`apps/web/src/features/file-list/components/FileGrid.tsx` を新規作成:

```tsx
import { useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { File, Film, Folder, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { RowActions } from "./RowActions";

function Thumbnail({ name, relPath }: { name: string; relPath: string }) {
  const [failed, setFailed] = useState(false);
  const kind = classifyPreview(name);
  if (kind === "image" && !failed) {
    return (
      <img
        src={api.previewUrl(relPath)}
        alt={name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (kind === "video" && !failed) {
    return (
      <video
        src={`${api.previewUrl(relPath)}#t=1`}
        preload="metadata"
        muted
        playsInline
        className="pointer-events-none h-full w-full object-cover"
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => {
          // 音声のみの .ogg など映像トラックが無いと真っ黒なカードになるため
          if (e.currentTarget.videoWidth === 0) setFailed(true);
        }}
      />
    );
  }
  if (kind === "image") return <ImageIcon size={40} className="text-muted-foreground" />;
  if (kind === "video") return <Film size={40} className="text-muted-foreground" />;
  return <File size={40} className="text-muted-foreground" />;
}

export function FileGrid({
  entries,
  path,
  onOpenDir,
  onPreview,
  onRename,
  onDelete,
  onMove,
}: {
  entries: FileEntry[];
  path: string;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
}) {
  const rel = (name: string) => (path ? `${path}/${name}` : name);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {entries.map((entry) => (
        <div
          key={entry.name}
          className="relative cursor-pointer overflow-hidden rounded-lg border"
          onClick={() => (entry.type === "dir" ? onOpenDir(entry.name) : onPreview(entry))}
        >
          <div className="flex aspect-square items-center justify-center bg-muted">
            {entry.type === "dir" ? (
              <Folder size={40} className="text-muted-foreground" />
            ) : (
              <Thumbnail name={entry.name} relPath={rel(entry.name)} />
            )}
          </div>
          <p className="truncate px-2 py-1.5 text-sm" title={entry.name}>
            {entry.name}
          </p>
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
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- FileGrid`
Expected: PASS（12 件）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/file-list/components/FileGrid.tsx apps/web/src/features/file-list/components/FileGrid.test.tsx
git commit -m "feat: ファイル一覧のグリッド表示コンポーネントを追加"
```

---

### Task 2: FileBrowser の表示切替と localStorage 永続化

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- Test: `apps/web/src/features/file-list/components/FileBrowser.test.tsx`（追記）

**Interfaces:**
- Consumes: `FileGrid`（Task 1。props は Task 1 の Produces 参照）
- Produces: `viewMode: "table" | "grid"` state と `changeViewMode(mode)`（Task 3 が `viewMode === "grid"` 判定で SortMenu を出し分ける）。切替ボタンの aria-label は「グリッド表示」「テーブル表示」

- [ ] **Step 1: 失敗するテストを書く**

`FileBrowser.test.tsx` の `afterEach` を localStorage 掃除込みに変更:

```tsx
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
```

`describe("FileBrowser", ...)` 内に以下を追記:

```tsx
  it("初期表示はグリッド(localStorage 未保存時)", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("localStorage に table が保存されていればテーブル表示で始まる", async () => {
    localStorage.setItem("nas-fm:view-mode", "table");
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("切替ボタンで表示が切り替わり localStorage に保存される", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "テーブル表示" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(localStorage.getItem("nas-fm:view-mode")).toBe("table");

    await userEvent.click(screen.getByRole("button", { name: "グリッド表示" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(localStorage.getItem("nas-fm:view-mode")).toBe("grid");
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: FAIL（新規 3 件が失敗。既存テストは PASS のまま）

- [ ] **Step 3: FileBrowser に viewMode を実装**

`FileBrowser.tsx` の import に追加（既存の import 文を以下に変更）:

```tsx
import { FolderPlus, LayoutGrid, List } from "lucide-react";
```

`FileGrid` の import を追加（`FileTable` の import の隣）:

```tsx
import { FileGrid } from "./FileGrid";
```

モジュールスコープ（`export function FileBrowser` の直前）に追加:

```tsx
type ViewMode = "table" | "grid";
const VIEW_MODE_KEY = "nas-fm:view-mode";

function loadViewMode(): ViewMode {
  return localStorage.getItem(VIEW_MODE_KEY) === "table" ? "table" : "grid";
}
```

コンポーネント内の state 宣言群に追加:

```tsx
const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
```

`openDir` の隣に追加:

```tsx
function changeViewMode(mode: ViewMode) {
  setViewMode(mode);
  localStorage.setItem(VIEW_MODE_KEY, mode);
}
```

ツールバー行（`justify-end` の div）を以下に変更:

```tsx
      <div className="flex flex-wrap items-center justify-end gap-2">
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
      </div>
```

一覧描画部（`{data && (<FileTable ... />)}`）を以下に変更:

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
        />
      )}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: PASS（既存 4 件 + 新規 3 件。既存テストはグリッド表示のままでも通る想定 — 名前クリック・操作メニューの挙動はテーブルと同一のため）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/file-list/components/FileBrowser.tsx apps/web/src/features/file-list/components/FileBrowser.test.tsx
git commit -m "feat: ファイル一覧にグリッド/テーブル表示切替を追加(デフォルトはグリッド)"
```

---

### Task 3: グリッド表示用ソートメニュー

**Files:**
- Create: `apps/web/src/features/file-list/components/SortMenu.tsx`
- Test: `apps/web/src/features/file-list/components/SortMenu.test.tsx`
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- Test: `apps/web/src/features/file-list/components/FileBrowser.test.tsx`（追記）

**Interfaces:**
- Consumes: `SortKey = "name" | "size" | "mtime"` / `SortDir = "asc" | "desc"`（`../sort`）、Task 2 の `viewMode`
- Produces: `SortMenu` コンポーネント。props: `{ sortKey: SortKey; sortDir: SortDir; onSortKeyChange: (key: SortKey) => void; onSortDirChange: (dir: SortDir) => void }`。トリガーボタンの表示は「<キーのラベル> ▲/▼」（例: `名前 ▲`）

- [ ] **Step 1: SortMenu の失敗するテストを書く**

`apps/web/src/features/file-list/components/SortMenu.test.tsx` を新規作成:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SortMenu } from "./SortMenu";

describe("SortMenu", () => {
  it("現在のソートキーと方向をトリガーに表示する", () => {
    render(
      <SortMenu
        sortKey="mtime"
        sortDir="desc"
        onSortKeyChange={() => {}}
        onSortDirChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /更新日時 ▼/ })).toBeInTheDocument();
  });

  it("キー選択で onSortKeyChange を呼ぶ", async () => {
    const onSortKeyChange = vi.fn();
    render(
      <SortMenu
        sortKey="name"
        sortDir="asc"
        onSortKeyChange={onSortKeyChange}
        onSortDirChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前 ▲/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "サイズ" }));
    expect(onSortKeyChange).toHaveBeenCalledWith("size");
  });

  it("方向選択で onSortDirChange を呼ぶ", async () => {
    const onSortDirChange = vi.fn();
    render(
      <SortMenu
        sortKey="name"
        sortDir="asc"
        onSortKeyChange={() => {}}
        onSortDirChange={onSortDirChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前 ▲/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "降順" }));
    expect(onSortDirChange).toHaveBeenCalledWith("desc");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- SortMenu`
Expected: FAIL（`./SortMenu` が解決できない旨のエラー）

- [ ] **Step 3: SortMenu を実装**

`apps/web/src/features/file-list/components/SortMenu.tsx` を新規作成:

```tsx
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortDir, SortKey } from "../sort";

const SORT_KEY_LABELS: Record<SortKey, string> = {
  name: "名前",
  size: "サイズ",
  mtime: "更新日時",
};

export function SortMenu({
  sortKey,
  sortDir,
  onSortKeyChange,
  onSortDirChange,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSortKeyChange: (key: SortKey) => void;
  onSortDirChange: (dir: SortDir) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown size={16} className="mr-2" />
          {SORT_KEY_LABELS[sortKey]} {sortDir === "asc" ? "▲" : "▼"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sortKey}
          onValueChange={(v) => onSortKeyChange(v as SortKey)}
        >
          <DropdownMenuRadioItem value="name">名前</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="size">サイズ</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mtime">更新日時</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={sortDir}
          onValueChange={(v) => onSortDirChange(v as SortDir)}
        >
          <DropdownMenuRadioItem value="asc">昇順</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">降順</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: SortMenu のテストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- SortMenu`
Expected: PASS（3 件）

- [ ] **Step 5: FileBrowser 統合の失敗するテストを書く**

`FileBrowser.test.tsx` の `describe` 内に追記:

```tsx
  it("グリッド表示ではソートメニューを表示し、テーブル表示では隠す", async () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    renderWithClient(<FileBrowser />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /名前 ▲/ })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "テーブル表示" }));
    expect(screen.queryByRole("button", { name: /名前 ▲/ })).not.toBeInTheDocument();
  });

  it("ソートメニューの選択で並び順が変わる", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "big.bin", size: 100, mtime: 0, type: "file" },
        { name: "small.bin", size: 1, mtime: 0, type: "file" },
      ],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("big.bin")).toBeInTheDocument());
    const names = () => screen.getAllByTitle(/\.bin$/).map((el) => el.textContent);
    expect(names()).toEqual(["big.bin", "small.bin"]);

    await userEvent.click(screen.getByRole("button", { name: /名前 ▲/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "サイズ" }));
    await waitFor(() => expect(names()).toEqual(["small.bin", "big.bin"]));
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- FileBrowser`
Expected: FAIL（新規 2 件が失敗）

- [ ] **Step 7: FileBrowser に SortMenu を統合**

`FileBrowser.tsx` に import を追加:

```tsx
import { SortMenu } from "./SortMenu";
```

ツールバー行の先頭（グリッド表示ボタンの前）に追加:

```tsx
        {viewMode === "grid" && (
          <SortMenu
            sortKey={sortKey}
            sortDir={sortDir}
            onSortKeyChange={setSortKey}
            onSortDirChange={setSortDir}
          />
        )}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web`
Expected: PASS（web の全テスト）

- [ ] **Step 9: コミット**

```bash
git add apps/web/src/features/file-list/components/SortMenu.tsx apps/web/src/features/file-list/components/SortMenu.test.tsx apps/web/src/features/file-list/components/FileBrowser.tsx apps/web/src/features/file-list/components/FileBrowser.test.tsx
git commit -m "feat: グリッド表示用のソートメニューを追加"
```

---

### Task 4: 全体検証と実機確認

**Files:** なし（検証のみ。修正が出た場合は該当ファイル）

- [ ] **Step 1: 全ワークスペースのテスト・型チェック・lint を実行**

```bash
npm run test && npm run typecheck && npm run lint
```

Expected: すべて PASS / エラーなし

- [ ] **Step 2: dev サーバで実際の挙動を確認**

```bash
npm run dev
```

ブラウザで `http://localhost:5173` を開き（既に起動中なら流用）、以下を確認:

1. 初期表示がグリッドであること（localStorage を消した状態: DevTools > Application > Local Storage）
2. `.dev-share/` に画像（jpg/png）・動画（mp4）・その他（txt 等）・フォルダを置き、画像カードにサムネイル、動画カードに 1 秒目のフレーム、その他にアイコンが出ること
3. フォルダクリックで移動、ファイルクリックでプレビューが開くこと
4. カード右上の操作メニューから リネーム / 移動 / 削除 / DL が動くこと
5. ソートメニューでキー・方向を変えると並びが変わり、テーブルに切り替えても並びが維持されること
6. テーブル⇔グリッド切替がリロード後も維持されること

- [ ] **Step 3: 不具合があれば修正してコミット、なければ完了**

修正が出た場合は該当タスクの流れ（テスト → 実装 → コミット）で対応する。
