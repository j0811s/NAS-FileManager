# モバイルアップロード進捗UI改善（グローバルアップロードキュー）設計

日付: 2026-08-01
ステータス: 承認待ち

## 目的

iPhone Safari から「写真」アプリのギャラリーで数十〜数百枚をまとめて選択してアップロードするケースで、「今どれくらい進んでいるか分からない」「フォルダを移動すると進捗が消える」という不満を解消する。

## 背景（現状の問題）

- `UploadDropzone` は選択/ドロップされた複数ファイルを `for...await` で完全に逐次アップロードしており（`apps/web/src/features/upload/components/UploadDropzone.tsx:12-17`）、進捗表示は「今アップロード中の1ファイルの%」のみ（`useUpload.ts:9`）。合計枚数・残り枚数・全体%が無いため、大量選択時に進捗が体感できない
- アップロード状態は `useUpload` フック内のローカル `useState` のみで保持されており、グローバルなキュー管理が存在しない。アップロード中に別フォルダへ移動すると `UploadDropzone` ごとアンマウントされ、進捗を確認する手段が完全に失われる
- 失敗時の再試行、複数ファイルの一覧表示、同時並列アップロードのいずれも未実装

## 方針（決定事項）

- アップロードキューを `useUpload` フックのローカル状態から**アプリ全体で共有するストア**に格上げする。新規ライブラリ（zustand等）は追加せず、`useSyncExternalStore` ベースの自前ストアを使う
- ストアはコンポーネントのマウント状態と無関係に動作し続ける。**どのフォルダ画面に移動してもキューの進捗は失われない**
- 画面下部に**常時表示のアップロードトレイ**（`UploadTray`）を新設し、`app/providers.tsx` で全ルート共通にマウントする。キューが空のときは非表示
- 同時実行数を **3** に制限した並列アップロードに変更する（現状の完全逐次から変更）
- ファイルごとの成功トーストは廃止し、**キューが完全に片付いたタイミングで1回だけサマリートースト**（例:「87件アップロード完了」「85件成功・2件失敗」）を出す
- 失敗した項目はトレイに残り続け、個別に再試行できる
- `beforeunload` の離脱警告は、ローカルの `isUploading` ではなく**グローバルキューに未完了項目があるか**を条件にする
- トレイに「アップロード中はタブを閉じたり他のアプリに切り替えないでください」という注記を常設する（iOS Safari がバックグラウンドタブの処理をOS都合で止める挙動はアプリ側で解決できないため、期待値を明示する）

## スコープ外

- PWA化・Web Push通知・Service Worker によるバックグラウンド継続（iOS Safari は Background Fetch 非対応、Web Push はホーム画面追加時のみのため、今回の「毎回Safariで開く」という使い方には合わない）
- 同名ファイルの上書き確認UI（現状通り `CONFLICT` エラーのまま。再試行しても同じ理由で失敗する）
- レジューム可能アップロード（tus等）。`docs/spec.md` に将来検討との記載はあるが今回は対象外
- アップロード前のクライアント側リサイズ/圧縮
- サーバ側の変更（同時並列リクエストは既存の「パスごとに独立した `pipeline` + `createWriteStream`」でそのまま安全に処理できるため、`apps/server` の改修は不要）

## 設計

### ストア: `apps/web/src/features/upload/store/uploadQueueStore.ts`

```ts
export type UploadItemStatus = "pending" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  file: File;
  path: string; // アップロード先フォルダ
  status: UploadItemStatus;
  progress: number; // 0-100（uploading 中のみ意味を持つ）
  errorCode?: string;
};

const MAX_CONCURRENT = 3;

let items: UploadItem[] = [];
let activeCount = 0;
let settledSinceToast: { done: number; error: number } = { done: 0, error: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const uploadQueueStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): UploadItem[] {
    return items;
  },
  enqueue(path: string, files: File[]) {
    const newItems = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      path,
      status: "pending" as const,
      progress: 0,
    }));
    items = [...items, ...newItems];
    emit();
    runWorker();
  },
  retry(id: string) {
    items = items.map((it) => (it.id === id ? { ...it, status: "pending", progress: 0, errorCode: undefined } : it));
    emit();
    runWorker();
  },
  dismiss(id: string) {
    items = items.filter((it) => it.id !== id);
    emit();
  },
  clearCompleted() {
    items = items.filter((it) => it.status !== "done");
    emit();
  },
};

function hasActiveItems(): boolean {
  return items.some((it) => it.status === "pending" || it.status === "uploading");
}

function runWorker() {
  while (activeCount < MAX_CONCURRENT) {
    const next = items.find((it) => it.status === "pending");
    if (!next) break;
    activeCount++;
    update(next.id, { status: "uploading" });
    void runOne(next);
  }
}

async function runOne(item: UploadItem) {
  try {
    await api.upload(item.path, item.file, {
      onProgress: (progress) => update(item.id, { progress }),
    });
    update(item.id, { status: "done", progress: 100 });
    settledSinceToast.done++;
    queryClient.invalidateQueries({ queryKey: ["list", item.path] });
    queryClient.invalidateQueries({ queryKey: ["disk-usage"] });
  } catch (err) {
    const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
    if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
    update(item.id, { status: "error", errorCode: code });
    settledSinceToast.error++;
  } finally {
    activeCount--;
    if (!hasActiveItems() && (settledSinceToast.done || settledSinceToast.error)) {
      emitSummaryToast(settledSinceToast);
      settledSinceToast = { done: 0, error: 0 };
    }
    runWorker();
  }
}
```

