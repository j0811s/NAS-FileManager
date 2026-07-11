# HEIC プレビュー対応 設計

日付: 2026-07-11
ステータス: 承認待ち

## 目的

現状 `.heic`（iPhone 写真）は `classifyPreview` 上は `"image"` に分類されるが、多くのブラウザが HEIC をネイティブ表示できないため、一覧サムネイル・プレビューモーダルとも実質的に表示できず、`docs/spec.md` §10.2 でも「初版は HEIC は DL のみ」と割り切っていた。本設計では、サーバー側で HEIC → JPEG 変換を行い、既存のサムネイル基盤（動画サムネイルで作った ffmpeg 外部プロセス呼び出し＋ディスクキャッシュ＋同時実行制限のパターン）に相乗りさせることで、HEIC も一覧サムネイル・モーダルプレビューの両方で表示できるようにする。

## 方針（決定事項）

- **HEIC → JPEG 変換は外部コマンド `heif-convert`（`libheif-examples` パッケージ）で行う**。理由: `sharp` の linux-arm64 プリビルドは HEVC ペイロードの HEIC を扱えない（`libheif` は入っているが AVIF 用で、HEIC 本体である HEVC コーデックのライセンス上プリビルドに同梱されていない）。npm の WASM デコーダは Pi 5 で 1 枚数秒〜のデコード時間・数百MBのメモリを要し 4GB 機には重い。ブラウザ側デコード（heic2any 等）は一覧サムネイルに使えず数MBを毎回転送するため不採用。システムコマンド方式は ffmpeg と全く同じ運用パターン（apt でインストール、無ければ機能を切って 501）に乗せられ、動画サムネイル実装からの差分が最小になる
- **既存の `thumbnails.service.ts` / `GET /api/thumbnail` に相乗りする**。新規 feature・新規エンドポイントは作らない
- **`generate()` の中で HEIC だけ前段変換を挟む**: `heif-convert` でフル解像度 JPEG を一時ファイルに書き出し → 既存の sharp パイプライン（`rotate()` → `resize()` → `jpeg()`）にそのまま渡す。EXIF 回転補正・出力品質・キャッシュキー・同時実行制限（2並列）・アトミック配置（`.tmp-*` → `rename`）は他の画像と完全に共通化する
- **`heif-convert` が無い環境では HEIC のサムネイル/プレビューは `UNSUPPORTED`（501）**。ffmpeg と同じく起動時に検出し、フロントは既存のアイコン表示・「プレビューできません」フォールバックにそのまま乗る（新しいフォールバック UI は作らない）
- **モーダルプレビュー用に大きいサイズの変換画像を追加する**（`variant: "preview"`、長辺1920px・JPEG q85）。理由: 一覧サムネイル（480px）はモーダル表示には小さすぎる。既存の `GET /api/thumbnail` にクエリパラメータ `size=preview` を追加して同じエンドポイントで両サイズを配信し、キャッシュもサイズ別に保存する
- **`size=preview` は画像のみ対応**（動画は対象外。動画のモーダルは従来どおり `<video>` に Range 配信 URL を渡すだけで、サムネイル拡大は不要なため）
- **非 HEIC 画像は今回無変更**。`/api/preview` の生バイト配信・ブラウザネイティブデコードのまま。`variant: "preview"` の変換パイプラインは HEIC 専用ではなく画像全般に使える汎用機構として作るが、実際に使うのは今回 HEIC のモーダルプレビューのみ（非HEICは相変わらず `/api/preview` を直接使う。無駄な変換の追加コストを避ける）

## スコープ外

- HEIC 以外の非対応形式（RAW 等）への拡大
- 一覧サムネイルのサイズ可変化・ユーザー設定
- `heif-convert` の代替（WASM デコーダ、ブラウザ側デコード）の同時サポート

## 設計

### `thumbnails.service.ts` の変更

**`ThumbnailServiceOptions` に HEIC 変換ランナーを追加**

```ts
export type HeifRunner = (absIn: string, absOut: string) => Promise<void>;

export interface ThumbnailServiceOptions {
  root: string;
  cacheDir: string;
  runFfmpeg: FfmpegRunner | null;
  /** null は heif-convert が使えない環境（HEIC の getThumbnail は UNSUPPORTED を投げる） */
  runHeifConvert: HeifRunner | null;
}
```

