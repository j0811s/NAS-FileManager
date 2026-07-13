# 検索 設計

日付: 2026-07-13
ステータス: 承認待ち

## 目的

現状はパンくずと一覧だけでファイルを探すしかなく、フォルダ数が増えると目的のファイルにたどり着きにくい。NAS全体からファイル名・フォルダ名で検索し、見つかった項目のあるフォルダへすぐ移動できるようにする。

## 方針（決定事項）

- **検索範囲は NAS 全体を再帰的に検索**（現在開いているフォルダの位置に関係ない）
- **検索対象はファイル・フォルダ名のみ**（部分一致・大文字小文字を区別しない）。テキストファイルの中身までは検索しない
- **入り口はヘッダーの検索アイコン**。クリックで開く Dialog 内に入力欄と結果一覧を表示する
- **入力中に自動発火**（デバウンス400ms）。Enter や検索ボタンは不要
- **結果の項目をクリックするとダイアログを閉じ、その項目の親フォルダへ移動する**（ファイル・フォルダのどちらでも親フォルダへ。一覧内でのハイライト・自動スクロールは行わない）
- 結果は**最大200件**で打ち切り、超過時はその旨を表示する（`truncated` フラグ）

## スコープ外

- テキストファイルの中身の全文検索
- 検索結果からの直接プレビュー・削除などの操作（「そこへ移動する」だけ）
- 一覧内でのハイライト・自動スクロール
- 検索履歴・保存検索

## 既存コードの改善（この機能に必要なため含める）

`apps/web/src/features/file-list/hooks/useHashPath.ts` は URL ハッシュを介してフォルダパスを読み書きする hook で、現在は `file-list` feature 内に閉じている。検索結果クリックでの遷移（`file-list` の外＝ヘッダーに置く `search` feature から）にもこの hook が必要になるため、`.claude/rules/features.md` の「feature 横断の共通ロジックは各アプリの `lib/`」という方針に従い、`apps/web/src/lib/useHashPath.ts` へ移動する（実装内容は変更しない。テストファイルも同じ場所に移動し、`FileBrowser.tsx` の import 元だけ更新する）。

## 設計

### サーバ: 新規 feature `apps/server/src/features/search/`

**`search.schema.ts`**

```ts
import { AppError } from "../../lib/errors";

export function requireQuery(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new AppError("INVALID_REQUEST", "q is required");
  }
  return trimmed;
}
```

**`search.service.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { SearchResponse } from "@nas-fm/shared";
import { TRASH_DIR_NAME } from "../trash/trash.service";

const MAX_RESULTS = 200;

export async function searchFiles(root: string, query: string): Promise<SearchResponse> {
  const q = query.toLowerCase();
  const entries: SearchResponse["entries"] = [];
  let truncated = false;

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (truncated) return;
    const dirents = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (truncated) return;
      if (dirent.isSymbolicLink()) continue;
      if (relDir === "" && dirent.name === TRASH_DIR_NAME) continue;

      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (dirent.name.toLowerCase().includes(q)) {
        if (entries.length >= MAX_RESULTS) {
          truncated = true;
          return;
        }
        const absPath = path.join(absDir, dirent.name);
        const st = await fs.stat(absPath).catch(() => null);
        if (st) {
          entries.push({
            name: dirent.name,
            path: relPath,
            type: st.isDirectory() ? "dir" : "file",
            size: st.isDirectory() ? 0 : st.size,
            mtime: Math.trunc(st.mtimeMs),
          });
        }
      }

      if (dirent.isDirectory()) {
        await walk(path.join(absDir, dirent.name), relPath);
      }
    }
  }

  await walk(root, "");
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, truncated };
}
```

シンボリックリンクはスキップする（循環参照防止。`files.service.ts` の `walkAndAppend` と同じ方針）。`.trash` はルート直下でのみ除外する（`.trash` はルートにしか存在しないため）。

**`search.routes.ts`**

```ts
import { Hono } from "hono";
import type { SearchResponse } from "@nas-fm/shared";
import { requireQuery } from "./search.schema";
import { searchFiles } from "./search.service";

export function createSearchRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/search", async (c) => {
    const q = requireQuery(c.req.query("q"));
    const res: SearchResponse = await searchFiles(root, q);
    return c.json(res);
  });

  return app;
}
```

`app.ts` に `app.route("/api", createSearchRoutes(root));` を追加配線する（既存の `files` / `thumbnails` / `disk-usage` / `trash` と同じパターン）。

