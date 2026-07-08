# 動画サムネイルのサーバー側生成 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グリッド表示の動画サムネイルを `<video>` 要素から、サーバー（ffmpeg 1 フレーム抽出＋ディスクキャッシュ）生成の `<img>` に置き換える。

**Architecture:** 新規 `thumbnails` feature（Hono）が `GET /api/thumbnail?path=` でオンデマンド生成＋キャッシュ返却。生成はシステム ffmpeg を spawn（2 並列制限・15 秒タイムアウト・in-flight 共有）。ffmpeg 呼び出しは `FfmpegRunner` 関数として注入可能にしテストではモック。フロントは `FileGrid` の video 分岐を img に差し替える。

**Tech Stack:** Hono / Node 24（node:child_process, node:crypto）/ React 19 / Vitest。**npm 依存の追加はなし**（システム ffmpeg を使用）。

スペック: `docs/superpowers/specs/2026-07-08-video-thumbnail-design.md`

## Global Constraints

- Node `>=24.18.0`。npm 依存は追加しない
- `verbatimModuleSyntax: true` — 型のみの import は必ず `import type`
- feature 間の直接 import 禁止。共通ロジックは `lib/`（`safe-resolve` / `errors` は lib から import する）
- フォーマット/リントは oxfmt / oxlint（pre-commit の husky + lint-staged で自動実行）
- コミットは Conventional Commits（接頭辞は英語、本文は日本語）
- サーバのテスト実行: `npm run test -w @nas-fm/server -- <file>`、web は `npm run test -w @nas-fm/web -- <file>`

---

### Task 1: `UNSUPPORTED` エラーコード（HTTP 501）の追加

**Files:**
- Modify: `packages/shared/src/types.ts:16-24`
- Modify: `apps/server/src/lib/errors.ts:13-29`
- Test: `apps/server/src/lib/errors.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `ApiErrorCode` に `"UNSUPPORTED"`（以降のタスクで `new AppError("UNSUPPORTED", ...)` が使える）。`statusOf("UNSUPPORTED") === 501`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/lib/errors.test.ts` の `describe("statusOf")` 内の `it.each` テーブルに 1 行追加:

```ts
  it.each([
    ["PATH_TRAVERSAL", 400],
    ["INVALID_REQUEST", 400],
    ["NOT_A_DIRECTORY", 400],
    ["IS_A_DIRECTORY", 400],
    ["UNAUTHORIZED", 401],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["UNSUPPORTED", 501],
    ["INTERNAL", 500],
  ] as const)("%s は %d", (code, status) => {
    expect(statusOf(code)).toBe(status);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/lib/errors.test.ts`
Expected: FAIL（`"UNSUPPORTED"` が `ApiErrorCode` に無い型エラー、または statusOf が undefined を返して失敗）

- [ ] **Step 3: 実装する**

`packages/shared/src/types.ts` の `ApiErrorCode` に追加:

```ts
export type ApiErrorCode =
  | "PATH_TRAVERSAL"
  | "INVALID_REQUEST"
  | "NOT_A_DIRECTORY"
  | "IS_A_DIRECTORY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "UNSUPPORTED"
  | "INTERNAL";
```

`apps/server/src/lib/errors.ts` の `statusOf` を変更（戻り型 union に 501 を追加し、case を足す）:

```ts
export function statusOf(code: ApiErrorCode): 400 | 401 | 404 | 409 | 500 | 501 {
  switch (code) {
    case "PATH_TRAVERSAL":
    case "INVALID_REQUEST":
    case "NOT_A_DIRECTORY":
    case "IS_A_DIRECTORY":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "UNSUPPORTED":
      return 501;
    case "INTERNAL":
      return 500;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/lib/errors.test.ts`
Expected: PASS

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add packages/shared/src/types.ts apps/server/src/lib/errors.ts apps/server/src/lib/errors.test.ts
git commit -m "feat: UNSUPPORTEDエラーコード(501)を追加"
```

---

### Task 2: `resolveThumbCacheDir`（キャッシュディレクトリ解決）

**Files:**
- Modify: `apps/server/src/lib/config.ts`
- Test: `apps/server/src/lib/config.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `resolveThumbCacheDir(): string` — `THUMB_CACHE_DIR` 環境変数（未設定時 `<cwd>/.thumb-cache`）を解決し、ディレクトリを作成して絶対パスを返す

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/lib/config.test.ts` — import に `resolveThumbCacheDir` を追加し、`THUMB_CACHE_DIR` の保存/復元を beforeEach/afterEach に追加、describe を新設:

```ts
import { resolveNasRoot, resolveThumbCacheDir } from "./config";
```

beforeEach / afterEach（既存の `savedEnv` と同様に）:

```ts
let savedThumbEnv: string | undefined;

