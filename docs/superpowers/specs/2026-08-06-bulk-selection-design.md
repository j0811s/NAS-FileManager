# 複数選択・一括操作（削除・ダウンロード）設計

## 背景・目的

`file-list` feature には現在、行ごとの操作（プレビュー/ダウンロード/リネーム/移動/削除）しかない。iPhone の写真アプリからまとめてアップロードした数十〜数百件のファイルを、後でまとめて削除・ダウンロードする手段がなく、1件ずつの操作を繰り返す必要がある。チェックボックスによる複数選択と、一括削除・一括ダウンロードを追加する。

対象は「削除」「ダウンロード」の2操作のみ。一括移動・一括リネームは今回のスコープ外（将来検討）。

## アーキテクチャ

選択状態はローカル state として `FileBrowser.tsx` に持つ。

```ts
const [selectMode, setSelectMode] = useState(false);
const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
```

- `selectedNames` は現在表示中フォルダの `entry.name`（フォルダ内で一意）を保持する。フォルダをまたいだ選択は行わない
- `path` が変化した（フォルダ移動）ときは `selectMode` / `selectedNames` を両方リセットする
- 「選択」ボタンで `selectMode` を ON にすると、既存の上部アクション行（グリッド/テーブル切替・ソートメニュー・新しいフォルダボタン）が `BulkActionToolbar` に差し替わる。新規の `position: fixed` 要素は追加しない — 右下に既存のアップロードトレイのピルボタンがあるため、重ならないよう既存の上部の行を流用する
- フォルダも選択対象に含める。削除（`moveToTrash`）・ダウンロード（zip化）はどちらも元々ファイル/フォルダ両対応のため、選択UI側でのフォルダ除外は行わない
- 選択モード中、行/サムネイルのクリックは「開く・プレビュー」ではなく「選択トグル」に変わる。既存の行アクション（⋮ドロップダウンメニュー）は選択モード中は非表示にする（二重の操作導線を避けるため）

## クライアント側コンポーネント

### `FileTable.tsx` / `FileGrid.tsx`（既存を拡張）

- `selectMode`・`selectedNames`・`onToggleSelect(name: string)` を props として受け取る
- `FileTable`: `selectMode` が true のとき、テーブル左端にチェックボックス列を追加。`TableHeader` に全選択チェックボックスを追加（`indeterminate` 状態: 一部のみ選択時）
- `FileGrid`: `selectMode` が true のとき、各サムネイルの左上にチェックボックスを重ねて表示（右上の `RowActions` 相当の位置は選択モード中非表示にするため空く）

### `BulkActionToolbar.tsx`（新規）

`file-list/components/` に配置。props: `selectedCount: number`, `totalCount: number`, `onSelectAll: () => void`, `onClearSelection: () => void`, `onDelete: () => void`, `onDownload: () => void`, `pending: boolean`（bulk mutation 実行中）。

表示: 「選択解除」ボタン、全選択チェックボックス（`selectedCount === totalCount` で checked）、「N件選択中」ラベル、「ダウンロード」「削除」ボタン（`pending` 中、および `selectedCount === 0` のときは disabled）。

### `BulkDeleteDialog.tsx`（新規）

既存 `DeleteDialog.tsx` と同構造。`targetCount: number` を受け取り「選択した{n}件を削除しますか？」を表示する `AlertDialog`。

### `useFileMutations.ts`（既存フックに追加）

```ts
const bulkDelete = useMutation({
  mutationFn: (paths: string[]) => api.deleteBulk(paths),
  onSuccess: (res, paths) => {
    invalidate();
    qc.invalidateQueries({ queryKey: ["disk-usage"] });
    const failed = res.results.filter((r) => !r.ok).length;
    const succeeded = paths.length - failed;
    toast[failed > 0 ? "error" : "success"](
      failed > 0 ? `${succeeded}件削除しました（${failed}件失敗）` : `${succeeded}件削除しました`,
    );
  },
  onError: onErrorAndRefresh,
});

const bulkDownload = useMutation({
  mutationFn: (paths: string[]) => api.downloadBulk(paths),
  onError: (err: unknown) => toastError(err),
});
```

削除成功後は呼び出し側（`FileBrowser`）で選択状態をクリアし `selectMode` を終了する。ダウンロードは非破壊操作のため、成功後も選択状態を維持する（続けて削除する導線を残す）。

### `apps/web/src/lib/api.ts`（追加）

```ts
async deleteBulk(paths: string[]): Promise<BulkDeleteResponse> {
  const res = await request("/api/delete-bulk", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ paths } satisfies BulkDeleteRequest),
  });
  return (await res.json()) as BulkDeleteResponse;
},

async downloadBulk(paths: string[]): Promise<void> {
  const res = await request("/api/download-bulk", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ paths } satisfies BulkDownloadRequest),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "選択項目.zip";
  a.click();
  URL.revokeObjectURL(url);
},
```

`request()` は既存の共通ヘルパーをそのまま使う（非ok時に `ApiRequestError` を投げる処理は共通化済み）。`downloadBulk` は単発ダウンロードの `downloadUrl()`（`<a href>` 直リンク）と違い POST が必要なため、`request()` が返す `Response` から `blob()` を取り出しクライアント側で保存をトリガーする。

