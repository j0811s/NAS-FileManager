# ディスク使用量表示 設計

日付: 2026-07-13
ステータス: 承認待ち

## 目的

NAS の共有ディスクがどれくらい空いているかを、ファイル一覧画面から一目で確認できるようにする。現状は Finder/SMB 側で確認するしかなく、Web アプリ単体では容量が把握できない。

## 方針（決定事項）

- 「使用量」は **NAS 全体（`NAS_ROOT` が乗っているファイルシステム）の空き/使用容量**（`df` 相当）。現在のフォルダ配下の合計サイズ（`du` 相当の再帰集計）は対象外
- **ヘッダーに常時表示**する（`LogoutButton` の並び）。専用メニュー/ダイアログは作らない
- **使用率 90% 以上で警告色**（`text-destructive`）にする。それ未満は通常色（`text-muted-foreground`）
- 値の更新タイミングは **ページ読込み時 + アップロード成功後 + 削除成功後に再取得**。ポーリングはしない
- `statfs` 自体が失敗する環境（稀）では、**表示を出さずに静かにフォールバック**する。トースト等のエラー通知は出さない（本体機能に影響しない付随情報のため）

## スコープ外

- フォルダ単位の使用量（`du` 相当の再帰集計）
- リアルタイム更新（ポーリング・WebSocket）
- 容量逼迫時の書き込みブロック等の能動的な制御（表示のみ）

## 設計

### サーバ

新規 feature `apps/server/src/features/disk-usage/` を作成する（`files` feature とは無関係な関心事のため独立させる。`.claude/rules/features.md` の feature 分離方針に沿う）。

**`disk-usage.service.ts`**

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

**`disk-usage.routes.ts`**

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

`app.ts` に配線（`files` / `thumbnails` と同様の `app.route("/api", ...)` パターン）:

```ts
import { createDiskUsageRoutes } from "./features/disk-usage/disk-usage.routes";
// ...
app.route("/api", createDiskUsageRoutes(root));
```

`statfs` が例外を投げた場合は既存の `app.onError` の汎用フォールバック（`INTERNAL` / 500）にそのまま乗せる。ハンドラ内で個別の try/catch はしない。

### shared 型

`packages/shared/src/types.ts` に追加:

```ts
export interface DiskUsageResponse {
  total: number;
  used: number;
  free: number;
}
```

`packages/shared/src/index.ts` の `export type { ... }` 一覧に `DiskUsageResponse` を追加。

### フロント

新規 feature `apps/web/src/features/disk-usage/`（`auth` feature と同じ構成: `hooks/` / `components/` / `index.ts`）。

**`apps/web/src/lib/api.ts`** に追加:

```ts
async diskUsage(): Promise<DiskUsageResponse> {
  const res = await request("/api/disk-usage");
  return (await res.json()) as DiskUsageResponse;
},
```

**`hooks/useDiskUsage.ts`**

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

`statfs` 失敗時にサーバが 500 を返すケースを想定し `retry: false`（無駄なリトライをしない。UI 側は `data` が無ければ何も描画しないだけなので、失敗時のエラー状態を個別にハンドリングする必要はない）。

**`components/DiskUsageBadge.tsx`**

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

`data.total === 0` のような異常値のケースは実運用上起こらない想定のため、ゼロ除算ガード等は入れない。

**`index.ts`**

```ts
export { DiskUsageBadge } from "./components/DiskUsageBadge";
export { useDiskUsage } from "./hooks/useDiskUsage";
```

**`apps/web/src/app/App.tsx`** の `Header` に配線:

```tsx
import { DiskUsageBadge } from "@/features/disk-usage";
// ...
<header className="flex items-center justify-between border-b px-6 py-4">
  <h1 className="text-xl font-semibold">NAS-FileManager</h1>
  <div className="flex items-center gap-4">
    {data?.authenticated && <DiskUsageBadge />}
    {data?.authenticated && <LogoutButton />}
  </div>
</header>
```

`DiskUsageBadge` も認証必須エンドポイントを叩くため、`LogoutButton` と同じく `data?.authenticated` の条件下に置く。

### アップロード/削除後の再取得

- `apps/web/src/features/upload/hooks/useUpload.ts` の `upload` 成功時（`qc.invalidateQueries({ queryKey: ["list", path] })` の直後）に `qc.invalidateQueries({ queryKey: ["disk-usage"] })` を追加
- `apps/web/src/features/file-list/hooks/useFileMutations.ts` の `remove` の `onSuccess`（`invalidate()` の直後）に同様の invalidate を追加。`mkdir` / `rename` はディスク使用量を変えないため対象外

## テスト（Vitest）

- サーバ: `disk-usage.service.test.ts` — `getDiskUsage` が実 fs（`fs.mkdtemp` の一時ディレクトリ、既存の files feature と同じ方針）に対して `total >= used + free` となる妥当な値を返すことを確認（`statfs` の実値は環境依存のため、具体的な数値ではなく整合性を検証する）
- サーバ: `disk-usage.routes.test.ts` — `GET /api/disk-usage` が 200 で `{ total, used, free }` を返すこと
- フロント: `DiskUsageBadge.test.tsx` — `useDiskUsage` をモックし、(1) 使用率 90% 未満で通常色、(2) 90% 以上で `text-destructive` になること、(3) `data` が無い間は何も描画されないことを確認
- フロント: `useFileMutations.test.tsx` / `useUpload.test.tsx` に、削除・アップロード成功時に `["disk-usage"]` の `invalidateQueries` が呼ばれることのテストを追記

## 影響範囲

- 新規: `apps/server/src/features/disk-usage/`（`disk-usage.routes.ts` / `disk-usage.service.ts` / 対応するテスト）
- 新規: `apps/web/src/features/disk-usage/`（`components/DiskUsageBadge.tsx` / `hooks/useDiskUsage.ts` / `index.ts` / 対応するテスト）
- 変更: `apps/server/src/app.ts`（ルート配線）
- 変更: `packages/shared/src/types.ts` / `packages/shared/src/index.ts`（`DiskUsageResponse` 追加）
- 変更: `apps/web/src/lib/api.ts`（`diskUsage()` 追加）
- 変更: `apps/web/src/app/App.tsx`（`Header` に `DiskUsageBadge` を配線）
- 変更: `apps/web/src/features/upload/hooks/useUpload.ts` / `apps/web/src/features/file-list/hooks/useFileMutations.ts`（成功時 invalidate 追加）
- 依存追加: なし（`node:fs/promises` の `statfs` は標準）