// beforeEach に追加
savedThumbEnv = process.env.THUMB_CACHE_DIR;

// afterEach に追加
if (savedThumbEnv === undefined) {
  delete process.env.THUMB_CACHE_DIR;
} else {
  process.env.THUMB_CACHE_DIR = savedThumbEnv;
}
```

describe を追加:

```ts
describe("resolveThumbCacheDir", () => {
  it("THUMB_CACHE_DIR が設定されていればそこを作成して返す", () => {
    const target = path.join(dir, "thumbs", "cache");
    process.env.THUMB_CACHE_DIR = target;
    expect(resolveThumbCacheDir()).toBe(target);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("未設定なら <cwd>/.thumb-cache を作成して返す", async () => {
    delete process.env.THUMB_CACHE_DIR;
    process.chdir(dir);
    const result = resolveThumbCacheDir();
    // macOS では tmpdir がシンボリックリンクのため realpath で比較する
    expect(result).toBe(path.join(await realpath(dir), ".thumb-cache"));
    expect(statSync(result).isDirectory()).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/lib/config.test.ts`
Expected: FAIL（`resolveThumbCacheDir` が export されていない）

- [ ] **Step 3: 実装する**

`apps/server/src/lib/config.ts` に追加:

```ts
/**
 * THUMB_CACHE_DIR 環境変数からサムネイルキャッシュディレクトリを解決する。
 * 未設定の場合は <cwd>/.thumb-cache を使う。いずれの場合も無ければ作成する
 * （NAS_ROOT と違い生成物の置き場なので、存在しないことは設定ミスではない）。
 */
export function resolveThumbCacheDir(): string {
  const dir = path.resolve(
    process.env.THUMB_CACHE_DIR ?? path.join(process.cwd(), ".thumb-cache"),
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/lib/config.test.ts`
Expected: PASS（既存の resolveNasRoot テスト含む）

- [ ] **Step 5: `.gitignore` に開発時キャッシュを追加**

ルートの `.gitignore` に `.dev-share` と同様の並びで追記（`.dev-share` の記載行の近くに置く）:

```
.thumb-cache/
```

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/lib/config.ts apps/server/src/lib/config.test.ts .gitignore
git commit -m "feat: サムネイルキャッシュディレクトリの解決(THUMB_CACHE_DIR)を追加"
```

---

### Task 3: `thumbnails.service` — 基本フロー（検証・キャッシュ・生成）

**Files:**
- Create: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: `safeResolve(root, userPath)`（`lib/safe-resolve`）、`AppError`（`lib/errors`、Task 1 の `UNSUPPORTED` を含む）、`classifyPreview(filename)`（`@nas-fm/shared`）
- Produces:
  - `type FfmpegRunner = (absIn: string, absOut: string) => Promise<void>`
  - `interface ThumbnailServiceOptions { root: string; cacheDir: string; runFfmpeg: FfmpegRunner | null }`
  - `interface ThumbnailService { getThumbnail(relPath: string): Promise<string> }`（生成済みサムネイル JPEG の絶対パスを返す）
  - `createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.service.test.ts` を新規作成:

```ts
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbnailService, type FfmpegRunner } from "./thumbnails.service";

let root: string;
let cacheParent: string;
let cacheDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-root-"));
  cacheParent = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-cache-"));
  // 存在しないサブディレクトリを指定し、service が自分で作ることを検証する
  cacheDir = path.join(cacheParent, "cache");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cacheParent, { recursive: true, force: true });
});

/** absOut にダミー JPEG を書き込む成功 runner */
function okRunner() {
  return vi.fn(async (_absIn: string, absOut: string) => {
    await writeFile(absOut, "jpeg-bytes");
  });
}

describe("createThumbnailService.getThumbnail", () => {
  it("動画以外の拡張子は INVALID_REQUEST", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("a.txt")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("../evil.mp4")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    });
  });

  it("存在しないファイルは NOT_FOUND", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("missing.mp4")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ディレクトリは IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "dir.mp4"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("dir.mp4")).rejects.toMatchObject({ code: "IS_A_DIRECTORY" });
  });

  it("runFfmpeg が null（ffmpeg 不在）は UNSUPPORTED", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    await expect(svc.getThumbnail("mov.mp4")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("キャッシュミス時は runner を呼び、生成結果のパスを返す", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const result = await svc.getThumbnail("mov.mp4");
    expect(result.startsWith(cacheDir + path.sep)).toBe(true);
    expect(result.endsWith(".jpg")).toBe(true);
    expect(await readFile(result, "utf8")).toBe("jpeg-bytes");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(path.join(root, "mov.mp4"), expect.stringContaining(".tmp-"));
  });

  it("2回目はキャッシュヒットし runner を呼ばない", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const first = await svc.getThumbnail("mov.mp4");
    const second = await svc.getThumbnail("mov.mp4");
    expect(second).toBe(first);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("ファイルが更新される(mtime/size 変化)と再生成する", async () => {
    const abs = path.join(root, "mov.mp4");
    await writeFile(abs, "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const first = await svc.getThumbnail("mov.mp4");
    await writeFile(abs, "data-updated");
    const second = await svc.getThumbnail("mov.mp4");
    expect(second).not.toBe(first);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("runner 失敗時はエラーが伝播し、キャッシュに残骸を残さない", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner: FfmpegRunner = vi.fn(async () => {
      throw new Error("ffmpeg failed");
    });
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    await expect(svc.getThumbnail("mov.mp4")).rejects.toThrow("ffmpeg failed");
    expect(await readdir(cacheDir)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: FAIL（`thumbnails.service` モジュールが存在しない）

- [ ] **Step 3: 実装する**

`apps/server/src/features/thumbnails/thumbnails.service.ts` を新規作成:

```ts
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { classifyPreview } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

/** 入力動画 absIn からサムネイル JPEG を absOut に生成する。失敗時は throw。 */
export type FfmpegRunner = (absIn: string, absOut: string) => Promise<void>;

export interface ThumbnailServiceOptions {
  root: string;
  cacheDir: string;
  /** null は ffmpeg が使えない環境（getThumbnail は UNSUPPORTED を投げる） */
  runFfmpeg: FfmpegRunner | null;
}

export interface ThumbnailService {
  /** キャッシュ済みサムネイル JPEG の絶対パスを返す。未生成なら生成してから返す。 */
  getThumbnail(relPath: string): Promise<string>;
}

export function createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService {
  const { root, cacheDir, runFfmpeg } = opts;

  async function generate(abs: string, cachePath: string): Promise<string> {
    if (!runFfmpeg) {
      throw new AppError("UNSUPPORTED", "ffmpeg is not available");
    }
    await fs.mkdir(cacheDir, { recursive: true });
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
    const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await runFfmpeg(abs, tmp);
      await fs.rename(tmp, cachePath);
      return cachePath;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  return {
    async getThumbnail(relPath: string): Promise<string> {
      const abs = safeResolve(root, relPath);
      if (classifyPreview(path.basename(abs)) !== "video") {
        throw new AppError("INVALID_REQUEST", "thumbnail is only supported for videos");
      }
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
      const cachePath = path.join(cacheDir, `${key}.jpg`);
      const cached = await fs.stat(cachePath).catch(() => null);
      if (cached) {
        return cachePath;
      }
      return generate(abs, cachePath);
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: PASS（9 テスト）

注意: 「ファイルが更新されると再生成する」テストは mtime か size の変化に依存する。`"data"` → `"data-updated"` はサイズが異なるため、mtime の分解能に関わらずキーが変わる。

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/thumbnails/
git commit -m "feat: 動画サムネイル生成サービスを追加(検証・キャッシュ・アトミック配置)"
```

---

### Task 4: `thumbnails.service` — 並行制御（in-flight 共有＋2 並列セマフォ）

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: Task 3 の `createThumbnailService`
- Produces: 外部インターフェースは不変（挙動のみ変更: 同一キー並行リクエストの重複生成防止、生成の最大 2 並列化）

- [ ] **Step 1: 失敗するテストを書く**

`thumbnails.service.test.ts` の `describe("createThumbnailService.getThumbnail")` 内に追加:

```ts
  it("同一ファイルへの並行リクエストは生成を1回だけ行い同じ結果を返す", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const runner: FfmpegRunner = vi.fn(async (_absIn, absOut) => {
      await gate;
      await writeFile(absOut, "jpeg-bytes");
    });
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const p1 = svc.getThumbnail("mov.mp4");
    const p2 = svc.getThumbnail("mov.mp4");
    releaseGate();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("生成は最大2並列に制限される", async () => {
    for (const name of ["a.mp4", "b.mp4", "c.mp4"]) {
      await writeFile(path.join(root, name), name);
    }
    let current = 0;
    let max = 0;
    const gates: Array<() => void> = [];
    const runner: FfmpegRunner = async (_absIn, absOut) => {
      current++;
      max = Math.max(max, current);
      await new Promise<void>((resolve) => gates.push(resolve));
      current--;
      await writeFile(absOut, "x");
    };
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const all = Promise.all([
      svc.getThumbnail("a.mp4"),
      svc.getThumbnail("b.mp4"),
      svc.getThumbnail("c.mp4"),
    ]);
    // 2件目までは開始されるが、3件目はセマフォ待ちになる
    await vi.waitFor(() => expect(gates.length).toBe(2));
    expect(current).toBe(2);
    // 1件解放すると3件目が開始される
    gates.shift()!();
    await vi.waitFor(() => expect(gates.length).toBe(2));
    // 残りを解放して完了させる
    gates.shift()!();
    gates.shift()!();
    await all;
    expect(max).toBe(2);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: FAIL（並行リクエストで runner が 2 回呼ばれる／3 並列で走り max が 3 になる）

- [ ] **Step 3: 実装する**

`thumbnails.service.ts` を修正。`createThumbnailService` の先頭に状態を追加:

```ts
export function createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService {
  const { root, cacheDir, runFfmpeg } = opts;
  /** キー→生成中 Promise。同一ファイルへの並行リクエストで ffmpeg を重複起動しない */
  const inflight = new Map<string, Promise<string>>();
  /** Pi 5 (4GB) 保護のため ffmpeg の同時実行数を制限する */
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
```

`generate` をセマフォで挟む（`runFfmpeg` の null チェックは acquire より前に行う）:

```ts
  async function generate(abs: string, cachePath: string): Promise<string> {
    if (!runFfmpeg) {
      throw new AppError("UNSUPPORTED", "ffmpeg is not available");
    }
    await acquire();
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
    const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await runFfmpeg(abs, tmp);
      await fs.rename(tmp, cachePath);
      return cachePath;
    } finally {
      release();
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }
```

`getThumbnail` の末尾（キャッシュミス時）を in-flight 共有に変更:

```ts
      const cached = await fs.stat(cachePath).catch(() => null);
      if (cached) {
        return cachePath;
      }
      const existing = inflight.get(key);
      if (existing) {
        return existing;
      }
      const promise = generate(abs, cachePath).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: PASS（11 テスト）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/thumbnails/
git commit -m "feat: サムネイル生成にin-flight共有と2並列セマフォを追加"
```

---

### Task 5: ffmpeg プロセス実行（runner・タイムアウト・検出）

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: Task 3 の `FfmpegRunner` 型
- Produces:
  - `interface ProcessRunnerSpec { command: string; args: (absIn: string, absOut: string) => string[]; timeoutMs: number }`
  - `createProcessRunner(spec: ProcessRunnerSpec): FfmpegRunner`
  - `ffmpegRunner: FfmpegRunner`（本番用: `ffmpeg -ss 1 ... -frames:v 1`、15 秒タイムアウト）
  - `detectFfmpeg(): Promise<boolean>`（`ffmpeg -version` の成否）

- [ ] **Step 1: 失敗するテストを書く**

`thumbnails.service.test.ts` に describe を追加。実プロセスを起動するが、テスト用コマンドには確実に存在する `process.execPath`（node 自身）を使う:

```ts
import { createProcessRunner, createThumbnailService, type FfmpegRunner } from "./thumbnails.service";
```

```ts
describe("createProcessRunner", () => {
  it("コマンド成功(exit 0)で resolve し、出力が書かれる", async () => {
    const out = path.join(cacheParent, "out.jpg");
    const runner = createProcessRunner({
      command: process.execPath,
      // node -e <script> <absOut> — 固定 args の代わりにテスト用スクリプトで absOut へ書き込む
      args: (_absIn, absOut) => [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'ok')",
        absOut,
      ],
      timeoutMs: 10_000,
    });
    await runner("in.mp4", out);
    expect(await readFile(out, "utf8")).toBe("ok");
  });

  it("コマンド失敗(exit 非0)は INVALID_REQUEST", async () => {
    const runner = createProcessRunner({
      command: process.execPath,
      args: () => ["-e", "process.exit(1)"],
      timeoutMs: 10_000,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("コマンド不在(ENOENT)は UNSUPPORTED", async () => {
    const runner = createProcessRunner({
      command: "nasfm-definitely-missing-command",
      args: () => [],
      timeoutMs: 10_000,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("タイムアウトでプロセスを kill し INTERNAL", async () => {
    const runner = createProcessRunner({
      command: process.execPath,
      args: () => ["-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 200,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: FAIL（`createProcessRunner` が export されていない）

- [ ] **Step 3: 実装する**

`thumbnails.service.ts` の import に追加:

```ts
import { spawn } from "node:child_process";
```

ファイル末尾に追加:

```ts
export interface ProcessRunnerSpec {
  command: string;
  args: (absIn: string, absOut: string) => string[];
  timeoutMs: number;
}

/** 外部コマンドを spawn する FfmpegRunner を作る。タイムアウトで SIGKILL する。 */
export function createProcessRunner(spec: ProcessRunnerSpec): FfmpegRunner {
  return (absIn, absOut) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args(absIn, absOut), { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new AppError("INTERNAL", "thumbnail generation timed out"));
      }, spec.timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new AppError("UNSUPPORTED", "ffmpeg is not available"));
          return;
        }
        reject(new AppError("INTERNAL", `failed to run ffmpeg: ${String(err)}`));
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        // タイムアウト reject 済みの場合、この resolve/reject は無視される（Promise は一度しか確定しない）
        if (exitCode === 0) {
          resolve();
        } else {
          reject(new AppError("INVALID_REQUEST", "failed to generate thumbnail"));
        }
      });
    });
}

/**
 * 本番用 runner。-ss 1 で 1 秒目のフレームを抽出（1 秒未満の動画は ffmpeg が末尾にクランプ）。
 * 出力の拡張子が .tmp-xxx のため、-c:v mjpeg -f image2 で形式を明示する。
 */
export const ffmpegRunner: FfmpegRunner = createProcessRunner({
  command: "ffmpeg",
  args: (absIn, absOut) => [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "1",
    "-i",
    absIn,
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    "-c:v",
    "mjpeg",
    "-f",
    "image2",
    "-y",
    absOut,
  ],
  timeoutMs: 15_000,
});

/** ffmpeg が実行可能かを起動時に確認する用 */
export function detectFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: PASS（15 テスト）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/thumbnails/
git commit -m "feat: ffmpegプロセス実行runner(タイムアウト付き)と起動時検出を追加"
```

---

### Task 6: `thumbnails` routes・schema・`app.ts` マウント

**Files:**
- Create: `apps/server/src/features/thumbnails/thumbnails.schema.ts`
- Create: `apps/server/src/features/thumbnails/thumbnails.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.routes.test.ts`

**Interfaces:**
- Consumes: Task 3-4 の `createThumbnailService` / `ThumbnailService` / `FfmpegRunner`
- Produces:
  - `createThumbnailsRoutes(service: ThumbnailService): Hono` — `GET /thumbnail?path=`
  - `createApp` の第 4 引数 `thumbnails?: ThumbnailOptions`（`interface ThumbnailOptions { cacheDir: string; runFfmpeg: FfmpegRunner | null }`、省略時は「ffmpeg 無し」= 501）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.routes.test.ts` を新規作成（`files.routes.test.ts` のパターンを踏襲）:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError } from "@nas-fm/shared";
import { createApp, type ThumbnailOptions } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";

let root: string;
let cacheDir: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-routes-"));
  cacheDir = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-routes-cache-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cacheDir, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

function thumbOptions(): ThumbnailOptions {
  return {
    cacheDir,
    runFfmpeg: async (_absIn, absOut) => {
      await writeFile(absOut, "jpeg-data");
    },
  };
}

describe("GET /api/thumbnail", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=mov.mp4");
    expect(res.status).toBe(401);
  });

  it("成功時は 200 + image/jpeg + キャッシュヘッダ", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=mov.mp4", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(await res.text()).toBe("jpeg-data");
  });

  it("path 未指定は 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("動画以外は 400 + INVALID_REQUEST", async () => {
    await writeFile(path.join(root, "a.txt"), "text");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=a.txt", withAuth());
    expect(res.status).toBe(400);
  });

  it("存在しないファイルは 404 + NOT_FOUND", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=missing.mp4", withAuth());
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("パストラバーサルは 400 + PATH_TRAVERSAL", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=..%2Fevil.mp4", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("PATH_TRAVERSAL");
  });

  it("thumbnails オプション省略時(ffmpeg 無し)は 501 + UNSUPPORTED", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/thumbnail?path=mov.mp4", withAuth());
    expect(res.status).toBe(501);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("UNSUPPORTED");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.routes.test.ts`
Expected: FAIL（`ThumbnailOptions` が app から export されていない／ルートが 404）

- [ ] **Step 3: 実装する**

`apps/server/src/features/thumbnails/thumbnails.schema.ts` を新規作成（feature 間 import 禁止のため `files.schema` から import せず、同じパターンを踏襲）:

```ts
import { AppError } from "../../lib/errors";

export function requirePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new AppError("INVALID_REQUEST", "path is required");
  }
  return value;
}
```

`apps/server/src/features/thumbnails/thumbnails.routes.ts` を新規作成:

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { requirePath } from "./thumbnails.schema";
import type { ThumbnailService } from "./thumbnails.service";

export function createThumbnailsRoutes(service: ThumbnailService): Hono {
  const app = new Hono();

  app.get("/thumbnail", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const absJpeg = await service.getThumbnail(rel);
    const st = await stat(absJpeg);
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", String(st.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    // mtime 込みのキャッシュキーで URL は不変のため、ブラウザ側キャッシュを1日効かせる
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(Readable.toWeb(createReadStream(absJpeg)) as unknown as ReadableStream);
  });

  return app;
}
```

`apps/server/src/app.ts` を修正。import に追加:

```ts
import path from "node:path";
import { createThumbnailsRoutes } from "./features/thumbnails/thumbnails.routes";
import {
  createThumbnailService,
  type FfmpegRunner,
} from "./features/thumbnails/thumbnails.service";
```

`ThumbnailOptions` を export し、シグネチャに第 4 引数を追加:

```ts
export interface ThumbnailOptions {
  cacheDir: string;
  runFfmpeg: FfmpegRunner | null;
}

export function createApp(
  root: string,
  authConfig: AuthConfig,
  staticDir?: string,
  thumbnails?: ThumbnailOptions,
): Hono {
```

`app.route("/api", createFilesRoutes(root));` の直後に追加:

```ts
  // thumbnails 未指定（テスト等）は「ffmpeg 無し」として動かす。
  // runFfmpeg が null の間はキャッシュへの書き込みが発生しないため、cacheDir のデフォルト値が使われることはない。
  const thumbnailService = createThumbnailService({
    root,
    cacheDir: thumbnails?.cacheDir ?? path.join(root, ".thumb-cache"),
    runFfmpeg: thumbnails?.runFfmpeg ?? null,
  });
  app.route("/api", createThumbnailsRoutes(thumbnailService));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（既存テスト含む全件。`createApp` の既存呼び出しは第 4 引数省略で後方互換）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/thumbnails/ apps/server/src/app.ts
git commit -m "feat: GET /api/thumbnail エンドポイントを追加"
```

---

### Task 7: `server.ts` 起動配線（ffmpeg 検出＋キャッシュディレクトリ）

**Files:**
- Modify: `apps/server/src/server.ts`

**Interfaces:**
- Consumes: `detectFfmpeg` / `ffmpegRunner`（Task 5）、`resolveThumbCacheDir`（Task 2）、`createApp` 第 4 引数（Task 6）
- Produces: 本番/開発サーバで実 ffmpeg による生成が有効になる

- [ ] **Step 1: 実装する**

`apps/server/src/server.ts` を修正。import を変更・追加:

```ts
import { resolveNasRoot, resolveThumbCacheDir } from "./lib/config";
import { detectFfmpeg, ffmpegRunner } from "./features/thumbnails/thumbnails.service";
```

`const app = createApp(root, authConfig, staticDir);` を以下に変更（ESM のためトップレベル await 可）:

```ts
const ffmpegAvailable = await detectFfmpeg();
if (!ffmpegAvailable) {
  console.warn(
    "ffmpeg not found: video thumbnails are disabled (/api/thumbnail returns 501)",
  );
}

const app = createApp(root, authConfig, staticDir, {
  cacheDir: resolveThumbCacheDir(),
  runFfmpeg: ffmpegAvailable ? ffmpegRunner : null,
});
```

- [ ] **Step 2: 型チェックとビルドが通ることを確認**

Run: `npm run typecheck && npm run build -w @nas-fm/server`
Expected: エラーなし（esbuild は format=esm なのでトップレベル await 可）

- [ ] **Step 3: 動作確認（ffmpeg がある環境）**

```bash
which ffmpeg || echo "ffmpeg なし: この確認はスキップし、warn ログのみ確認"
npm run dev:server
```

別の確認: 起動ログに ffmpeg の warn が出ない（ffmpeg がある場合）/ 出る（無い場合）ことを確認して Ctrl-C。

- [ ] **Step 4: コミット**

```bash
git add apps/server/src/server.ts
git commit -m "feat: 起動時にffmpegを検出してサムネイル生成を配線"
```

---

### Task 8: フロントエンド — `FileGrid` の動画サムネイルを img に差し替え

**Files:**
- Modify: `apps/web/src/lib/api.ts:62-64`（`previewUrl` の直後に追加）
- Modify: `apps/web/src/features/file-list/components/FileGrid.tsx`
- Test: `apps/web/src/features/file-list/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `GET /api/thumbnail?path=`（Task 6）
- Produces: `api.thumbnailUrl(path: string): string`。グリッドに `<video>` 要素が存在しなくなる

- [ ] **Step 1: 失敗するテストを書く**

`FileGrid.test.tsx` を更新する。**削除するテスト**（video 前提のもの）:

- 「動画は #t=1 付き previewUrl の video を描画する」
- 「動画の読み込み失敗でアイコンにフォールバックする」（video 版）
- 「映像トラックの無い動画(videoWidth=0)はアイコンにフォールバックする」
- 「映像トラックがあれば動画を維持する」
- 「動画はビューポートに入るまでvideo要素をマウントしない(遅延読み込み)」

**追加するテスト**（同じ位置に）:

```ts
  it("動画は thumbnailUrl を src に持つ img を描画し、video 要素を使わない", () => {
    const { container } = renderGrid();
    const img = screen.getByAltText("mov.mp4");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=mov.mp4");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("video")).toBeNull();
  });

  it("動画サムネイルには再生アイコンを重ねる", () => {
    const { container } = renderGrid();
    expect(container.querySelector(".lucide-play")).not.toBeNull();
  });

  it("動画サムネイルの読み込み失敗でアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    fireEvent.error(screen.getByAltText("mov.mp4"));
    expect(screen.queryByAltText("mov.mp4")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-play")).toBeNull();
    expect(screen.getByText("mov.mp4")).toBeInTheDocument(); // 名前は残る
  });

  it("動画はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)", () => {
    let capturedCallback: IntersectionObserverCallback | undefined;
    class ManualIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        capturedCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);

    renderGrid();
    expect(screen.queryByAltText("mov.mp4")).not.toBeInTheDocument();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByAltText("mov.mp4")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
```

既存の「その他ファイルとフォルダはサムネイルを持たない」「ディレクトリ移動後は…失敗状態を引き継がない」はそのまま残す。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- src/features/file-list/components/FileGrid.test.tsx`
Expected: FAIL（動画はまだ video で描画されるため新テストが失敗）

- [ ] **Step 3: 実装する**

`apps/web/src/lib/api.ts` — `previewUrl` の直後に追加:

```ts
  thumbnailUrl(path: string): string {
    return `/api/thumbnail?path=${encodeURIComponent(path)}`;
  },
```

`apps/web/src/features/file-list/components/FileGrid.tsx` — `Thumbnail` コンポーネントを差し替え。import の `Film` に加えて `Play` を追加し、video 関連の記述を除去:

```tsx
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { File, Film, Folder, Image as ImageIcon, Play } from "lucide-react";
import { api } from "@/lib/api";
import { RowActions } from "./RowActions";

function Thumbnail({ name, relPath }: { name: string; relPath: string }) {
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const kind = classifyPreview(name);

  // 可視範囲に入るまでサムネイルのリクエストを遅延し、生成リクエストがサーバに殺到しないようにする
  useEffect(() => {
    if (kind !== "video" || visible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [kind, visible]);

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
      <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
        {visible ? (
          <>
            <img
              src={api.thumbnailUrl(relPath)}
              alt={name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-background/70 p-1.5">
                <Play size={16} className="fill-current text-foreground" />
              </span>
            </span>
          </>
        ) : (
          <Film size={40} className="text-muted-foreground" />
        )}
      </div>
    );
  }
  if (kind === "image") return <ImageIcon size={40} className="text-muted-foreground" />;
  if (kind === "video") return <Film size={40} className="text-muted-foreground" />;
  return <File size={40} className="text-muted-foreground" />;
}
```

`FileGrid` 本体（`export function FileGrid`）は変更しない。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web`
Expected: PASS（FileGrid 以外の既存テスト含む全件）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/lib/api.ts apps/web/src/features/file-list/components/FileGrid.tsx apps/web/src/features/file-list/components/FileGrid.test.tsx
git commit -m "fix: グリッドの動画サムネイルをvideo要素からサーバー生成のimgに置換"
```

（`fix` なのは、video 要素がプレビューダイアログの上に描画されるオーバーレイ合成バグの根治のため）

---

### Task 9: ドキュメント・デプロイ設定の更新

**Files:**
- Modify: `docs/spec.md`（10.2 動画 / 10.4 まとめ / 7 章デプロイ）
- Modify: `deploy/nas-fm.service`

**Interfaces:**
- Consumes: これまでのタスクの成果（`THUMB_CACHE_DIR` / `/api/thumbnail` / ffmpeg 依存）
- Produces: ドキュメントと運用設定の整合

- [ ] **Step 1: `docs/spec.md` 10.2「動画」に追記**

「mkv/avi や特殊コーデックは…」の項目の直後に追加:

```markdown
- **一覧サムネイル**はサーバ側で ffmpeg の 1 フレーム抽出（`-ss 1 -frames:v 1`、幅 480px の JPEG）により生成し、`GET /api/thumbnail` で配信する。キャッシュは `THUMB_CACHE_DIR`（未設定時 `<cwd>/.thumb-cache`）にパス+mtime+size のハッシュをキーとして保存。再生用のトランスコードと違い 1 フレームのみのデコードなので Pi 5 でも軽い（避けるべきは常時トランスコードであってこれではない）。同時生成は 2 並列・15 秒タイムアウトで制限。ffmpeg が無い環境では 501 を返し、フロントはアイコン表示にフォールバックする。
```

- [ ] **Step 2: `docs/spec.md` 10.4「必要なもの」を更新**

`- **必要**: ...` の行に `ffmpeg` を追記:

```markdown
- **必要**: Range 対応つき inline 配信エンドポイント、`mime-types`、（テキスト用）ハイライトライブラリ、（動画サムネイル用）システム ffmpeg、（任意）HEIC/サムネ用 `sharp`。
```

- [ ] **Step 3: `docs/spec.md` 7 章（デプロイ）に追記**

ini コードブロック内の `Environment=PORT=8080` の直後に追加:

```ini
Environment=THUMB_CACHE_DIR=/opt/nas-fm/.thumb-cache
```

7 章末尾の箇条書き（`- ポートは他サービス…` の後）に追加:

```markdown
- 動画サムネイル生成に ffmpeg を使うため `sudo apt install ffmpeg` を実行しておく（無くても起動はするがサムネイルは 501 になり一覧はアイコン表示になる）
```

- [ ] **Step 4: `deploy/nas-fm.service` を更新**

`Environment=PORT=8080` の直後に追加（spec.md の ini ブロックと一致させる）:

```ini
Environment=THUMB_CACHE_DIR=/opt/nas-fm/.thumb-cache
```

- [ ] **Step 5: コミット**

```bash
git add docs/spec.md deploy/nas-fm.service
git commit -m "docs: 動画サムネイル生成の仕様とデプロイ手順を追記"
```

---

### Task 10: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全ワークスペースの検証コマンド**

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Expected: すべてエラーなし

- [ ] **Step 2: 実動作の確認（ffmpeg がある環境で）**

`/verify` スキル（または手動）で以下を確認:

1. `.dev-share` に mp4 を 1 つ置いて `npm run dev` で起動
2. ブラウザでログイン → グリッド表示で動画カードにサムネイル（静止画+再生アイコン）が出る
3. DevTools の Elements でグリッドに `<video>` が存在しないこと
4. 動画カードをクリック → プレビューダイアログの動画が**グリッドに隠れず**再生できる（元バグの解消確認）
5. `.thumb-cache/`（サーバ cwd）に `<hash>.jpg` が生成されている
6. リロード時に 2 回目は 200 が即返る（またはブラウザキャッシュで リクエスト無し）

- [ ] **Step 3: 完了処理**

superpowers:finishing-a-development-branch スキルに従って完了判断する（main 直接運用のためマージ作業は無し。必要ならリモートに push）。
