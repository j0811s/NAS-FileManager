# 削除の取り消し（ゴミ箱） 設計

日付: 2026-07-13
ステータス: 承認待ち

## 目的

現在の `DELETE /api/delete` はファイル/フォルダを即座に物理削除し、取り消せない。誤操作からの回復手段として、削除を「ゴミ箱への移動」に変え、復元・完全削除ができる画面を追加する。

## 方針（決定事項）

- UXは **ゴミ箱画面**方式（macOS/Windowsのゴミ箱と同じ感覚）。Gmail 風のタイムアウト式アンドゥは採用しない
- ゴミ箱の実データは **`NAS_ROOT/.trash/` に置く**（`.thumb-cache` とは異なり、同一ファイルシステム内の `rename` で大容量ファイルでも軽量に移動するため。トレードオフとして、Samba設定次第では稀に見える可能性があるが許容する）
- ゴミ箱内の項目は **削除から30日経過で自動的に完全削除**する。バックグラウンドジョブは持たず、`GET /api/trash`（ゴミ箱一覧取得）が呼ばれるたびに期限切れ分を掃除する遅延パージ方式
- ゴミ箱画面への入り口は **ヘッダーのアイコンボタン**。クリックで Dialog を開いて中身を一覧表示する
- `DELETE /api/delete?path=` の**エンドポイント自体は変更しない**。フロントからは従来どおり「削除」として見えるが、サーバ内部の実装だけをソフトデリートに変える
- 「ゴミ箱を空にする」一括操作は作らない（YAGNI）。30日自動清掃 + 個別の完全削除で足りる
- 復元時、元の親フォルダが無くなっていれば自動で再作成する。元のパスに同名の項目が既に存在する場合は `CONFLICT` で拒否（上書きしない）
- 「完全に削除」は不可逆操作のため、既存の `DeleteDialog` と同様に確認ダイアログを挟む

## スコープ外

- `.trash/*` への直接アクセス防止（`/api/download?path=.trash/...` 等での推測アクセス）。UUIDにより実質推測不可能なため、`listDir` からの除外とzipダウンロードからの除外のみ行い、各エンドポイントへの個別ガードは追加しない
- ゴミ箱の一括空化 UI
- 復元時の自動リネーム（衝突時は `CONFLICT` を返すのみで、自動的に別名を付けたりはしない）

## 設計

### サーバ: 新規 feature `apps/server/src/features/trash/`

**データ形式**（`NAS_ROOT/.trash/` 配下）:
- `<uuid>/<元のbasename>` — 移動されたファイル/フォルダそのもの
- `<uuid>.json` — メタデータ `{ originalPath: string; deletedAt: number }`

**`trash.service.ts`**