`FfmpegRunner` と型の形が同じだが、"ffmpeg 特有のコマンド" と "HEIC 変換" は別物として型を分ける（呼び分けを型で強制し、テストのモック差し替えでの取り違えを防ぐ）。

**variant（サムネイルの出力サイズ）の追加**

```ts
export type ThumbnailVariant = "thumb" | "preview";

const VARIANT_SPEC: Record<ThumbnailVariant, { maxSize: number; quality: number }> = {
  thumb: { maxSize: 480, quality: 80 },
  preview: { maxSize: 1920, quality: 85 },
};
```

`getThumbnail(relPath: string, variant: ThumbnailVariant = "thumb")` にシグネチャ変更。

- `variant === "preview"` は画像のみ許可。動画に対して要求されたら `INVALID_REQUEST`
- キャッシュファイル名は `thumb` のとき従来どおり `${key}.jpg`（既存キャッシュ・既存テストとの互換のため無変更）、`preview` のときは `${key}-preview.jpg`

**入口チェックの拡張**（`getThumbnail` 内、既存の image/video 判定はそのまま）

```ts
const kind = classifyPreview(path.basename(abs));
const ext = path.extname(abs).toLowerCase();
const supported = kind === "video" || (kind === "image" && ext !== ".svg");
if (!supported) {
  throw new AppError("INVALID_REQUEST", "thumbnail is not supported for this file type");
}
if (variant === "preview" && kind === "video") {
  throw new AppError("INVALID_REQUEST", "preview size is not supported for video");
}
```

**`getThumbnail` 本体（cachePath への variant 反映）**

```ts
async getThumbnail(relPath: string, variant: ThumbnailVariant = "thumb"): Promise<string> {
  const abs = safeResolve(root, relPath);
  const kind = classifyPreview(path.basename(abs));
  const ext = path.extname(abs).toLowerCase();
  const supported = kind === "video" || (kind === "image" && ext !== ".svg");
  if (!supported) {
    throw new AppError("INVALID_REQUEST", "thumbnail is not supported for this file type");
  }
  if (variant === "preview" && kind === "video") {
    throw new AppError("INVALID_REQUEST", "preview size is not supported for video");
  }
  const mediaKind = kind as "video" | "image";
  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  if (st.isDirectory()) throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);

  const key = createHash("sha256")
    .update(`${relPath}|${Math.trunc(st.mtimeMs)}|${st.size}`)
    .digest("hex");
  const suffix = variant === "preview" ? "-preview" : "";
  const cachePath = path.join(cacheDir, `${key}${suffix}.jpg`);
  const cached = await fs.stat(cachePath).catch(() => null);
  if (cached) return cachePath;

  const inflightKey = `${key}${suffix}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;
  const promise = generate(abs, cachePath, mediaKind, variant).finally(() =>
    inflight.delete(inflightKey),
  );
  inflight.set(inflightKey, promise);
  return promise;
},
```

`inflight` の Map キーも `variant` を含める（`thumb` と `preview` を同時リクエストされた場合に片方の Promise を取り違えないため）。

**`generate()` に HEIC 前段変換を追加**

```ts
async function generate(
  abs: string,
  cachePath: string,
  kind: "video" | "image",
  variant: ThumbnailVariant,
): Promise<string> {
  if (kind === "video" && !runFfmpeg) {
    throw new AppError("UNSUPPORTED", "ffmpeg is not available");
  }
  const isHeic = path.extname(abs).toLowerCase() === ".heic";
  if (isHeic && !runHeifConvert) {
    throw new AppError("UNSUPPORTED", "heif-convert is not available");
  }
  await acquire();
  const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
  const heicTmp = `${cachePath}.heic-tmp-${randomBytes(6).toString("hex")}.jpg`;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    if (kind === "video") {
      await runFfmpeg!(abs, tmp);
    } else if (isHeic) {
      await runHeifConvert!(abs, heicTmp);
      await generateImageThumbnail(heicTmp, tmp, variant);
    } else {
      await generateImageThumbnail(abs, tmp, variant);
    }
    await fs.rename(tmp, cachePath);
    return cachePath;
  } finally {
    release();
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    if (isHeic) await fs.rm(heicTmp, { force: true }).catch(() => undefined);
  }
}
```

`heif-convert` はセマフォ（`acquire`/`release`）の内側で実行するため、動画・他画像と合わせて全体で最大2並列に収まる（HEIC 専用の追加枠は設けない）。

**`generateImageThumbnail` を variant 対応に変更**

```ts
async function generateImageThumbnail(
  abs: string,
  absOut: string,
  variant: ThumbnailVariant,
): Promise<void> {
  const { maxSize, quality } = VARIANT_SPEC[variant];
  try {
    await sharp(abs)
      .rotate()
      .resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toFile(absOut);
  } catch {
    throw new AppError("INVALID_REQUEST", "failed to generate thumbnail");
  }
}
```

**`createHeifConvertRunner` / `detectHeifConvert`（`createProcessRunner` を流用、ffmpeg と同型）**

```ts
export const heifConvertRunner: HeifRunner = createProcessRunner({
  command: "heif-convert",
  args: (absIn, absOut) => [absIn, absOut],
  timeoutMs: 20_000,
});

