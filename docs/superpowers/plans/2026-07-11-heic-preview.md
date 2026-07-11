# HEICプレビュー対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.heic` ファイルを一覧サムネイル・プレビューモーダルの両方でJPEGとして表示できるようにする。

**Architecture:** サーバー起動時に外部コマンド `heif-convert`（`libheif-examples`）の有無を検出し、既存の `thumbnails.service.ts`（動画サムネイルで作った ffmpeg 外部プロセス呼び出し＋ディスクキャッシュ＋同時実行制限の基盤）に HEIC→JPEG 変換ステップを相乗りさせる。同じサービスに「モーダル用の大きいサイズ（`preview` variant, 1920px）」も追加し、既存の `GET /api/thumbnail` に `size` クエリパラメータとして生やす。フロントは `PreviewDialog.tsx` に HEIC 専用の分岐を追加し、新規 `HeicPreview.tsx` で変換失敗時のフォールバックを扱う。

**Tech Stack:** Hono（サーバー）、React 19 + Vite（フロント）、Vitest、`sharp`（既存依存、リサイズ/エンコード用）、`heif-convert`（新規システムコマンド依存、npm依存ではない）。

**Spec:** `docs/superpowers/specs/2026-07-11-heic-preview-design.md`

## Global Constraints

- Node は `>=24.18.0`（新規依存追加なしのためこの計画では無関係）
- フォーマッタ/リンタは **oxfmt / oxlint**（Prettier/ESLintではない）。pre-commit（husky + lint-staged）が commit 時に oxfmt → oxlint --fix → typecheck を自動実行する
- コミットは Conventional Commits（接頭辞は英語、本文は日本語。例: `feat: ...`）
- `verbatimModuleSyntax: true` のため、型のみの import/export は必ず `import type` / `export type`（または名前付きimport内で `type` 修飾子）を使う
- feature間のimportは各featureの `index.ts`（公開境界）経由のみ。本計画の変更はすべて `thumbnails` feature内、`file-list` feature内、または各アプリの `lib/` で完結し、他featureの内部実装への直接importは発生しない
- 新規npm依存は追加しない（`heif-convert` はOSパッケージ `libheif-examples` が提供するシステムコマンドで、`npm install` の対象ではない）

---

### Task 1: `ThumbnailVariant`（プレビュー用大きいサイズ）をサービス層に追加する