```ts
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TrashEntry } from "@nas-fm/shared";
import { AppError, fromFsError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

export const TRASH_DIR_NAME = ".trash";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface TrashMeta {
  originalPath: string;
  deletedAt: number;
}

function trashRoot(root: string): string {
  return path.join(root, TRASH_DIR_NAME);
}

async function readMeta(metaPath: string): Promise<TrashMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrashMeta>;
    if (typeof parsed.originalPath !== "string" || typeof parsed.deletedAt !== "number") {
      return null;
    }
    return { originalPath: parsed.originalPath, deletedAt: parsed.deletedAt };
  } catch {
    // 壊れた/存在しないメタデータは「無い」扱いにする（呼び出し側でスキップ or NOT_FOUND にする）
    return null;
  }
}

async function removeTrashFiles(root: string, id: string): Promise<void> {
  const dir = trashRoot(root);
  await fs.rm(path.join(dir, id), { recursive: true, force: true });
  await fs.rm(path.join(dir, `${id}.json`), { force: true });
}

export async function moveToTrash(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "cannot delete the root directory");
  }
  const st = await fs.lstat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }

  const id = randomUUID();
  const itemDir = path.join(trashRoot(root), id);
  await fs.mkdir(itemDir, { recursive: true });
  const basename = path.basename(abs);
  try {
    await fs.rename(abs, path.join(itemDir, basename));
  } catch (err) {
    await fs.rm(itemDir, { recursive: true, force: true }).catch(() => undefined);
    throw fromFsError(err, relPath);
  }
  const meta: TrashMeta = { originalPath: relPath, deletedAt: Date.now() };
  await fs.writeFile(path.join(trashRoot(root), `${id}.json`), JSON.stringify(meta));
}

export async function listTrash(root: string): Promise<TrashEntry[]> {
  const dir = trashRoot(root);
  const names = await fs.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw fromFsError(err, TRASH_DIR_NAME);
  });
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));

  const entries: TrashEntry[] = [];
  for (const id of ids) {
    const meta = await readMeta(path.join(dir, `${id}.json`));
    if (!meta) continue; // 壊れたエントリはスキップ（一覧を止めない）

    if (Date.now() - meta.deletedAt > RETENTION_MS) {
      await removeTrashFiles(root, id);
      continue;
    }

    const itemDir = path.join(dir, id);
    const itemNames = await fs.readdir(itemDir).catch(() => []);
    const name = itemNames[0];
    if (!name) continue; // 実体が無い壊れたエントリはスキップ

    const st = await fs.stat(path.join(itemDir, name)).catch(() => null);
    if (!st) continue;

    entries.push({
      id,
      name,
      originalPath: meta.originalPath,
      type: st.isDirectory() ? "dir" : "file",
      size: st.isDirectory() ? 0 : st.size,
      deletedAt: meta.deletedAt,
    });
  }
  entries.sort((a, b) => b.deletedAt - a.deletedAt);
  return entries;
}

export async function restoreFromTrash(root: string, id: string): Promise<void> {
  const dir = trashRoot(root);
  const meta = await readMeta(path.join(dir, `${id}.json`));
  if (!meta) {
    throw new AppError("NOT_FOUND", `trash entry not found: ${id}`);
  }
  const itemDir = path.join(dir, id);
  const itemNames = await fs.readdir(itemDir).catch(() => []);
  const name = itemNames[0];
  if (!name) {
    throw new AppError("NOT_FOUND", `trash entry not found: ${id}`);
  }

  const dest = safeResolve(root, meta.originalPath);
  const existing = await fs.lstat(dest).catch(() => null);
  if (existing) {
    throw new AppError("CONFLICT", `already exists: ${meta.originalPath}`);
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(path.join(itemDir, name), dest);
  } catch (err) {
    throw fromFsError(err, meta.originalPath);
  }
  await removeTrashFiles(root, id);
}

export async function purgeTrashEntry(root: string, id: string): Promise<void> {
  const meta = await readMeta(path.join(trashRoot(root), `${id}.json`));
  if (!meta) {
    throw new AppError("NOT_FOUND", `trash entry not found: ${id}`);
  }
  await removeTrashFiles(root, id);
}
```

**`trash.routes.ts`**

```ts
import { Hono } from "hono";
import type { OkResponse, TrashListResponse, TrashRestoreRequest } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { listTrash, purgeTrashEntry, restoreFromTrash } from "./trash.service";

function parseRestoreBody(value: unknown): TrashRestoreRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { id?: unknown }).id !== "string" ||
    (value as { id: string }).id === ""
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { id: string }");
  }
  return { id: (value as { id: string }).id };
}

export function createTrashRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/trash", async (c) => {
    const entries = await listTrash(root);
    const res: TrashListResponse = { entries };
    return c.json(res);
  });

  app.post("/trash/restore", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new AppError("INVALID_REQUEST", "invalid JSON body");
    }
    const { id } = parseRestoreBody(body);
    await restoreFromTrash(root, id);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.delete("/trash", async (c) => {
    const id = c.req.query("id");
    if (!id) {
      throw new AppError("INVALID_REQUEST", "id is required");
    }
    await purgeTrashEntry(root, id);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  return app;
}
```

`app.ts` に `app.route("/api", createTrashRoutes(root));` を追加配線する（`createFilesRoutes` と同じパターン）。

### `files` feature の変更

- `files.service.ts` から `removePath` を削除する（実装が丸ごと `trash.service.ts` の `moveToTrash` に置き換わる）
- `files.routes.ts` の `DELETE /delete` ハンドラを変更:

```ts
  app.delete("/delete", async (c) => {
    const rel = requirePath(c.req.query("path"));
    await moveToTrash(root, rel);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });
```

import 元を `./files.service` の `removePath` から `../trash/trash.service` の `moveToTrash` に差し替える。

- `listDir`（`files.service.ts`）で `.trash` を除外する:

```ts
  for (const name of names) {
    if (name === TRASH_DIR_NAME) continue;
    // ...既存の処理
  }
```

`TRASH_DIR_NAME` は `../trash/trash.service` から import する（マジック文字列の重複を避ける）。

- `createFolderZipStream` の内部 `walkAndAppend`（`files.service.ts`）でも同様に `.trash` をスキップする:

```ts
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === TRASH_DIR_NAME) continue;
    // ...既存の処理
  }
```

### shared 型