### shared 型

`packages/shared/src/types.ts` に追加:

```ts
export interface SearchEntry extends FileEntry {
  /** マッチした項目自身の、NAS_ROOT からの相対パス */
  path: string;
}

export interface SearchResponse {
  entries: SearchEntry[];
  truncated: boolean;
}
```

`packages/shared/src/index.ts` の `export type { ... }` に `SearchEntry` / `SearchResponse` を追加（アルファベット順、`RenameRequest` の後・`TrashEntry` の前）。

### フロント: `apps/web/src/lib/api.ts`

```ts
async search(query: string): Promise<SearchResponse> {
  const res = await request(`/api/search?q=${encodeURIComponent(query)}`);
  return (await res.json()) as SearchResponse;
},
```

### フロント: 新規 feature `apps/web/src/features/search/`

**`hooks/useSearch.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["search", trimmed],
    queryFn: () => api.search(trimmed),
    enabled: trimmed !== "",
  });
}
```

**`components/SearchDialog.tsx`**

- `Dialog` 内に `Input`（検索キーワード）+ `Table`（名前・場所・サイズ）
- 入力値は即座に state に反映しつつ、400ms のデバウンス後の値を `useSearch` に渡す
- 表示分岐: 未入力（trimして空）→「検索キーワードを入力してください」、`isFetching` → 「検索中…」、0件 → 「見つかりませんでした」、`truncated` → 結果一覧の下に「結果が多いため一部のみ表示しています」
- 行クリック: `apps/web/src/lib/useHashPath.ts` の `useHashPath()` から得た `navigate` に、クリックした項目の親フォルダ（`path` から `lastIndexOf("/")` で算出。無ければ `""`）を渡し、ダイアログを閉じる

**`components/SearchButton.tsx`**

- `TrashButton` と同じ自己完結パターン（`open` state を自前で持ち、ボタンと `SearchDialog` を両方レンダリングする）。アイコンは `lucide-react` の `Search`、`aria-label="検索"`

**`index.ts`**

```ts
export { SearchButton } from "./components/SearchButton";
```

### `App.tsx` の `Header` への配線

```tsx
<div className="flex items-center gap-4">
  {data?.authenticated && <DiskUsageBadge />}
  {data?.authenticated && <SearchButton />}
  {data?.authenticated && <TrashButton />}
  {data?.authenticated && <LogoutButton />}
</div>
```

## テスト（Vitest）

- サーバ: `search.service.test.ts` — 部分一致（大文字小文字を無視）、フォルダ名も対象になる、ネストしたフォルダ内も見つかる、`.trash` 配下は対象外、シンボリックリンクは対象外、200件を超えると `truncated: true` になり201件目以降は含まれない
- サーバ: `search.routes.test.ts` — 200系（一致した項目を返す）、未認証401、`q` 未指定/空文字は400
- フロント: `useSearch.test.tsx` — 空文字では `enabled: false` のため `api.search` が呼ばれない、非空文字では呼ばれる
- フロント: `SearchDialog.test.tsx` — 未入力時のメッセージ、0件時のメッセージ、結果表示、行クリックで `navigate`（`useHashPath` 経由）が正しい親フォルダパスで呼ばれることとダイアログが閉じること
- フロント: `SearchButton.test.tsx` — クリックでダイアログが開く

## 影響範囲

- 新規: `apps/server/src/features/search/`（`search.schema.ts` / `search.service.ts` / `search.routes.ts` / 対応するテスト）
- 新規: `apps/web/src/features/search/`（`hooks/useSearch.ts` / `components/SearchDialog.tsx` / `components/SearchButton.tsx` / `index.ts` / 対応するテスト）
- 変更: `apps/server/src/app.ts`（ルート配線）
- 変更: `packages/shared/src/types.ts` / `packages/shared/src/index.ts`（`SearchEntry` / `SearchResponse` 追加）
- 変更: `apps/web/src/lib/api.ts`（`search` 追加）
- 変更: `apps/web/src/app/App.tsx`（`SearchButton` を配線）
- 移動: `apps/web/src/features/file-list/hooks/useHashPath.ts` / `useHashPath.test.ts` → `apps/web/src/lib/useHashPath.ts` / `useHashPath.test.ts`（実装は無変更）
- 変更: `apps/web/src/features/file-list/components/FileBrowser.tsx`（`useHashPath` の import 元を `@/lib/useHashPath` に変更）
- 依存追加: なし