HEIC対応より先に、モーダル用の大きいサイズ（`preview`, 1920px）を出し分けられるようにする。この時点ではHEICは扱わず、既存の画像/動画パスに variant の概念を通すだけ。

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Produces: `export type ThumbnailVariant = "thumb" | "preview";` / `ThumbnailService.getThumbnail(relPath: string, variant?: ThumbnailVariant): Promise<string>`（`variant` 省略時は `"thumb"`、動画に `"preview"` を渡すと `AppError("INVALID_REQUEST", ...)`）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.service.test.ts` の `describe("createThumbnailService.getThumbnail", ...)` ブロック内、`it("破損画像は INVALID_REQUEST になり、キャッシュに残骸を残さない", ...)` の直後（ブロックを閉じる `});` の直前）に以下を追加する。

```ts
  it("variant='preview' を動画に指定すると INVALID_REQUEST", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("mov.mp4", "preview")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("variant='preview' は thumb と別のキャッシュファイルになり、より大きいサイズで生成される", async () => {
    await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toFile(path.join(root, "big.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const thumb = await svc.getThumbnail("big.jpg", "thumb");
    const preview = await svc.getThumbnail("big.jpg", "preview");
    expect(preview).not.toBe(thumb);
    expect(preview.endsWith("-preview.jpg")).toBe(true);
    const thumbMeta = await sharp(thumb).metadata();
    const previewMeta = await sharp(preview).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(480);
    expect(previewMeta.width).toBeGreaterThan(480);
    expect(previewMeta.width).toBeLessThanOrEqual(1920);
  });

  it("variant省略時は従来どおり thumb(480px) として生成される", async () => {
    await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toFile(path.join(root, "default-variant.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("default-variant.jpg");
    expect(result.endsWith("-preview.jpg")).toBe(false);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: FAIL。1つ目のテストは `variant` 引数が現行実装で無視されるため動画でも `INVALID_REQUEST` が発生せず失敗、2つ目は `preview` と `thumb` が同じキャッシュパスを返すため `expect(preview).not.toBe(thumb)` で失敗する。

- [ ] **Step 3: 最小実装**

`apps/server/src/features/thumbnails/thumbnails.service.ts` の冒頭 `export type FfmpegRunner = ...` から `generateImageThumbnail` 関数の終わりまで（現在の10〜121行目相当。`ProcessRunnerSpec` インターフェース定義より前まで）を、以下の内容に置き換える。

```ts
/** 入力動画 absIn からサムネイル JPEG を absOut に生成する。失敗時は throw。 */
export type FfmpegRunner = (absIn: string, absOut: string) => Promise<void>;

/** "thumb" は一覧用(480px)、"preview" はモーダル用の大きいサイズ(1920px) */
export type ThumbnailVariant = "thumb" | "preview";

const VARIANT_SPEC: Record<ThumbnailVariant, { maxSize: number; quality: number }> = {
  thumb: { maxSize: 480, quality: 80 },
  preview: { maxSize: 1920, quality: 85 },
};

export interface ThumbnailServiceOptions {
  root: string;
  cacheDir: string;
  /** null は ffmpeg が使えない環境（getThumbnail は UNSUPPORTED を投げる） */
  runFfmpeg: FfmpegRunner | null;
}

export interface ThumbnailService {
  /** キャッシュ済みサムネイル JPEG の絶対パスを返す。未生成なら生成してから返す。variant省略時は "thumb"。 */
  getThumbnail(relPath: string, variant?: ThumbnailVariant): Promise<string>;
}

export function createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService {
  const { root, cacheDir, runFfmpeg } = opts;
  /** キー→生成中 Promise。同一ファイル・同一variantへの並行リクエストで生成を重複起動しない */
  const inflight = new Map<string, Promise<string>>();
  /** Pi 5 (4GB) 保護のため生成の同時実行数を制限する */
  const MAX_CONCURRENT = 2;
  let running = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (running < MAX_CONCURRENT) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    running++;
  }

  function release(): void {
    running--;
    waiters.shift()?.();
  }

  async function generate(
    abs: string,
    cachePath: string,
    kind: "video" | "image",
    variant: ThumbnailVariant,
  ): Promise<string> {
    if (kind === "video" && !runFfmpeg) {
      throw new AppError("UNSUPPORTED", "ffmpeg is not available");
    }
    await acquire();
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
    const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      if (kind === "video") {
        await runFfmpeg!(abs, tmp);
      } else {
        await generateImageThumbnail(abs, tmp, variant);
      }
      await fs.rename(tmp, cachePath);
      return cachePath;
    } finally {
      release();
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  return {
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
      if (!st) {
        throw new AppError("NOT_FOUND", `not found: ${relPath}`);
      }
      if (st.isDirectory()) {
        throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
      }
      // mtime をキーに含めるため、更新されたファイルは自動で別キャッシュになる
      const key = createHash("sha256")
        .update(`${relPath}|${Math.trunc(st.mtimeMs)}|${st.size}`)
        .digest("hex");
      const suffix = variant === "preview" ? "-preview" : "";
      const cachePath = path.join(cacheDir, `${key}${suffix}.jpg`);
      const cached = await fs.stat(cachePath).catch(() => null);
      if (cached) {
        return cachePath;
      }
      const inflightKey = `${key}${suffix}`;
      const existing = inflight.get(inflightKey);
      if (existing) {
        return existing;
      }
      const promise = generate(abs, cachePath, mediaKind, variant).finally(() =>
        inflight.delete(inflightKey),
      );
      inflight.set(inflightKey, promise);
      return promise;
    },
  };
}

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

ファイル後半の `ProcessRunnerSpec` / `createProcessRunner` / `ffmpegRunner` / `detectFfmpeg` はこの時点では変更しない。

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: PASS（既存テストも含め全て通る。動画に `runFfmpeg: null` を渡すケースなど、既存の呼び出しは `variant` 未指定のままなので壊れない）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/features/thumbnails/thumbnails.service.ts apps/server/src/features/thumbnails/thumbnails.service.test.ts
git commit -m "$(cat <<'EOF'
feat: サムネイル生成にプレビュー用の大きいサイズ(variant)を追加

EOF
)"
```

---

### Task 2: `heif-convert` の実行コマンド定義と起動時検出を追加する

HEICサービス層のロジック（Task 3）より先に、実際にシステムコマンドを叩く部分を独立して用意する。`createProcessRunner` は Task 1 で変更していない既存の汎用実装をそのまま使う。

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: `createProcessRunner`（既存）
- Produces: `export type HeifRunner = (absIn: string, absOut: string) => Promise<void>;` / `export const heifConvertRunner: HeifRunner` / `export function detectHeifConvert(): Promise<boolean>`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.service.test.ts` の末尾、`describe("detectFfmpeg", ...)` ブロックの直後に以下を追加する（インポート文の `createThumbnailService, detectFfmpeg, type FfmpegRunner` に `detectHeifConvert` を追加するのを忘れないこと）。

```ts
describe("detectHeifConvert", () => {
  it("resolves within a few seconds even if heif-convert is slow or absent", async () => {
    const result = await detectHeifConvert();
    expect(typeof result).toBe("boolean");
  });
});
```

インポート行を次のように変更する:

```ts
import {
  createProcessRunner,
  createThumbnailService,
  detectFfmpeg,
  detectHeifConvert,
  type FfmpegRunner,
} from "./thumbnails.service";
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: FAIL — `detectHeifConvert` が `thumbnails.service.ts` からエクスポートされておらず、import解決エラーになる

- [ ] **Step 3: 実装**

まず `apps/server/src/features/thumbnails/thumbnails.service.ts` 冒頭の `export type FfmpegRunner = (absIn: string, absOut: string) => Promise<void>;` の直後に、`HeifRunner` 型を追加する（Task 3以降で `ThumbnailServiceOptions` から参照するため、ファイル冒頭の型定義群にまとめて置く）。

```ts
/** 入力HEIC absIn からJPEGを absOut に変換する。失敗時は throw。 */
export type HeifRunner = (absIn: string, absOut: string) => Promise<void>;
```

次に、ファイルの末尾（`detectFfmpeg` 関数の後）に以下を追記する。

```ts
/**
 * 本番用 runner。heif-convert は出力ファイル名の拡張子で形式を判定するため、
 * 出力パスは常に .jpg 拡張子を渡す（呼び出し側で保証する）。
 */
export const heifConvertRunner: HeifRunner = createProcessRunner({
  command: "heif-convert",
  args: (absIn, absOut) => [absIn, absOut],
  timeoutMs: 20_000,
});

/**
 * heif-convert が実行可能かを起動時に確認する用。
 * heif-convert は引数無しで実行すると使用方法を表示して非ゼロ終了するため、ffmpeg の `-version` のように
 * 終了コード0を期待できない。そのため終了コードではなく「プロセスを起動できたか（ENOENT等でspawn自体が
 * 失敗しなかったか）」だけを可否判定に使う。ハングした場合もサーバー起動をブロックし続けないようタイムアウトする。
 */
export function detectHeifConvert(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("heif-convert", [], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(true);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: PASS

- [ ] **Step 5: 動作確認（任意、heif-convertが手元にあれば）**

Run: `node -e "require('/Users/sato/github/NAS-FileManager/apps/server/node_modules/.bin/../../src/features/thumbnails/thumbnails.service.ts')"` は tsx 経由でないと動かないため実行しない。代わりに以下でローカル環境に `heif-convert` があるか確認する（無くてもこのタスクは完了扱いで良い。無い場合は `detectHeifConvert()` が `false` を返すだけで、後続タスクのUNSUPPORTEDパスのテストでカバーされる）。

Run: `command -v heif-convert || echo "not installed locally (OK, detectHeifConvert が false を返すだけ)"`

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/features/thumbnails/thumbnails.service.ts apps/server/src/features/thumbnails/thumbnails.service.test.ts
git commit -m "$(cat <<'EOF'
feat: heif-convertの実行コマンドと起動時検出を追加

EOF
)"
```

---

### Task 3: HEIC変換をサムネイル生成パイプラインに組み込む

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ThumbnailVariant` / `generateImageThumbnail(abs, absOut, variant)`、Task 2 の `HeifRunner` 型
- Produces: `ThumbnailServiceOptions.runHeifConvert?: HeifRunner | null`（省略時は `null` 扱い。`.heic` かつ `runHeifConvert` 無しは `UNSUPPORTED`）

- [ ] **Step 1: 失敗するテストを書く**

`thumbnails.service.test.ts` の `describe("createThumbnailService.getThumbnail", ...)` ブロック内、Task 1 で追加した3つのテスト（`variant省略時は従来どおり...`まで）の直後、ブロックを閉じる `});` の直前に以下を追加する。

```ts
  it(".heic は runHeifConvert が null（heif-convert 不在）のとき UNSUPPORTED", async () => {
    await writeFile(path.join(root, "photo.heic"), "heic-bytes");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null, runHeifConvert: null });
    await expect(svc.getThumbnail("photo.heic")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it(".heic は runHeifConvert 省略時もUNSUPPORTED（デフォルトnull扱い）", async () => {
    await writeFile(path.join(root, "photo2.heic"), "heic-bytes");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    await expect(svc.getThumbnail("photo2.heic")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it(".heic は runHeifConvert の出力を sharp パイプラインに渡してJPEGサムネイルを生成する", async () => {
    await writeFile(path.join(root, "photo.heic"), "fake-heic-bytes");
    const heifRunner = vi.fn(async (_absIn: string, absOut: string) => {
      await sharp({
        create: { width: 800, height: 600, channels: 3, background: { r: 5, g: 6, b: 7 } },
      })
        .jpeg()
        .toFile(absOut);
    });
    const svc = createThumbnailService({
      root,
      cacheDir,
      runFfmpeg: null,
      runHeifConvert: heifRunner,
    });
    const result = await svc.getThumbnail("photo.heic");
    expect(heifRunner).toHaveBeenCalledTimes(1);
    expect(heifRunner).toHaveBeenCalledWith(
      path.join(root, "photo.heic"),
      expect.stringContaining(".heic-tmp-"),
    );
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBeLessThanOrEqual(480);
  });

  it(".heic 変換の一時ファイルは成功時にキャッシュディレクトリへ残らない", async () => {
    await writeFile(path.join(root, "photo.heic"), "fake-heic-bytes");
    const heifRunner = vi.fn(async (_absIn: string, absOut: string) => {
      await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .jpeg()
        .toFile(absOut);
    });
    const svc = createThumbnailService({
      root,
      cacheDir,
      runFfmpeg: null,
      runHeifConvert: heifRunner,
    });
    await svc.getThumbnail("photo.heic");
    const files = await readdir(cacheDir);
    expect(files.some((f) => f.includes(".heic-tmp-"))).toBe(false);
  });

  it(".heic 変換失敗時もキャッシュディレクトリに残骸を残さない", async () => {
    await writeFile(path.join(root, "photo.heic"), "fake-heic-bytes");
    const heifRunner = vi.fn(async () => {
      throw new Error("heif-convert failed");
    });
    const svc = createThumbnailService({
      root,
      cacheDir,
      runFfmpeg: null,
      runHeifConvert: heifRunner,
    });
    await expect(svc.getThumbnail("photo.heic")).rejects.toThrow("heif-convert failed");
    expect(await readdir(cacheDir)).toEqual([]);
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: FAIL（TypeScriptの型エラー的にはvitestはトランスパイルのみで型チェックしないため実行はされるが、`runHeifConvert` オプションが実装に存在しないため全てのHEICテストで `UNSUPPORTED` ではなく `generateImageThumbnail` が `.heic` ファイルの中身「heic-bytes」をsharpでデコードしようとして `INVALID_REQUEST`（画像として不正）になり、期待値と食い違って失敗する）

- [ ] **Step 3: 実装**

`HeifRunner` 型は Task 2 で `FfmpegRunner` の直後に追加済みなのでそのまま使う。`ThumbnailServiceOptions` を変更する:

```ts
export interface ThumbnailServiceOptions {
  root: string;
  cacheDir: string;
  /** null は ffmpeg が使えない環境（getThumbnail は UNSUPPORTED を投げる） */
  runFfmpeg: FfmpegRunner | null;
  /** 省略・null は heif-convert が使えない環境（.heic の getThumbnail は UNSUPPORTED を投げる） */
  runHeifConvert?: HeifRunner | null;
}
```

`createThumbnailService` の先頭の分割代入を変更する:

```ts
export function createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService {
  const { root, cacheDir, runFfmpeg, runHeifConvert = null } = opts;
```

`generate()` を変更する:

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
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
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
      if (isHeic) {
        await fs.rm(heicTmp, { force: true }).catch(() => undefined);
      }
    }
  }
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.service`
Expected: PASS（全テスト）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/features/thumbnails/thumbnails.service.ts apps/server/src/features/thumbnails/thumbnails.service.test.ts
git commit -m "$(cat <<'EOF'
feat: HEICサムネイル/プレビュー生成をheif-convert経由で対応する

EOF
)"
```

---

### Task 4: `size` クエリパラメータで `preview` サイズを配信できるようにする

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.schema.ts`
- Modify: `apps/server/src/features/thumbnails/thumbnails.routes.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.routes.test.ts`

**Interfaces:**
- Consumes: Task 1 の `ThumbnailVariant` / `getThumbnail(relPath, variant)`
- Produces: `parseVariant(value: string | undefined): ThumbnailVariant`。`GET /api/thumbnail?path=...&size=preview` で大きいサイズを返す

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.routes.test.ts` の先頭 import に `sharp` を追加する:

```ts
import sharp from "sharp";
```

（既存の `import { mkdtemp, rm, writeFile } from "node:fs/promises";` の直後に追加）

`describe("GET /api/thumbnail", ...)` ブロックの末尾、`it("thumbnails オプション省略時(ffmpeg 無し)は 501 + UNSUPPORTED", ...)` の直後、ブロックを閉じる `});` の直前に以下を追加する。

```ts
  it("size=preview は大きいサイズのサムネイルを返す", async () => {
    await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toFile(path.join(root, "big.jpg"));
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=big.jpg&size=preview", withAuth());
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBeGreaterThan(480);
  });

  it("size が不正な値だと 400 + INVALID_REQUEST", async () => {
    // 破損画像だとsize検証を実装する前から(生成失敗経由で)偶然400になってしまうため、
    // 有効な画像を使い「sizeバリデーションによって」400になることを検証する
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .jpeg()
      .toFile(path.join(root, "a.jpg"));
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=a.jpg&size=huge", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.routes`
Expected: FAIL — `size` クエリが無視され、1つ目は常に480px以下のサムネイルが返るため `toBeGreaterThan(480)` で失敗、2つ目は不正な `size` でもエラーにならず200が返り `toBe(400)` で失敗する

- [ ] **Step 3: 実装**

`apps/server/src/features/thumbnails/thumbnails.schema.ts` を以下に置き換える。

```ts
import type { ThumbnailVariant } from "./thumbnails.service";
import { AppError } from "../../lib/errors";

export function requirePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new AppError("INVALID_REQUEST", "path is required");
  }
  return value;
}

export function parseVariant(value: string | undefined): ThumbnailVariant {
  if (value === undefined || value === "thumb") return "thumb";
  if (value === "preview") return "preview";
  throw new AppError("INVALID_REQUEST", "invalid size");
}
```

`apps/server/src/features/thumbnails/thumbnails.routes.ts` を以下に置き換える。

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { parseVariant, requirePath } from "./thumbnails.schema";
import type { ThumbnailService } from "./thumbnails.service";

export function createThumbnailsRoutes(service: ThumbnailService): Hono {
  const app = new Hono();

  app.get("/thumbnail", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const variant = parseVariant(c.req.query("size"));
    const absJpeg = await service.getThumbnail(rel, variant);
    const st = await stat(absJpeg);
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", String(st.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    // mtime 込みのキャッシュキーで URL は不変のため、ブラウザ側キャッシュを1日効かせる
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(
      Readable.toWeb(createReadStream(absJpeg)) as unknown as ReadableStream<Uint8Array>,
    );
  });

  return app;
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.routes`
Expected: PASS（全テスト）

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/features/thumbnails/thumbnails.schema.ts apps/server/src/features/thumbnails/thumbnails.routes.ts apps/server/src/features/thumbnails/thumbnails.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: GET /api/thumbnail にsizeクエリ(preview)を追加

EOF
)"
```

---

### Task 5: 起動時に `heif-convert` を検出しサービスへ配線する

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.routes.test.ts`

**Interfaces:**
- Consumes: Task 2 の `heifConvertRunner` / `detectHeifConvert`、Task 3 の `ThumbnailServiceOptions.runHeifConvert`
- Produces: `ThumbnailOptions.runHeifConvert?: HeifRunner | null`（`app.ts`）。`createApp` 経由で `.heic` のサムネイル/プレビューが実際に動く

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.routes.test.ts` の `describe("GET /api/thumbnail", ...)` ブロック末尾（Task 4で追加した2テストの直後、閉じる `});` の直前）に以下を追加する。

```ts
  it(".heic は thumbnails.runHeifConvert 未指定(デフォルトnull)なら 501 + UNSUPPORTED", async () => {
    await writeFile(path.join(root, "photo.heic"), "heic-bytes");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=photo.heic", withAuth());
    expect(res.status).toBe(501);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("UNSUPPORTED");
  });

  it(".heic は runHeifConvert が設定されていれば変換結果を返す", async () => {
    await writeFile(path.join(root, "photo.heic"), "heic-bytes");
    const app = createApp(root, authConfig, undefined, {
      ...thumbOptions(),
      runHeifConvert: async (_absIn, absOut) => {
        await sharp({
          create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
        })
          .jpeg()
          .toFile(absOut);
      },
    });
    const res = await app.request("/api/thumbnail?path=photo.heic", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.routes`
Expected: 1つ目のテストは Task 3 の時点で `runHeifConvert` 省略時に既に `UNSUPPORTED` を返すため、この時点でも PASS する（これは想定内）。2つ目のテストは FAIL する — `createApp` が `runHeifConvert` を `createThumbnailService` に渡していないため、`{ ...thumbOptions(), runHeifConvert: ... }` で渡した変換関数は無視され、`.heic` は常に `UNSUPPORTED`(501)のままとなり `expect(res.status).toBe(200)` で失敗する

- [ ] **Step 3: 実装**

`apps/server/src/app.ts` の import 部分を変更する。

現在:
```ts
import {
  createThumbnailService,
  type FfmpegRunner,
} from "./features/thumbnails/thumbnails.service";
```

変更後:
```ts
import {
  createThumbnailService,
  type FfmpegRunner,
  type HeifRunner,
} from "./features/thumbnails/thumbnails.service";
```

`ThumbnailOptions` インターフェースを変更する。

現在:
```ts
export interface ThumbnailOptions {
  cacheDir: string;
  runFfmpeg: FfmpegRunner | null;
}
```

変更後:
```ts
export interface ThumbnailOptions {
  cacheDir: string;
  runFfmpeg: FfmpegRunner | null;
  runHeifConvert?: HeifRunner | null;
}
```

`createThumbnailService` の呼び出しを変更する。

現在:
```ts
  const thumbnailService = createThumbnailService({
    root,
    cacheDir: thumbnails?.cacheDir ?? path.join(root, ".thumb-cache"),
    runFfmpeg: thumbnails?.runFfmpeg ?? null,
  });
```

変更後:
```ts
  const thumbnailService = createThumbnailService({
    root,
    cacheDir: thumbnails?.cacheDir ?? path.join(root, ".thumb-cache"),
    runFfmpeg: thumbnails?.runFfmpeg ?? null,
    runHeifConvert: thumbnails?.runHeifConvert ?? null,
  });
```

`apps/server/src/server.ts` の import を変更する。

現在:
```ts
import { detectFfmpeg, ffmpegRunner } from "./features/thumbnails/thumbnails.service";
```

変更後:
```ts
import {
  detectFfmpeg,
  detectHeifConvert,
  ffmpegRunner,
  heifConvertRunner,
} from "./features/thumbnails/thumbnails.service";
```

起動処理を変更する。

現在:
```ts
const ffmpegAvailable = await detectFfmpeg();
if (!ffmpegAvailable) {
  console.warn("ffmpeg not found: video thumbnails are disabled (/api/thumbnail returns 501)");
}

const app = createApp(root, authConfig, staticDir, {
  cacheDir: resolveThumbCacheDir(),
  runFfmpeg: ffmpegAvailable ? ffmpegRunner : null,
});
```

変更後:
```ts
const ffmpegAvailable = await detectFfmpeg();
if (!ffmpegAvailable) {
  console.warn("ffmpeg not found: video thumbnails are disabled (/api/thumbnail returns 501)");
}
const heifConvertAvailable = await detectHeifConvert();
if (!heifConvertAvailable) {
  console.warn(
    "heif-convert not found: HEIC preview is disabled (/api/thumbnail returns 501 for .heic)",
  );
}

const app = createApp(root, authConfig, staticDir, {
  cacheDir: resolveThumbCacheDir(),
  runFfmpeg: ffmpegAvailable ? ffmpegRunner : null,
  runHeifConvert: heifConvertAvailable ? heifConvertRunner : null,
});
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/server -- thumbnails.routes`
Expected: PASS（全テスト）

- [ ] **Step 5: サーバー全体のテストと型チェック**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全テストスイート）

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/app.ts apps/server/src/server.ts apps/server/src/features/thumbnails/thumbnails.routes.test.ts
git commit -m "$(cat <<'EOF'
feat: 起動時にheif-convertを検出しHEICサムネイル生成を有効化する

EOF
)"
```

---

### Task 6: フロントの `api.thumbnailUrl` に `preview` variant を追加する

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Produces: `api.thumbnailUrl(path: string, variant?: "preview"): string`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/api.test.ts` に以下の `describe` ブロックを追加する（`describe("api.previewUrl", ...)` ブロックの直後が自然）。

```ts
describe("api.thumbnailUrl", () => {
  it("variant省略時はsizeパラメータを付けない", () => {
    expect(api.thumbnailUrl("docs/a.mp4")).toBe(
      `/api/thumbnail?path=${encodeURIComponent("docs/a.mp4")}`,
    );
  });

  it("variant='preview'指定時はsize=previewを付ける", () => {
    expect(api.thumbnailUrl("docs/a.heic", "preview")).toBe(
      `/api/thumbnail?path=${encodeURIComponent("docs/a.heic")}&size=preview`,
    );
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- api.test`
Expected: FAIL — `api.thumbnailUrl("docs/a.heic", "preview")` の第2引数が現行実装で無視され、`&size=preview` が付かないため2つ目のテストが失敗する

- [ ] **Step 3: 実装**

`apps/web/src/lib/api.ts` の `thumbnailUrl` を以下に置き換える。

現在:
```ts
  thumbnailUrl(path: string): string {
    return `/api/thumbnail?path=${encodeURIComponent(path)}`;
  },
```

変更後:
```ts
  thumbnailUrl(path: string, variant?: "preview"): string {
    const size = variant ? `&size=${variant}` : "";
    return `/api/thumbnail?path=${encodeURIComponent(path)}${size}`;
  },
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- api.test`
Expected: PASS

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "$(cat <<'EOF'
feat: api.thumbnailUrlにpreviewサイズ指定を追加

EOF
)"
```

---

### Task 7: `HeicPreview` コンポーネントを新規作成する

`TextPreview.tsx` と同様、単体で状態（変換失敗時のフォールバック）を持つ小さいコンポーネント。

**Files:**
- Create: `apps/web/src/features/file-list/dialogs/HeicPreview.tsx`
- Test: `apps/web/src/features/file-list/dialogs/HeicPreview.test.tsx`

**Interfaces:**
- Produces: `HeicPreview({ name: string; url: string; downloadHref: string }): JSX.Element`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/dialogs/HeicPreview.test.tsx` を新規作成する。

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeicPreview } from "./HeicPreview";

describe("HeicPreview", () => {
  it("画像を表示する", () => {
    render(
      <HeicPreview
        name="a.heic"
        url="/api/thumbnail?path=a.heic&size=preview"
        downloadHref="/api/download?path=a.heic"
      />,
    );
    const img = screen.getByRole("img", { name: "a.heic" });
    expect(img).toHaveAttribute("src", "/api/thumbnail?path=a.heic&size=preview");
  });

  it("画像の読み込みに失敗するとダウンロードへのフォールバックを表示する", () => {
    render(
      <HeicPreview
        name="a.heic"
        url="/api/thumbnail?path=a.heic&size=preview"
        downloadHref="/api/download?path=a.heic"
      />,
    );
    const img = screen.getByRole("img", { name: "a.heic" });
    fireEvent.error(img);
    expect(screen.getByText("プレビューできません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ダウンロード/ })).toHaveAttribute(
      "href",
      "/api/download?path=a.heic",
    );
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- HeicPreview`
Expected: FAIL — `./HeicPreview` モジュールが存在せず import エラーになる

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/dialogs/HeicPreview.tsx` を新規作成する。

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function HeicPreview({
  name,
  url,
  downloadHref,
}: {
  name: string;
  url: string;
  downloadHref: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-muted-foreground">プレビューできません</p>
        <Button asChild>
          <a href={downloadHref} download>
            ダウンロード
          </a>
        </Button>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      className="max-h-[70vh] w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
```

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- HeicPreview`
Expected: PASS

- [ ] **Step 5: 型チェック**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/dialogs/HeicPreview.tsx apps/web/src/features/file-list/dialogs/HeicPreview.test.tsx
git commit -m "$(cat <<'EOF'
feat: HEIC変換失敗時にダウンロードへフォールバックするHeicPreviewを追加

EOF
)"
```

---

### Task 8: `PreviewDialog` にHEIC分岐を統合する

**Files:**
- Modify: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx`
- Test: `apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx`

**Interfaces:**
- Consumes: Task 6 の `api.thumbnailUrl(path, "preview")`、Task 7 の `HeicPreview`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx` の `it("非対応の拡張子はダウンロードへのフォールバックを表示する", ...)` の直後、`it("open が false のときは中身を描画しない", ...)` の前に以下を追加する。

```ts
  it("HEICはHeicPreview経由でプレビュー用サムネイルを表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.heic" path="docs/a.heic" />);
    const img = screen.getByRole("img", { name: "a.heic" });
    expect(img).toHaveAttribute(
      "src",
      `/api/thumbnail?path=${encodeURIComponent("docs/a.heic")}&size=preview`,
    );
  });
```

- [ ] **Step 2: テストを実行し失敗を確認する**

Run: `npm run test -w @nas-fm/web -- PreviewDialog`
Expected: FAIL — `.heic` は現行実装だと通常の `kind === "image"` 分岐に入り `src` が `/api/preview?path=...`（変換無しの生バイト）になるため、`toHaveAttribute("src", ".../api/thumbnail?...")` が失敗する

- [ ] **Step 3: 実装**

`apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` を以下に置き換える。

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

- [ ] **Step 4: テストを実行し成功を確認する**

Run: `npm run test -w @nas-fm/web -- PreviewDialog`
Expected: PASS（既存4テスト＋新規1テスト）

- [ ] **Step 5: 型チェックとフロント全体のテスト**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー無し

Run: `npm run test -w @nas-fm/web`
Expected: PASS（全テストスイート。特に `FileGrid.test.tsx` は無変更のまま通ること — `FileGrid.tsx` は `.heic` を既に汎用の画像サムネイル経路(`api.thumbnailUrl(relPath)`)で扱っているため、今回のPreviewDialog変更の影響を受けない）

- [ ] **Step 6: コミット**

```bash
git add apps/web/src/features/file-list/dialogs/PreviewDialog.tsx apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat: プレビューモーダルでHEICを変換済みサムネイル経由で表示する

EOF
)"
```

---

### Task 9: `docs/spec.md` を更新する

コードではなくドキュメントの更新のみ。テストは無し。

**Files:**
- Modify: `docs/spec.md`

- [ ] **Step 1: デプロイ手順にheif-convertのインストールを追記する**

`docs/spec.md` の「動画サムネイル生成に ffmpeg を使うため...」の行（ffmpegのapt install手順の行）の直後に、以下の1行を追加する。

```markdown
- HEICプレビュー変換に `heif-convert`（`libheif-examples`）を使うため `sudo apt install libheif-examples` を実行しておく（無くても起動はするがHEICのサムネイル/プレビューは 501 になる。開発機(Mac)は `brew install libheif`）
```

- [ ] **Step 2: §10.2「画像」のHEICに関する記述を更新する**

`docs/spec.md` の以下の行を:

```markdown
- 注意: **HEIC（iPhone 写真）**は多くのブラウザが非対応。対応するなら `sharp`（libheif）でサーバ変換が必要だが 4GB 機には重いため、初版は「HEIC は DL のみ」で割り切る。
```

以下に置き換える:

```markdown
- **HEIC（iPhone 写真）**は多くのブラウザが非対応だが、サーバー側で `heif-convert`（`libheif-examples`）により JPEG に変換して配信する（詳細: `docs/superpowers/specs/2026-07-11-heic-preview-design.md`）。`heif-convert` が無い環境では他の非対応形式と同様 501 を返し DL のみに切り替わる。
```

- [ ] **Step 3: §10.4「新規に必要なもの」を更新する**

`docs/spec.md` の以下の行を:

```markdown
- **必要**: Range 対応つき inline 配信エンドポイント、`mime-types`、（テキスト用）ハイライトライブラリ、（動画サムネイル用）システム ffmpeg、（任意）HEIC/サムネ用 `sharp`。
```

以下に置き換える:

```markdown
- **必要**: Range 対応つき inline 配信エンドポイント、`mime-types`、（テキスト用）ハイライトライブラリ、（動画サムネイル用）システム ffmpeg、サムネイル生成用 `sharp`、（HEICプレビュー用）システム `heif-convert`（`libheif-examples`）。
```

- [ ] **Step 4: コミット**

```bash
git add docs/spec.md
git commit -m "$(cat <<'EOF'
docs: HEICプレビュー対応のデプロイ手順・仕様説明を更新する

EOF
)"
```

---

## 完了確認

全タスク完了後、以下を実行してリポジトリ全体が壊れていないことを確認する。

Run: `npm run typecheck`
Expected: 全ワークスペースでエラー無し

Run: `npm run test`
Expected: 全ワークスペースでPASS

Run: `npm run lint`
Expected: エラー無し（pre-commitで既に oxlint --fix が各コミット時に走っているはずだが、最終確認として実行する）