## サーバ側 API

### `packages/shared/src/types.ts`（追加）

```ts
export interface BulkDeleteRequest {
  paths: string[];
}

export interface BulkDeleteResult {
  path: string;
  ok: boolean;
  errorCode?: ApiErrorCode;
}

export interface BulkDeleteResponse {
  results: BulkDeleteResult[];
}

export interface BulkDownloadRequest {
  paths: string[];
}
```

### `files.schema.ts`（追加）

```ts
export function parseBulkPathsBody(value: unknown): { paths: string[] } {
  if (
    !isRecord(value) ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    !value.paths.every((p) => typeof p === "string" && p !== "")
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { paths: string[] } (non-empty)");
  }
  return { paths: value.paths };
}
```

### `files.routes.ts`（追加）

```ts
app.post("/delete-bulk", async (c) => {
  const { paths } = parseBulkPathsBody(await readJsonBody(() => c.req.json()));
  const results: BulkDeleteResult[] = [];
  for (const p of paths) {
    try {
      await moveToTrash(root, p);
      results.push({ path: p, ok: true });
    } catch (err) {
      results.push({ path: p, ok: false, errorCode: err instanceof AppError ? err.code : "INTERNAL" });
    }
  }
  const res: BulkDeleteResponse = { results };
  return c.json(res);
});

app.post("/download-bulk", async (c) => {
  const { paths } = parseBulkPathsBody(await readJsonBody(() => c.req.json()));
  const archive = createSelectionZipStream(root, paths);
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", contentDisposition("選択項目.zip"));
  return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
});
```

一括削除は1件の失敗で全体を止めない（`try/catch` をループ内に置き、常に200 + 結果配列を返す）。空配列・不正な body は `INVALID_REQUEST`（400）。

### `files.service.ts`（追加）

既存の `walkAndAppend(archive, absDir, zipPrefix)` を再利用する。

```ts
export function createSelectionZipStream(root: string, relPaths: string[]): Archiver {
  const archive = new ZipArchive({ store: true });
  const handleError = (err: unknown) => {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      archive.destroy(err as Error);
    }
  };
  archive.on("warning", handleError);
  archive.on("error", handleError);
  void (async () => {
    for (const relPath of relPaths) {
      const abs = safeResolve(root, relPath);
      const st = await fs.stat(abs).catch(() => null);
      if (!st) continue;
      const name = path.basename(abs);
      if (st.isDirectory()) {
        await walkAndAppend(archive, abs, name);
      } else if (st.isFile()) {
        archive.file(abs, { name });
      }
    }
  })().then(
    () => archive.finalize(),
    (err) => archive.destroy(err as Error),
  );
  return archive;
}
```

`safeResolve` のパストラバース検出は IIFE 内で投げっぱなしにし、`.then` の reject ハンドラで `archive.destroy` する（fatal）。走査後に個別ファイルが消えていた場合（`ENOENT`）は無視して続行する既存の寛容さを踏襲する。

選択された各項目が同一フォルダ由来のため、`path.basename` 同士の衝突は発生しない（同一ディレクトリ内でファイル名は一意）。

## エラーハンドリング

- 一括削除: パスごとに成功/失敗を記録し、失敗があってもレスポンスは200。クライアントはサマリートーストで「N件削除しました（M件失敗）」と表示。失敗した項目は一覧の再取得で自然に残る（詳細な失敗理由の個別表示はしない — 既存のトースト粒度に合わせる）
- 一括ダウンロード: リクエスト自体の失敗（不正な body、ネットワークエラー）は既存の `errorMessage` ベースのトーストで表示。zip 生成中に個別ファイルが消えていた場合は無視して続行（致命的にしない）

## テスト方針

**サーバ**（`files.routes.test.ts` 等の既存パターンに追加）:
- `POST /api/delete-bulk`: 全件成功、一部失敗（存在しないパス混在）、空配列で400
- `POST /api/download-bulk`: ファイル+フォルダ混在の選択でzip内容を検証、消失パスを許容して続行、空配列で400

**クライアント**:
- `FileTable`/`FileGrid`: 選択モードでのチェックボックス表示・トグル、全選択のチェック状態
- `BulkActionToolbar`: 件数表示、`pending` 時の disabled
- `BulkDeleteDialog`: 件数を含む文言
- `useFileMutations`: `bulkDelete`（成功/一部失敗のトースト分岐）、`bulkDownload`（成功/失敗）
- `api.ts`: `deleteBulk`・`downloadBulk`（blobトリガー）

## 決定事項（ヒアリング結果）

- 選択モードの入り方: 「選択」ボタンで明示的に切替（常時チェックボックス表示や長押しは不採用。スマホでの誤操作を避けるため）
- 一括操作ツールバーの位置: 上部（既存のアクション行を差し替え）。下部固定はアップロードトレイのピルと重なるため不採用
- 全選択/全解除トグル: 必要（数十〜数百件を想定するため）
- 一括API方式: サーバに `delete-bulk` / `download-bulk` を新設（クライアント側でのループは不採用 — 削除は数百リクエストになり得る、ダウンロードはモバイルSafariで複数ファイル同時ダウンロードがブロックされやすくUXが崩壊するため）