export function detectHeifConvert(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("heif-convert", ["--version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
```

`createProcessRunner` は既存の汎用実装（`ENOENT` → `UNSUPPORTED`、非ゼロ終了 → `INVALID_REQUEST`、タイムアウト → SIGKILL）をそのまま再利用できるため変更不要。出力ファイル名は `.jpg` 拡張子固定（`heif-convert` は出力ファイル名の拡張子で形式を判定するため、一時ファイル名に `.jpg` を含める）。

### `thumbnails.schema.ts` の変更

`size` クエリパラメータのパースを追加。

```ts
export function parseVariant(value: string | undefined): ThumbnailVariant {
  if (value === undefined || value === "thumb") return "thumb";
  if (value === "preview") return "preview";
  throw new AppError("INVALID_REQUEST", "invalid size");
}
```

### `thumbnails.routes.ts` の変更

```ts
app.get("/thumbnail", async (c) => {
  const rel = requirePath(c.req.query("path"));
  const variant = parseVariant(c.req.query("size"));
  const absJpeg = await service.getThumbnail(rel, variant);
  // 以降無変更
});
```

### `app.ts` / `server.ts` の変更

`ThumbnailOptions` に `runHeifConvert: HeifRunner | null` を追加し、`server.ts` で `detectFfmpeg()` と同様に起動時 `detectHeifConvert()` を行って注入する（見つからなければ警告ログを出し、HEIC 関連は 501 のまま動作）。

```ts
const heifAvailable = await detectHeifConvert();
if (!heifAvailable) {
  console.warn("heif-convert not found: HEIC preview is disabled (/api/thumbnail returns 501 for .heic)");
}

const app = createApp(root, authConfig, staticDir, {
  cacheDir: resolveThumbCacheDir(),
  runFfmpeg: ffmpegAvailable ? ffmpegRunner : null,
  runHeifConvert: heifAvailable ? heifConvertRunner : null,
});
```

`createApp` 未指定時（テスト等）は `runHeifConvert: thumbnails?.runHeifConvert ?? null` として ffmpeg と同じ「無指定は無効」を踏襲。

### `apps/web/src/lib/api.ts` の変更

```ts
thumbnailUrl(path: string, variant?: "preview"): string {
  const q = variant ? `&size=${variant}` : "";
  return `/api/thumbnail?path=${encodeURIComponent(path)}${q}`;
},
```

### フロントエンド: `PreviewDialog.tsx` + 新規 `HeicPreview.tsx`

- `PreviewDialog` は `.heic` を判定し、HEIC の場合だけ画像表示を `TextPreview` と同様のパターンの新規サブコンポーネント `HeicPreview` に委譲する（`TextPreview.tsx` に倣い、`dialogs/HeicPreview.tsx` として追加）
- `HeicPreview` は `url`（`api.thumbnailUrl(path, "preview")`）と `downloadHref` を受け取り、内部で `useState` の `failed` フラグを持つ。`<img onError={() => setFailed(true)}>` で 501（heif-convert 不在）や変換失敗を検知し、失敗時は既存の「プレビューできません・ダウンロード」表示にフォールバックする
- `PreviewDialog` は `previewTarget` が変わっても同一コンポーネントインスタンスが再利用される（`FileBrowser.tsx` 側で key 分割していない）ため、`HeicPreview` には `key={url}` を渡してファイル切り替え時に内部状態をリセットする
- 非 HEIC の画像は従来どおり `api.previewUrl(path)` を直接 `<img>` に渡す（変更なし）

```tsx
const isHeic = name.toLowerCase().endsWith(".heic");
...
{open && kind === "image" && !isHeic && (
  <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
)}
{open && kind === "image" && isHeic && (
  <HeicPreview
    key={path}
    url={api.thumbnailUrl(path, "preview")}
    downloadHref={downloadHref}
  />
)}
```

### `FileGrid.tsx`（変更不要）

`Thumbnail` コンポーネントは既に `kind === "image" && !isSvg` を `needsGeneratedThumbnail` として `api.thumbnailUrl(relPath)`（variant 省略 = `"thumb"`）経由でサーバー生成サムネイルを要求している。`.heic` は SVG でない image なのでこの分岐に自然に乗っており、サーバーが HEIC を変換できるようになれば一覧サムネイルは追加コード無しで表示される。生成失敗時は既存の `onError` → `ImageIcon` フォールバックがそのまま効く。

### ドキュメント: `docs/spec.md`

- §10.2「画像」の HEIC に関する記述を更新: 「初版は DL のみ」の割り切りを外し、`heif-convert`（`libheif-examples`）によるサーバー変換対応を明記
- デプロイ手順（既存の ffmpeg インストール記述の近く）に `sudo apt install libheif-examples` を追記。開発機（Mac）は `brew install libheif`
- §10.4 の「新規に必要なもの」に `heif-convert`（システムコマンド、任意）を追記

## テスト（Vitest）

- `thumbnails.service.test.ts`（追記）
  - `.heic` かつ `runHeifConvert: null` は `UNSUPPORTED`
  - `.heic` かつ `runHeifConvert` が成功する fake runner の場合、生成されたキャッシュファイルが有効な JPEG になる（`sharp(output).metadata()` で `format: "jpeg"` を確認）。fake runner はダミー JPEG を書き込むだけで、実際の HEIC デコードはテストしない（`createProcessRunner` の挙動は ffmpeg 側のテストで既に検証済みのため、HEIC 固有のテストは「サービスが正しい引数で呼び出し、結果を sharp パイプラインに正しく渡すか」に絞る）
  - `variant: "preview"` を動画に指定すると `INVALID_REQUEST`
  - `variant: "preview"` を画像に指定すると、`thumb` とは別のキャッシュファイル（`-preview.jpg` 付き）が作られ、`maxSize: 1920` 相当のサイズになる
  - HEIC 変換の一時ファイル（`*.heic-tmp-*`）が成功時・失敗時ともにキャッシュディレクトリに残らないこと
- `thumbnails.routes.test.ts`（存在すれば追記、無ければ既存の route テストパターンに合わせて追加）
  - `?size=preview` がサービスに正しい variant で渡ること
  - `?size=invalid` は `INVALID_REQUEST`
- `PreviewDialog.test.tsx` / 新規 `HeicPreview.test.tsx`
  - `.heic` ファイルで `HeicPreview` が `api.thumbnailUrl(path, "preview")` を `src` に使うこと
  - `onError` 発火で「プレビューできません・ダウンロード」表示にフォールバックすること
  - 非 HEIC 画像は従来どおり `api.previewUrl` を使うこと（回帰確認）

## 影響範囲

- 変更: `apps/server/src/features/thumbnails/thumbnails.service.ts`（`HeifRunner`/`ThumbnailVariant` 追加、`generate()` の HEIC 分岐、`generateImageThumbnail` の variant 対応、`heifConvertRunner`/`detectHeifConvert` 追加）
- 変更: `apps/server/src/features/thumbnails/thumbnails.schema.ts`（`parseVariant` 追加）
- 変更: `apps/server/src/features/thumbnails/thumbnails.routes.ts`（`size` クエリパラメータ対応）
- 変更: `apps/server/src/app.ts` / `apps/server/src/server.ts`（`runHeifConvert` の注入・起動時検出）
- 変更: `apps/web/src/lib/api.ts`（`thumbnailUrl` に `variant` 引数追加）
- 変更: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx`（HEIC 分岐）
- 新規: `apps/web/src/features/file-list/dialogs/HeicPreview.tsx`
- 変更なし: `apps/web/src/features/file-list/components/FileGrid.tsx`、`packages/shared/src/preview.ts`（`classifyPreview` は無変更）、`/api/preview` の Range 配信ロジック
- ドキュメント: `docs/spec.md` §10.2 / §10.4、デプロイ手順に `libheif-examples` 追記
- 依存追加: なし（npm 依存は増えない。システムパッケージ `libheif-examples` が新規の実行時要件として追加されるのみ）