`packages/shared/src/types.ts` に追加:

```ts
export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  type: FileType;
  size: number;
  /** 削除時刻（epoch ミリ秒） */
  deletedAt: number;
}

export interface TrashListResponse {
  entries: TrashEntry[];
}

export interface TrashRestoreRequest {
  id: string;
}
```

`packages/shared/src/index.ts` の `export type { ... }` に `TrashEntry` / `TrashListResponse` / `TrashRestoreRequest` を追加（アルファベット順）。

### フロント: `apps/web/src/lib/api.ts`

```ts
async listTrash(): Promise<TrashListResponse> {
  const res = await request("/api/trash");
  return (await res.json()) as TrashListResponse;
},

async restoreFromTrash(id: string): Promise<void> {
  await request("/api/trash/restore", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ id }),
  });
},

async purgeTrashEntry(id: string): Promise<void> {
  await request(`/api/trash?id=${encodeURIComponent(id)}`, { method: "DELETE" });
},
```

### フロント: 新規 feature `apps/web/src/features/trash/`

**`hooks/useTrash.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTrash() {
  return useQuery({ queryKey: ["trash"], queryFn: () => api.listTrash() });
}
```

**`hooks/useTrashMutations.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

function toastError(err: unknown): void {
  const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
  toast.error(errorMessage(code));
}

export function useTrashMutations() {
  const qc = useQueryClient();
  const invalidateTrash = () => qc.invalidateQueries({ queryKey: ["trash"] });

  const restore = useMutation({
    mutationFn: (id: string) => api.restoreFromTrash(id),
    onSuccess: () => {
      invalidateTrash();
      qc.invalidateQueries({ queryKey: ["list"] });
      toast.success("復元しました");
    },
    onError: toastError,
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.purgeTrashEntry(id),
    onSuccess: () => {
      invalidateTrash();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      toast.success("完全に削除しました");
    },
    onError: toastError,
  });

  return { restore, purge };
}
```

`["list"]` を `exact` 指定なしで invalidate すると、現在マウントされている `["list", path]` クエリ全てが対象になる（React Query のデフォルト動作）。復元先がどのフォルダかを気にせず、開いている一覧を再取得できる。

**`components/TrashDialog.tsx`**

- `Dialog` の中に `Table`（`name` / `originalPath` / `deletedAt` / サイズ / アクション列）
- 行ごとに「復元」ボタン（`restore.mutate(entry.id)`）と「完全に削除」ボタン
- 「完全に削除」は誤操作防止のため、既存 `DeleteDialog` と同様に `AlertDialog` の確認を挟んでから `purge.mutate(entry.id)` を呼ぶ（`TrashDialog` 内で `purgeTarget: TrashEntry | null` の state を持つ簡易実装。別ファイルには切り出さず `TrashDialog.tsx` 内にネストして書く）
- 空のときは「ゴミ箱は空です」を表示
- `deletedAt` は `new Date(entry.deletedAt).toLocaleString("ja-JP")`（`FileTable` と同じ表記）で表示

**`components/TrashButton.tsx`**

```tsx
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrashDialog } from "./TrashDialog";

export function TrashButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label="ゴミ箱" onClick={() => setOpen(true)}>
        <Trash2 size={16} />
      </Button>
      <TrashDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
```

`TrashButton` が開閉状態を自己完結で持つため、`App.tsx` 側は `<TrashButton />` を置くだけでよい（`DiskUsageBadge` と同じ「feature が自己完結する」方針に揃える）。

**`index.ts`**

```ts
export { TrashButton } from "./components/TrashButton";
```

### `App.tsx` の `Header` への配線

```tsx
<div className="flex items-center gap-4">
  {data?.authenticated && <DiskUsageBadge />}
  {data?.authenticated && <TrashButton />}
  {data?.authenticated && <LogoutButton />}
</div>
```

### `DeleteDialog.tsx` の文言修正

```tsx
<AlertDialogDescription>
  「{targetName}
  」をゴミ箱に移動します。フォルダの場合は中身ごと移動されます。ゴミ箱の項目は30日後に自動的に完全削除されます。
</AlertDialogDescription>
```

「この操作は取り消せません」の文言を削除する。

### Feature 1（ディスク使用量表示）との整合