（`update` は該当 `id` の項目を差し替えて `emit()` する内部ヘルパー。`emitSummaryToast` は `sonner` の `toast.success` / `toast.error` を件数に応じて出し分ける。）

`hasActiveItems()` を export し、`beforeunload` のハンドラから参照する。このハンドラはストアモジュールの初期化時に一度だけ `window.addEventListener` する（React コンポーネントのマウントに依存しない）。

`queryClient` は `apps/web/src/app/providers.tsx` の既存モジュール単一インスタンスを `export` して import する（新しい仕組みは増やさない）。

### フック: `apps/web/src/features/upload/hooks/useUploadQueue.ts`

```ts
import { useSyncExternalStore } from "react";
import { uploadQueueStore } from "../store/uploadQueueStore";

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueueStore.subscribe, uploadQueueStore.getSnapshot);
}
```

`UploadTray` / `UploadTraySheet` はこのフックでキュー全体を購読する。

### コンポーネント

**`UploadDropzone.tsx`（改修）**: ドラッグ&ドロップ/クリック選択のUI・見た目は変更なし。`handleFiles` の中身を `uploadQueueStore.enqueue(path, Array.from(files))` に置き換え、自前の `Progress` 表示は削除する（`useUpload` フックへの依存を外す）。

**`UploadTray.tsx`（新規）**: `apps/web/src/app/providers.tsx` で `<Toaster>` と並べて常時マウントする。`useUploadQueue()` の結果が空なら `null` を返す。1件でもあれば画面下部固定（`fixed bottom-4 right-4` 相当）の小さいピルを表示: 「87件中12件完了 (14%)」。クリックで `UploadTraySheet` を開く。

**`UploadTraySheet.tsx`（新規）**: shadcn/ui の `Sheet`（下からせり上がる形）。各アイテムを一覧表示: サムネイル（画像ファイルは `URL.createObjectURL(file)`、非画像や `<img>` の `onError` 時は汎用ファイルアイコンにフォールバック）、ファイル名、状態バッジ、`uploading` 中は個別 `Progress`、`error` は `error-messages.ts` のメッセージ + 再試行ボタン、`done` は完了アイコン。ヘッダーに「アップロード中はタブを閉じたり他のアプリに切り替えないでください」の注記と「完了済みをクリア」ボタンを置く。

生成した Object URL はアイテムが `dismiss`/`clearCompleted` される際、または `UploadTraySheet` のアンマウント時に `URL.revokeObjectURL` で解放する。

### 既存コードの扱い

`apps/web/src/features/upload/hooks/useUpload.ts` は本設計により役割がストア + `useUploadQueue` に置き換わるため**削除**する。`index.ts` は以下に更新:

```ts
export { UploadDropzone } from "./components/UploadDropzone";
export { UploadTray } from "./components/UploadTray";
```

`apps/web/src/app/providers.tsx` を改修: `queryClient` を `export` し、`Providers` コンポーネント内で `<Toaster>` と並べて `<UploadTray />` をレンダーする。

### トースト方針の詳細

- ファイル単位の成功/失敗トーストは出さない
- キュー内の `pending`/`uploading` が0件になった瞬間（＝バッチが完全に片付いた瞬間）に、その間に片付いた件数（`settledSinceToast`）でサマリートーストを1回出す
- 全件成功: `toast.success("87件アップロードしました")`
- 一部失敗あり: `toast.error("85件成功、2件失敗しました")`
- 既にトレイに残っている（未クリアの）過去の `done`/`error` 項目は `settledSinceToast` に含まれないため、二重カウントしない

