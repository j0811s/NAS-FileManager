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

```

`downloadBulk` は非同期の結果を返さない（後述）ため `useMutation`化しない。`onDownload` ハンドラから `api.downloadBulk(paths)` を直接呼ぶ。

削除成功後は呼び出し側（`FileBrowser`）で選択状態をクリアし `selectMode` を終了する。ダウンロードは非破壊操作のため、選択状態を維持する（続けて削除する導線を残す）。

### `apps/web/src/lib/api.ts`（追加）

```ts
async deleteBulk(paths: string[]): Promise<BulkDeleteResponse> {
  const res = await request("/api/delete-bulk", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ paths }),
  });
  return (await res.json()) as BulkDeleteResponse;
},

downloadBulk(paths: string[]): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/download-bulk";
  form.target = "_blank";
  form.style.display = "none";
  for (const p of paths) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "paths";
    input.value = p;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
},
```

`request()`（fetch + blob化）は使わない。数百件選択時にzip全体（数百MB〜数GB になり得る）がブラウザメモリに載ってから保存が始まる形になり、iPhone Safari でのタブクラッシュや「保存が始まるまで進捗が見えない」問題（＝そもそもこの一連の機能改善の出発点だった「アップロードの進捗が分かりづらい」と同種の問題）を再現してしまうため。代わりに非表示の `<form method="POST" target="_blank">` を組み立てて `submit()` する。ブラウザ自身が実際のページ遷移としてリクエストを送るため、レスポンスをネイティブにディスクへストリーミング保存でき、ブラウザ標準のダウンロード進捗表示も使える。

トレードオフ: フォーム送信は結果を JS で受け取れないため、ダウンロード失敗（サーバエラー等）を app 内のトーストで表示できない。`target="_blank"` により、失敗時のエラーレスポンス（JSON）は別タブに開かれるだけで、アプリ本体の画面遷移・状態は失われない（ユーザーはそのタブを閉じるだけで済む）。

## サーバ側 API

### `packages/shared/src/types.ts`（追加）

```ts
export interface BulkPathsRequest {
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
```

一括削除・一括ダウンロードのどちらも受け取る内容は本質的に同じ `{ paths: string[] }` なので、`BulkPathsRequest` 1つに統合する（DRY）。

### `files.schema.ts`（追加）

一括削除は JSON body、一括ダウンロードはフォーム送信（後述）で受け取るため、パース元が異なる2つの関数を用意する:

```ts
export function parseBulkPathsBody(value: unknown): BulkPathsRequest {
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

export function parseBulkPathsForm(value: unknown): BulkPathsRequest {
  if (!isRecord(value)) {
    throw new AppError("INVALID_REQUEST", "form body must contain paths");
  }
  const raw = value.paths;
  const paths = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  if (paths.length === 0 || !paths.every((p) => typeof p === "string" && p !== "")) {
    throw new AppError("INVALID_REQUEST", "paths must be non-empty strings");
  }
  return { paths };
}
```

`parseBulkPathsForm` が別関数として必要な理由: Hono の `c.req.parseBody({ all: true })` は、同名フィールドが複数あれば配列、1個だけなら単一の文字列を返す（フィールド数に依存する）。1件だけ選択してダウンロードするケースでは `paths` が配列でなく単一文字列で届くため、正規化が必要。

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
  const { paths } = parseBulkPathsForm(await c.req.parseBody({ all: true }));
  // zip ストリーミング開始前に全パスを検証し、トラバーサル等は 400 として返す
  // （ストリーム開始後は Content-Type / status 200 が確定済みで変更できないため）
  for (const p of paths) {
    safeResolve(root, p);
  }
  const archive = createSelectionZipStream(root, paths);
  c.header("Content-Type", "application/zip");
  c.header("Content-Disposition", contentDisposition("選択項目.zip"));
  return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
});
```

一括削除は JSON のままとする（レスポンスは小さなJSONで、失敗時もアプリ内で完結してトースト表示できるため、フォーム送信に変える理由がない）。一括ダウンロードのみ、大容量レスポンスをストリーミングでディスクに保存させる必要があるためフォーム送信にする。この非対称は意図的。

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
- 一括ダウンロード: フォーム送信のためリクエスト自体の失敗（不正なパス、サーバエラー）を JS からは検知できず、アプリ内トーストは出さない。`target="_blank"` により失敗時のエラーレスポンス（JSON）は別タブに開くだけで、アプリ本体の画面遷移・状態は失われない。zip 生成中に個別ファイルが消えていた場合は無視して続行（致命的にしない）

## テスト方針

**サーバ**（`files.routes.test.ts` 等の既存パターンに追加）:
- `POST /api/delete-bulk`: 全件成功、一部失敗（存在しないパス混在）、空配列で400
- `POST /api/download-bulk`: ファイル+フォルダ混在の選択でzip内容を検証、消失パスを許容して続行、空配列で400

**クライアント**:
- `FileTable`/`FileGrid`: 選択モードでのチェックボックス表示・トグル、全選択のチェック状態
- `BulkActionToolbar`: 件数表示、`pending` 時の disabled
- `BulkDeleteDialog`: 件数を含む文言
- `useFileMutations`: `bulkDelete`（成功/一部失敗のトースト分岐）のみ。`downloadBulk` は非同期結果を返さないため mutation化しない
- `api.ts`: `deleteBulk`（JSON POST）・`downloadBulk`（隠しフォームPOST、戻り値なし）

## 決定事項（ヒアリング結果）

- 選択モードの入り方: 「選択」ボタンで明示的に切替（常時チェックボックス表示や長押しは不採用。スマホでの誤操作を避けるため）
- 一括操作ツールバーの位置: 上部（既存のアクション行を差し替え）。下部固定はアップロードトレイのピルと重なるため不採用
- 全選択/全解除トグル: 必要（数十〜数百件を想定するため）
- 一括API方式: サーバに `delete-bulk` / `download-bulk` を新設（クライアント側でのループは不採用 — 削除は数百リクエストになり得る、ダウンロードはモバイルSafariで複数ファイル同時ダウンロードがブロックされやすくUXが崩壊するため）
- 一括ダウンロードの送信方式: `fetch` + `blob()` ではなく非表示 `<form target="_blank">` の POST 送信を採用。数百件選択時にzip全体（数百MB〜数GB）をブラウザメモリに溜めてから保存が始まる形は、iPhone Safari でのタブクラッシュや「保存開始まで進捗が見えない」問題を招き、この一連の機能改善の出発点（アップロード進捗の分かりづらさ）を再現してしまうため。トレードオフとして、ダウンロード失敗はアプリ内トーストで表示できなくなる（`target="_blank"` により別タブが開くだけで本体は無事）