- ソフトデリート（`moveToTrash`）は同一ファイルシステム内の `rename` のため、実行しても空き容量は変化しない。既存の `useFileMutations.remove.onSuccess` に既にある `["disk-usage"]` の invalidate はそのまま残す（無害。値が変わらないだけ）
- 実際に空き容量が変わるのは「完全に削除」（`useTrashMutations.purge`）と自動清掃（`listTrash` 内、`GET /api/trash` 経由）のとき。`purge` 成功時に `["disk-usage"]` を invalidate することで反映する。自動清掃は `GET /api/trash` を叩いたとき＝ゴミ箱ダイアログを開いたときに走るため、`useTrash` のクエリ成功時にも `["disk-usage"]` を invalidate しておくと良いが、**今回はスコープ外とする**（ゴミ箱を開くたびに空き容量が微妙にズレたまま表示され続けるのは許容範囲。次にアップロード/削除/完全削除のいずれかが起きれば自然に最新化される）

## テスト（Vitest）

- サーバ: `trash.service.test.ts`
  - `moveToTrash`: ファイル/空でないディレクトリを移動できる（元の場所から消え、`.trash/<id>/` に実体がある）、存在しないパスは `NOT_FOUND`、root自身は `INVALID_REQUEST`
  - `listTrash`: 移動した項目が一覧に出る（`name` / `originalPath` / `type` / `size` / `deletedAt` を検証）、30日超のエントリは自動的に取り除かれ二度と一覧に出ない（`deletedAt` を過去日時に書き換えたメタデータファイルを直接用意してテストする）、壊れたメタデータ（不正JSON）は無視してクラッシュしない
  - `restoreFromTrash`: 元の場所に戻る、存在しない `id` は `NOT_FOUND`、元の場所に同名の項目があれば `CONFLICT`、元の親フォルダが削除済みでも自動再作成されて復元できる
  - `purgeTrashEntry`: `.trash/<id>/` と `<id>.json` が両方消える、存在しない `id` は `NOT_FOUND`
- サーバ: `trash.routes.test.ts` — `GET /api/trash` / `POST /api/trash/restore` / `DELETE /api/trash?id=` の 200 系・未認証401・NOT_FOUND404・CONFLICT409 を一通り
- サーバ: `files.routes.test.ts` の既存 `DELETE /api/delete` テスト（200 / 404 / root400）は無変更のまま通ることを確認（ブラックボックスの挙動は変わらないため）
- サーバ: `files.routes.test.ts` に追加 — 削除後、`GET /api/list` の結果に `.trash` 自体が出てこないこと。ルート直下を `GET /api/download?path=`（フォルダzip）した際、zip内に `.trash` 配下が含まれないこと
- サーバ: `files.service.test.ts` から `removePath` の `describe` ブロックと import を削除
- フロント: `TrashDialog.test.tsx` — 一覧表示、「復元」クリックで `restore.mutate` が呼ばれる、「完全に削除」→確認→実行で `purge.mutate` が呼ばれる、空のときのメッセージ
- フロント: `useTrashMutations.test.tsx` — restore 成功時に `["trash"]` と `["list"]` を invalidate、purge 成功時に `["trash"]` と `["disk-usage"]` を invalidate
- フロント: `DeleteDialog.test.tsx`（既存があれば更新、無ければ新規）— 新しい文言が表示されること

## 影響範囲

- 新規: `apps/server/src/features/trash/`（`trash.service.ts` / `trash.routes.ts` / 対応するテスト）
- 新規: `apps/web/src/features/trash/`（`hooks/useTrash.ts` / `hooks/useTrashMutations.ts` / `components/TrashDialog.tsx` / `components/TrashButton.tsx` / `index.ts` / 対応するテスト）
- 変更: `apps/server/src/app.ts`（ルート配線）
- 変更: `apps/server/src/features/files/files.service.ts`（`removePath` 削除、`listDir` / `walkAndAppend` に `.trash` 除外を追加）
- 変更: `apps/server/src/features/files/files.routes.ts`（`DELETE /delete` の実装差し替え）
- 変更: `apps/server/src/features/files/files.service.test.ts`（`removePath` テスト削除）
- 変更: `apps/server/src/features/files/files.routes.test.ts`（`.trash` 除外のテスト追加）
- 変更: `packages/shared/src/types.ts` / `packages/shared/src/index.ts`（`TrashEntry` / `TrashListResponse` / `TrashRestoreRequest` 追加）
- 変更: `apps/web/src/lib/api.ts`（`listTrash` / `restoreFromTrash` / `purgeTrashEntry` 追加）
- 変更: `apps/web/src/app/App.tsx`（`TrashButton` を配線）
- 変更: `apps/web/src/features/file-list/dialogs/DeleteDialog.tsx`（文言修正）
- 依存追加: なし（`node:crypto` の `randomUUID` は標準）