## テスト（Vitest）

ストアはモジュール単一のミュータブル状態を持つため、テスト間で状態が残らないよう `uploadQueueStore` に `__resetForTests()`（`items` を空配列に、`activeCount`/`settledSinceToast` を初期値に戻すだけの内部ヘルパー）を用意し、各テストの `beforeEach` で呼ぶ。

- `uploadQueueStore.test.ts`:
  - `enqueue` で `pending` 項目が積まれ、最大3件まで同時に `uploading` に遷移すること（`api.upload` をモックし、手動で resolve/reject できる Promise を使って同時実行数を検証）
  - 4件目以降は先行3件のいずれかが完了するまで `pending` のままであること
  - `retry` で `error` 項目が `pending` に戻り再送されること
  - `dismiss` / `clearCompleted` が該当項目のみ除去すること
  - キューが完全に片付いた時点でサマリートースト（成功/失敗件数）が1回だけ発火すること。既存の `done`/`error` 項目を残したまま新規 `enqueue` した場合、次のサマリーには古い項目の件数が混ざらないこと
- `UploadDropzone.test.tsx`（既存を改修）: ファイル選択/ドロップ時に `uploadQueueStore.enqueue` が呼ばれ、input がリセットされること（自前の進捗バー表示のテストは削除）
- `UploadTray.test.tsx`（新規）: キューが空のとき何も描画しないこと、件数・%表示、クリックでシートが開くこと
- `UploadTraySheet.test.tsx`（新規）: 項目一覧の表示、`error` 項目の再試行ボタン押下で `uploadQueueStore.retry` が呼ばれること、「完了済みをクリア」の動作
- `providers.test.ts`（既存を確認/必要なら改修）: `queryClient` が export されていること

## 実装時の変更点

実装・レビューの過程で、本設計から以下の3点を変更した（理由込みで記録。詳細は `docs/superpowers/plans/2026-08-01-upload-queue-tray.md` の Task 2/3 参照）。

- **`id` 生成**: `crypto.randomUUID()` ではなく、モジュールスコープの連番カウンタ（`let nextId = 0`, `id: String(nextId++)`）を使う。`crypto.randomUUID()` はセキュアコンテキスト（HTTPS/localhost）必須だが、本アプリは `docs/spec.md` §8 の方針通りLAN上のプレーンHTTPで配信されるため、実機では未定義になり例外を投げる。idはページセッション内で一意であれば十分なため連番で足りる
- **`queryClient` の置き場所**: `app/providers.tsx` から export するのではなく、`apps/web/src/lib/query-client.ts` に切り出した。設計通り `providers.tsx` から export すると、`providers.tsx` → `features/upload`（`UploadTray`）→ `uploadQueueStore` → `providers.tsx` という循環importになるため
- **`retry()` の非同期化**: `retry()` 内の `runWorker()` 呼び出しを `queueMicrotask(runWorker)` に変更した（`enqueue`/`runOne` は同期のまま）。同時実行数を検証するテスト（`enqueue` 呼び出し直後に同期的に`uploading`件数を検証）と、retry直後の状態を検証するテスト（`retry`呼び出し直後は`pending`のまま）が、`runWorker`を完全に同期実行する設計のままでは両立しないため

なお `hasActiveItems()` は当初の設計通りだが、実装順序の都合で一時的に未使用となり `noUnusedLocals` エラーになったため、実装時はいったん削除し `beforeunload` 連携（サマリートースト条件と合わせて）を追加するタイミングで復元した。最終的な挙動は設計通り。

## 影響範囲

- 新規: `apps/web/src/features/upload/store/uploadQueueStore.ts` + テスト
- 新規: `apps/web/src/features/upload/hooks/useUploadQueue.ts`
- 新規: `apps/web/src/features/upload/components/UploadTray.tsx` + テスト
- 新規: `apps/web/src/features/upload/components/UploadTraySheet.tsx` + テスト
- 変更: `apps/web/src/features/upload/components/UploadDropzone.tsx` + テスト（`enqueue` 呼び出しに変更）
- 削除: `apps/web/src/features/upload/hooks/useUpload.ts` + `useUpload.test.tsx`
- 変更: `apps/web/src/features/upload/index.ts`（`UploadTray` を追加公開、`useUpload` 系のexportは削除）
- 変更: `apps/web/src/app/providers.tsx`（`queryClient` を export、`<UploadTray />` をマウント）
- 依存追加: なし
