# Phase 1: ファイル操作 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/server` に NAS_ROOT 配下のファイル操作 API（list / upload / download / mkdir / rename / delete）をパストラバーサル対策・ストリーミング・安全優先の競合ポリシー付きで実装する。

**Architecture:** routes（HTTP 入出力変換のみ）/ service（fs 操作の純関数、`(root, relPath, ...)` を受ける）/ lib（safeResolve・NAS_ROOT 解決・AppError）に分離。エラーは code 付き `AppError` を投げ、`app.ts` の `onError` で HTTP ステータス＋統一 JSON に一元変換。設計は `docs/superpowers/specs/2026-07-02-phase1-files-api-design.md`。

**Tech Stack:** Hono / @hono/node-server / Node fs・stream（`pipeline`）/ Vitest（実 fs、`mkdtemp`）/ @nas-fm/shared（型）

## Global Constraints

- **禁止コマンド**（ユーザー設定）: `curl` / `wget` / `rm -rf` / `env` / `printenv` / `git push --force`。HTTP 疎通確認は Node の `fetch` を使う。`.env*` は読まない
- **依存追加**: `.npmrc` が `save-exact` / `min-release-age=3` を強制。新規依存は**バージョン無指定**で `npm install -D vitest -w @nas-fm/server`（これ以外の新規依存は追加しない）
- **TypeScript**: `erasableSyntaxOnly` が有効 → **parameter properties・enum 禁止**（クラスはフィールド明示代入）。`verbatimModuleSyntax` が有効 → 型のみの import/export は必ず `import type` / `export type`。`baseUrl` 禁止・`paths` の値は相対（既存 tsconfig は変更しない）
- **import 規約**: server 内部のモジュール間 import は**相対パス**を使う（`@/` エイリアスは tsx / Vitest の paths 解決差異を避けるため使わない）。`@nas-fm/shared` からの import は**型のみ**（`import type`。実行時解決は発生しない）
- **テスト**: 実 fs（`fs.mkdtemp(os.tmpdir())`）を使う。**fs のモック禁止**。Vitest のグローバル注入は使わず `import { describe, it, expect } from "vitest"` を明示
- **コミット**: Conventional Commits（接頭辞は英語、本文・件名は日本語）。pre-commit で lint-staged（oxfmt → oxlint --fix → 全ワークスペース typecheck）が自動で走る。1タスク=1コミット
- **Node**: 24.16.0 固定

---

## File Structure

```
packages/shared/src/types.ts       # 変更: ApiErrorCode / ApiError / OkResponse / MkdirRequest / RenameRequest を追加
packages/shared/src/index.ts       # 変更: 上記を export type に追加
apps/server/package.json           # 変更: vitest devDep・"test": "vitest run"
apps/server/src/lib/errors.ts      # 新規: AppError / statusOf / fromFsError
apps/server/src/lib/errors.test.ts
apps/server/src/lib/safe-resolve.ts        # 新規: safeResolve(root, userPath)
apps/server/src/lib/safe-resolve.test.ts
apps/server/src/lib/config.ts      # 新規: resolveNasRoot()
apps/server/src/lib/config.test.ts
apps/server/src/features/files/files.service.ts       # 新規: fs 操作の純関数群
apps/server/src/features/files/files.service.test.ts
apps/server/src/features/files/files.schema.ts         # 新規: 手書きバリデーション
apps/server/src/features/files/files.routes.ts         # 新規: createFilesRoutes(root)
apps/server/src/features/files/files.routes.test.ts
apps/server/src/app.ts             # 変更: createApp(root) 化 + onError
apps/server/src/server.ts          # 変更: resolveNasRoot() → createApp(root)
apps/web/vite.config.ts            # 変更: /api dev proxy 追加
.gitignore                         # 変更: .dev-share/ を追加
docs/roadmap.md                    # 変更: Phase 1 のチェックを更新
```

`apps/server/src/features/files/.gitkeep` と `apps/server/src/lib/.gitkeep` は実ファイル追加時に削除する。

---

### Task 1: Vitest 導入・共有 API 型・AppError 基盤

**Files:**
- Modify: `apps/server/package.json`（vitest devDep・test script）
- Modify: `packages/shared/src/types.ts`, `packages/shared/src/index.ts`
- Create: `apps/server/src/lib/errors.ts`
- Test: `apps/server/src/lib/errors.test.ts`

**Interfaces:**
- Consumes: `@nas-fm/shared` の既存型（`FileEntry` / `ListResponse`）
- Produces:
  - shared: `type ApiErrorCode = "PATH_TRAVERSAL" | "INVALID_REQUEST" | "NOT_A_DIRECTORY" | "IS_A_DIRECTORY" | "NOT_FOUND" | "CONFLICT" | "INTERNAL"`、`interface ApiError { error: { code: ApiErrorCode; message: string } }`、`interface OkResponse { ok: true }`、`interface MkdirRequest { path: string }`、`interface RenameRequest { from: string; to: string }`
  - server: `class AppError extends Error { readonly code: ApiErrorCode }`（`new AppError(code, message)`）、`statusOf(code: ApiErrorCode): 400 | 404 | 409 | 500`、`fromFsError(err: unknown, subject: string): AppError`

- [ ] **Step 1: vitest を server に追加**

```bash
npm install -D vitest -w @nas-fm/server
```

`apps/server/package.json` の `scripts` に追加（既存 scripts は変更しない）:

```json
    "test": "vitest run"
```

- [ ] **Step 2: shared に API 型を追加**

`packages/shared/src/types.ts` の末尾に追記:

```ts
export type ApiErrorCode =
  | "PATH_TRAVERSAL"
  | "INVALID_REQUEST"
  | "NOT_A_DIRECTORY"
  | "IS_A_DIRECTORY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export interface OkResponse {
  ok: true;
}

export interface MkdirRequest {
  path: string;
}

export interface RenameRequest {
  from: string;
  to: string;
}
```

`packages/shared/src/index.ts` を全置換:

```ts
export type {
  ApiError,
  ApiErrorCode,
  FileEntry,
  FileType,
  ListResponse,
  MkdirRequest,
  OkResponse,
  RenameRequest,
} from "./types";
```

- [ ] **Step 3: 失敗するテストを書く**

`apps/server/src/lib/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AppError, fromFsError, statusOf } from "./errors";

describe("AppError", () => {
  it("code と message を保持する", () => {
    const err = new AppError("CONFLICT", "already exists: a.txt");
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("already exists: a.txt");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("statusOf", () => {
  it.each([
    ["PATH_TRAVERSAL", 400],
    ["INVALID_REQUEST", 400],
    ["NOT_A_DIRECTORY", 400],
    ["IS_A_DIRECTORY", 400],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["INTERNAL", 500],
  ] as const)("%s は %d", (code, status) => {
    expect(statusOf(code)).toBe(status);
  });
});

describe("fromFsError", () => {
  function fsError(code: string): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error(code);
    err.code = code;
    return err;
  }

  it("ENOENT は NOT_FOUND", () => {
    expect(fromFsError(fsError("ENOENT"), "a.txt").code).toBe("NOT_FOUND");
  });

  it("EEXIST は CONFLICT", () => {
    expect(fromFsError(fsError("EEXIST"), "a.txt").code).toBe("CONFLICT");
  });

  it("ENOTDIR は NOT_A_DIRECTORY", () => {
    expect(fromFsError(fsError("ENOTDIR"), "a").code).toBe("NOT_A_DIRECTORY");
  });

  it("EISDIR は IS_A_DIRECTORY", () => {
    expect(fromFsError(fsError("EISDIR"), "a").code).toBe("IS_A_DIRECTORY");
  });

  it("AppError はそのまま返す", () => {
    const orig = new AppError("CONFLICT", "x");
    expect(fromFsError(orig, "a")).toBe(orig);
  });

  it("未知のエラーは INTERNAL", () => {
    expect(fromFsError(new Error("boom"), "a").code).toBe("INTERNAL");
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`./errors` が存在しない）

- [ ] **Step 5: `apps/server/src/lib/errors.ts` を実装**

```ts
import type { ApiErrorCode } from "@nas-fm/shared";

export class AppError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function statusOf(code: ApiErrorCode): 400 | 404 | 409 | 500 {
  switch (code) {
    case "PATH_TRAVERSAL":
    case "INVALID_REQUEST":
    case "NOT_A_DIRECTORY":
    case "IS_A_DIRECTORY":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "INTERNAL":
      return 500;
  }
}

export function fromFsError(err: unknown, subject: string): AppError {
  if (err instanceof AppError) return err;
  const code = (err as NodeJS.ErrnoException).code;
  switch (code) {
    case "ENOENT":
      return new AppError("NOT_FOUND", `not found: ${subject}`);
    case "EEXIST":
      return new AppError("CONFLICT", `already exists: ${subject}`);
    case "ENOTDIR":
      return new AppError("NOT_A_DIRECTORY", `not a directory: ${subject}`);
    case "EISDIR":
      return new AppError("IS_A_DIRECTORY", `is a directory: ${subject}`);
    default:
      return new AppError("INTERNAL", `unexpected error: ${String(err)}`);
  }
}
```

※ `erasableSyntaxOnly` のため parameter property（`constructor(readonly code: ...)`）は使えない。上記のとおりフィールド明示代入で書く。

- [ ] **Step 6: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（errors.test.ts の全テスト）

Run: `npm run typecheck` （3ワークスペースすべて成功）

- [ ] **Step 7: lib の .gitkeep を削除してコミット**

```bash
rm apps/server/src/lib/.gitkeep
git add -A
git commit -m "feat: サーバのエラー基盤と共有APIエラー型を追加"
```

---

### Task 2: safeResolve（パストラバーサル検証）

**Files:**
- Create: `apps/server/src/lib/safe-resolve.ts`
- Test: `apps/server/src/lib/safe-resolve.test.ts`

**Interfaces:**
- Consumes: `AppError`（`./errors`）
- Produces: `safeResolve(root: string, userPath: string): string` — root 配下の絶対パスを返す。逸脱時は `AppError("PATH_TRAVERSAL")` を throw

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/lib/safe-resolve.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { safeResolve } from "./safe-resolve";

const ROOT = "/srv/share";

describe("safeResolve", () => {
  it("空文字は root 自身に解決する", () => {
    expect(safeResolve(ROOT, "")).toBe(ROOT);
  });

  it("相対パスは root 配下に解決する", () => {
    expect(safeResolve(ROOT, "docs/a.txt")).toBe(path.join(ROOT, "docs/a.txt"));
  });

  it("root 内に収まる .. は正規化して許可する", () => {
    expect(safeResolve(ROOT, "docs/../a.txt")).toBe(path.join(ROOT, "a.txt"));
  });

  it("絶対パス風の入力は root からの相対として扱う", () => {
    expect(safeResolve(ROOT, "/etc/passwd")).toBe(path.join(ROOT, "etc/passwd"));
  });

  it("root より上への脱出は拒否する", () => {
    expect(() => safeResolve(ROOT, "../secret")).toThrow(AppError);
  });

  it("ネストした脱出も拒否する", () => {
    expect(() => safeResolve(ROOT, "docs/../../secret")).toThrow(AppError);
  });

  it("root 名を前方一致で偽装する兄弟ディレクトリを拒否する", () => {
    expect(() => safeResolve(ROOT, "../share-evil/a.txt")).toThrow(AppError);
  });

  it("エラー code は PATH_TRAVERSAL", () => {
    let caught: unknown;
    try {
      safeResolve(ROOT, "../x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("PATH_TRAVERSAL");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`./safe-resolve` が存在しない）

- [ ] **Step 3: `apps/server/src/lib/safe-resolve.ts` を実装**

```ts
import path from "node:path";
import { AppError } from "./errors";

/** userPath を root 配下の絶対パスに解決する。root の外に出る場合は PATH_TRAVERSAL を投げる。 */
export function safeResolve(root: string, userPath: string): string {
  const resolved = path.resolve(root, "." + path.sep + userPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AppError("PATH_TRAVERSAL", "path traversal detected");
  }
  return resolved;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（errors / safe-resolve の全テスト）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/lib/safe-resolve.ts apps/server/src/lib/safe-resolve.test.ts
git commit -m "feat: パストラバーサル検証 safeResolve を追加"
```

---

### Task 3: NAS_ROOT 解決（config）

**Files:**
- Create: `apps/server/src/lib/config.ts`
- Test: `apps/server/src/lib/config.test.ts`
- Modify: `.gitignore`（`.dev-share/` を追加）

**Interfaces:**
- Produces: `resolveNasRoot(): string` — `NAS_ROOT` 環境変数があれば絶対パス化して返す（存在しない/ディレクトリでない場合は throw）。未設定なら `<process.cwd()>/.dev-share` を自動作成して返す

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/lib/config.test.ts`:

```ts
import { statSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNasRoot } from "./config";

let dir: string;
let savedEnv: string | undefined;
let savedCwd: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nasfm-config-"));
  savedEnv = process.env.NAS_ROOT;
  savedCwd = process.cwd();
});

afterEach(async () => {
  if (savedEnv === undefined) {
    delete process.env.NAS_ROOT;
  } else {
    process.env.NAS_ROOT = savedEnv;
  }
  process.chdir(savedCwd);
  await rm(dir, { recursive: true, force: true });
});

describe("resolveNasRoot", () => {
  it("NAS_ROOT が既存ディレクトリならそれを返す", () => {
    process.env.NAS_ROOT = dir;
    expect(resolveNasRoot()).toBe(dir);
  });

  it("NAS_ROOT が存在しなければ throw する", () => {
    process.env.NAS_ROOT = path.join(dir, "missing");
    expect(() => resolveNasRoot()).toThrow(/NAS_ROOT/);
  });

  it("NAS_ROOT 未設定なら <cwd>/.dev-share を作成して返す", async () => {
    delete process.env.NAS_ROOT;
    process.chdir(dir);
    const root = resolveNasRoot();
    // macOS では tmpdir がシンボリックリンクのため realpath で比較する
    expect(root).toBe(path.join(await realpath(dir), ".dev-share"));
    expect(statSync(root).isDirectory()).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`./config` が存在しない）

- [ ] **Step 3: `apps/server/src/lib/config.ts` を実装**

```ts
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * NAS_ROOT 環境変数からストレージルートを解決する。
 * 未設定の場合は開発用に <cwd>/.dev-share を自動作成して使う。
 * NAS_ROOT が指す先が存在しない/ディレクトリでない場合は起動失敗させる（設定ミスを隠さない）。
 */
export function resolveNasRoot(): string {
  const fromEnv = process.env.NAS_ROOT;
  if (fromEnv) {
    const root = path.resolve(fromEnv);
    const st = statSync(root, { throwIfNoEntry: false });
    if (!st?.isDirectory()) {
      throw new Error(`NAS_ROOT is not an existing directory: ${root}`);
    }
    return root;
  }
  const devRoot = path.resolve(process.cwd(), ".dev-share");
  mkdirSync(devRoot, { recursive: true });
  return devRoot;
}
```

- [ ] **Step 4: `.gitignore` に開発用ルートを追加**

`.gitignore` の末尾に追記:

```
# NAS dev root
.dev-share/
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全テスト）

- [ ] **Step 6: コミット**

```bash
git add apps/server/src/lib/config.ts apps/server/src/lib/config.test.ts .gitignore
git commit -m "feat: NAS_ROOT 解決を追加（未設定時は .dev-share にフォールバック）"
```

---

### Task 4: files.service — listDir / removePath

**Files:**
- Create: `apps/server/src/features/files/files.service.ts`
- Test: `apps/server/src/features/files/files.service.test.ts`

**Interfaces:**
- Consumes: `safeResolve(root, userPath)`、`AppError` / `fromFsError`、shared の `FileEntry`
- Produces:
  - `listDir(root: string, relPath: string): Promise<FileEntry[]>`
  - `removePath(root: string, relPath: string): Promise<void>`（ディレクトリは再帰削除。root 自身は `INVALID_REQUEST`）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/files/files.service.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors";
import { listDir, removePath } from "./files.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-files-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
}

describe("listDir", () => {
  it("ファイルとディレクトリをメタデータ付きで列挙する", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await mkdir(path.join(root, "sub"));
    const entries = await listDir(root, "");
    expect(entries.map((e) => e.name).sort()).toEqual(["a.txt", "sub"]);
    const file = entries.find((e) => e.name === "a.txt");
    expect(file?.type).toBe("file");
    expect(file?.size).toBe(5);
    expect(file?.mtime).toBeGreaterThan(0);
    const dir = entries.find((e) => e.name === "sub");
    expect(dir?.type).toBe("dir");
    expect(dir?.size).toBe(0);
  });

  it("サブディレクトリを列挙できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    const entries = await listDir(root, "sub");
    expect(entries.map((e) => e.name)).toEqual(["b.txt"]);
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(listDir(root, "missing"), "NOT_FOUND");
  });

  it("ファイルを指定すると NOT_A_DIRECTORY", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await expectAppError(listDir(root, "a.txt"), "NOT_A_DIRECTORY");
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    await expectAppError(listDir(root, "../"), "PATH_TRAVERSAL");
  });
});

describe("removePath", () => {
  it("ファイルを削除できる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await removePath(root, "a.txt");
    expect(await readdir(root)).toEqual([]);
  });

  it("空でないディレクトリを再帰削除できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    await removePath(root, "sub");
    expect(await readdir(root)).toEqual([]);
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(removePath(root, "missing"), "NOT_FOUND");
  });

  it("root 自身の削除は INVALID_REQUEST", async () => {
    await expectAppError(removePath(root, ""), "INVALID_REQUEST");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`./files.service` が存在しない）

- [ ] **Step 3: `apps/server/src/features/files/files.service.ts` を実装**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { FileEntry } from "@nas-fm/shared";
import { AppError, fromFsError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

export async function listDir(root: string, relPath: string): Promise<FileEntry[]> {
  const abs = safeResolve(root, relPath);
  let names: string[];
  try {
    names = await fs.readdir(abs);
  } catch (err) {
    throw fromFsError(err, relPath);
  }
  const entries: FileEntry[] = [];
  for (const name of names) {
    const st = await fs.stat(path.join(abs, name)).catch(() => null);
    if (!st) continue; // 列挙後に消えたエントリはスキップ
    const isDir = st.isDirectory();
    entries.push({
      name,
      size: isDir ? 0 : st.size,
      mtime: Math.trunc(st.mtimeMs),
      type: isDir ? "dir" : "file",
    });
  }
  return entries;
}

export async function removePath(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "cannot delete the root directory");
  }
  const st = await fs.lstat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  await fs.rm(abs, { recursive: true });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全テスト）

- [ ] **Step 5: features/files の .gitkeep を削除してコミット**

```bash
rm apps/server/src/features/files/.gitkeep
git add -A
git commit -m "feat: ファイル一覧と削除のサービスを追加"
```

---

### Task 5: files.service — makeDir / renamePath

**Files:**
- Modify: `apps/server/src/features/files/files.service.ts`（関数追加）
- Test: `apps/server/src/features/files/files.service.test.ts`（describe 追加）

**Interfaces:**
- Consumes: Task 4 と同じ ＋ 同ファイルの `expectAppError` ヘルパ
- Produces:
  - `makeDir(root: string, relPath: string): Promise<void>`（同名あり→`CONFLICT`、親なし→`NOT_FOUND`）
  - `renamePath(root: string, from: string, to: string): Promise<void>`（移動元なし→`NOT_FOUND`、移動先あり→`CONFLICT`）

- [ ] **Step 1: 失敗するテストを追記**

`files.service.test.ts` の import を更新し、末尾に describe を追加:

```ts
// import 行を更新:
import { listDir, makeDir, removePath, renamePath } from "./files.service";
```

```ts
describe("makeDir", () => {
  it("ディレクトリを作成できる", async () => {
    await makeDir(root, "newdir");
    const entries = await listDir(root, "");
    expect(entries).toEqual([
      { name: "newdir", size: 0, mtime: expect.any(Number), type: "dir" },
    ]);
  });

  it("同名が存在すると CONFLICT", async () => {
    await makeDir(root, "newdir");
    await expectAppError(makeDir(root, "newdir"), "CONFLICT");
  });

  it("親ディレクトリが無いと NOT_FOUND", async () => {
    await expectAppError(makeDir(root, "no/child"), "NOT_FOUND");
  });
});

describe("renamePath", () => {
  it("ファイルをリネームできる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await renamePath(root, "a.txt", "b.txt");
    expect(await readdir(root)).toEqual(["b.txt"]);
  });

  it("サブディレクトリへ移動できる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await mkdir(path.join(root, "sub"));
    await renamePath(root, "a.txt", "sub/a.txt");
    expect(await readdir(path.join(root, "sub"))).toEqual(["a.txt"]);
  });

  it("移動元が無いと NOT_FOUND", async () => {
    await expectAppError(renamePath(root, "missing", "b.txt"), "NOT_FOUND");
  });

  it("移動先が存在すると CONFLICT（上書きしない）", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await writeFile(path.join(root, "b.txt"), "y");
    await expectAppError(renamePath(root, "a.txt", "b.txt"), "CONFLICT");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`makeDir` / `renamePath` が未定義）

- [ ] **Step 3: `files.service.ts` に実装を追加**

```ts
export async function makeDir(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("CONFLICT", "root directory already exists");
  }
  try {
    await fs.mkdir(abs);
  } catch (err) {
    throw fromFsError(err, relPath);
  }
}

export async function renamePath(root: string, from: string, to: string): Promise<void> {
  const absFrom = safeResolve(root, from);
  const absTo = safeResolve(root, to);
  if (absFrom === root || absTo === root) {
    throw new AppError("INVALID_REQUEST", "cannot rename the root directory");
  }
  const src = await fs.lstat(absFrom).catch(() => null);
  if (!src) {
    throw new AppError("NOT_FOUND", `not found: ${from}`);
  }
  const dst = await fs.lstat(absTo).catch(() => null);
  if (dst) {
    throw new AppError("CONFLICT", `already exists: ${to}`);
  }
  try {
    await fs.rename(absFrom, absTo);
  } catch (err) {
    throw fromFsError(err, to);
  }
}
```

※ 存在チェック→rename の間に他プロセスが割り込む TOCTOU は許容する（単一ユーザー・LAN 内前提。設計 spec 参照）。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/files/files.service.ts apps/server/src/features/files/files.service.test.ts
git commit -m "feat: フォルダ作成とリネームのサービスを追加"
```

---

### Task 6: files.service — uploadFile / statForDownload（ストリーミング）

**Files:**
- Modify: `apps/server/src/features/files/files.service.ts`（関数追加）
- Test: `apps/server/src/features/files/files.service.test.ts`（describe 追加）

**Interfaces:**
- Consumes: Task 4/5 と同じ
- Produces:
  - `uploadFile(root: string, relPath: string, body: Readable, overwrite: boolean): Promise<void>` — `pipeline` で直接ディスクへ。既存あり＆`overwrite=false`→`CONFLICT`、既存がディレクトリ→`IS_A_DIRECTORY`、親なし→`NOT_FOUND`、途中失敗→書きかけ削除
  - `statForDownload(root: string, relPath: string): Promise<{ abs: string; size: number; name: string }>` — なし→`NOT_FOUND`、ディレクトリ→`IS_A_DIRECTORY`

- [ ] **Step 1: 失敗するテストを追記**

`files.service.test.ts` の import を更新し、末尾に describe を追加:

```ts
// node:fs/promises の import に readFile を追加:
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
// 追加 import:
import { Readable } from "node:stream";
// files.service の import を更新:
import {
  listDir,
  makeDir,
  removePath,
  renamePath,
  statForDownload,
  uploadFile,
} from "./files.service";
```

```ts
describe("uploadFile", () => {
  it("ボディストリームを新規ファイルに書き込む", async () => {
    await uploadFile(root, "up.txt", Readable.from("hello"), false);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("hello");
  });

  it("既存ファイルがあり overwrite=false なら CONFLICT（中身は保持）", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    await expectAppError(uploadFile(root, "up.txt", Readable.from("new"), false), "CONFLICT");
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("old");
  });

  it("overwrite=true なら上書きする", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    await uploadFile(root, "up.txt", Readable.from("new"), true);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("new");
  });

  it("パスがディレクトリなら IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "sub"));
    await expectAppError(uploadFile(root, "sub", Readable.from("x"), true), "IS_A_DIRECTORY");
  });

  it("親ディレクトリが無いと NOT_FOUND（自動作成しない）", async () => {
    await expectAppError(uploadFile(root, "no/up.txt", Readable.from("x"), false), "NOT_FOUND");
  });

  it("ストリーム途中失敗時は書きかけファイルを残さない", async () => {
    const failing = new Readable({
      read() {
        this.push("partial");
        this.destroy(new Error("stream broken"));
      },
    });
    await expectAppError(uploadFile(root, "up.txt", failing, false), "INTERNAL");
    expect(await readdir(root)).toEqual([]);
  });
});

describe("statForDownload", () => {
  it("絶対パス・サイズ・ファイル名を返す", async () => {
    await writeFile(path.join(root, "dl.txt"), "hello");
    const info = await statForDownload(root, "dl.txt");
    expect(info.abs).toBe(path.join(root, "dl.txt"));
    expect(info.size).toBe(5);
    expect(info.name).toBe("dl.txt");
  });

  it("存在しないと NOT_FOUND", async () => {
    await expectAppError(statForDownload(root, "missing"), "NOT_FOUND");
  });

  it("ディレクトリは IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "sub"));
    await expectAppError(statForDownload(root, "sub"), "IS_A_DIRECTORY");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`uploadFile` / `statForDownload` が未定義）

- [ ] **Step 3: `files.service.ts` に実装を追加**

ファイル先頭の import を更新:

```ts
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
```

末尾に追加:

```ts
export async function uploadFile(
  root: string,
  relPath: string,
  body: Readable,
  overwrite: boolean,
): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "upload path must be a file path");
  }
  const existing = await fs.stat(abs).catch(() => null);
  if (existing?.isDirectory()) {
    throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
  }
  if (existing && !overwrite) {
    throw new AppError("CONFLICT", `already exists: ${relPath}`);
  }
  const parent = path.dirname(abs);
  const parentSt = await fs.stat(parent).catch(() => null);
  if (!parentSt?.isDirectory()) {
    throw new AppError("NOT_FOUND", `parent directory not found: ${relPath}`);
  }
  try {
    // 大容量ファイルをメモリに載せないため、必ず pipeline + createWriteStream で書く
    await pipeline(body, createWriteStream(abs));
  } catch (err) {
    await fs.rm(abs, { force: true }).catch(() => undefined);
    throw fromFsError(err, relPath);
  }
}

export async function statForDownload(
  root: string,
  relPath: string,
): Promise<{ abs: string; size: number; name: string }> {
  const abs = safeResolve(root, relPath);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  if (st.isDirectory()) {
    throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
  }
  return { abs, size: st.size, name: path.basename(abs) };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（全テスト）

- [ ] **Step 5: コミット**

```bash
git add apps/server/src/features/files/files.service.ts apps/server/src/features/files/files.service.test.ts
git commit -m "feat: ストリーミングアップロード/ダウンロードのサービスを追加"
```

---

### Task 7: schema・routes・createApp 統合

**Files:**
- Create: `apps/server/src/features/files/files.schema.ts`
- Create: `apps/server/src/features/files/files.routes.ts`
- Modify: `apps/server/src/app.ts`（全置換: `createApp(root)` 化）
- Modify: `apps/server/src/server.ts`（全置換: `resolveNasRoot()` → `createApp(root)`）
- Test: `apps/server/src/features/files/files.routes.test.ts`

**Interfaces:**
- Consumes: Task 1–6 のすべて（`AppError` / `statusOf` / `resolveNasRoot` / service 6関数 / shared 型）
- Produces:
  - `createFilesRoutes(root: string): Hono`（`/list` `/upload` `/download` `/mkdir` `/rename` `/delete`）
  - `createApp(root: string): Hono`（`/health` + `/api/*` + `onError`）

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/files/files.routes.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-routes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const jsonHeaders = { "content-type": "application/json" };

describe("GET /api/list", () => {
  it("root 直下を列挙する", async () => {
    await writeFile(path.join(root, "a.txt"), "abc");
    const app = createApp(root);
    const res = await app.request("/api/list?path=");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe("a.txt");
  });

  it("存在しないディレクトリは 404 + NOT_FOUND", async () => {
    const app = createApp(root);
    const res = await app.request("/api/list?path=missing");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("パストラバーサルは 400 + PATH_TRAVERSAL", async () => {
    const app = createApp(root);
    const res = await app.request("/api/list?path=..%2F..%2Fetc");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("PATH_TRAVERSAL");
  });
});

describe("POST /api/upload", () => {
  it("新規ファイルを書き込み 201 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt", { method: "POST", body: "hello" });
    expect(res.status).toBe(201);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("hello");
  });

  it("既存ファイルは 409", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt", { method: "POST", body: "new" });
    expect(res.status).toBe(409);
  });

  it("overwrite=true で上書きできる", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt&overwrite=true", {
      method: "POST",
      body: "new",
    });
    expect(res.status).toBe(201);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("new");
  });

  it("path が無いと 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/upload", { method: "POST", body: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/download", () => {
  it("ヘッダ付きでファイル内容をストリーム返却する（日本語名は RFC 5987）", async () => {
    await writeFile(path.join(root, "レポート.txt"), "hello");
    const app = createApp(root);
    const res = await app.request(`/api/download?path=${encodeURIComponent("レポート.txt")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("レポート.txt")}`,
    );
    expect(await res.text()).toBe("hello");
  });

  it("ディレクトリ指定は 400", async () => {
    await mkdir(path.join(root, "sub"));
    const app = createApp(root);
    const res = await app.request("/api/download?path=sub");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mkdir", () => {
  it("ディレクトリを作成し 201 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(201);
  });

  it("同名ありは 409", async () => {
    await mkdir(path.join(root, "newdir"));
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(409);
  });

  it("不正な JSON ボディは 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/rename", () => {
  it("ファイルをリネームする", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const app = createApp(root);
    const res = await app.request("/api/rename", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ from: "a.txt", to: "b.txt" }),
    });
    expect(res.status).toBe(200);
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("x");
  });

  it("移動先ありは 409", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await writeFile(path.join(root, "b.txt"), "y");
    const app = createApp(root);
    const res = await app.request("/api/rename", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ from: "a.txt", to: "b.txt" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/delete", () => {
  it("ファイルを削除する", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const app = createApp(root);
    const res = await app.request("/api/delete?path=a.txt", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("存在しないパスは 404", async () => {
    const app = createApp(root);
    const res = await app.request("/api/delete?path=missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("root の削除（path 空）は 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/delete?path=", { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("200 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL（`createApp` が `../../app` に存在しない）

- [ ] **Step 3: `apps/server/src/features/files/files.schema.ts` を実装**

```ts
import type { MkdirRequest, RenameRequest } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";

export function requirePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new AppError("INVALID_REQUEST", "path is required");
  }
  return value;
}

export function optionalPath(value: string | undefined): string {
  return value ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMkdirBody(value: unknown): MkdirRequest {
  if (!isRecord(value) || typeof value.path !== "string" || value.path === "") {
    throw new AppError("INVALID_REQUEST", "body must be { path: string }");
  }
  return { path: value.path };
}

export function parseRenameBody(value: unknown): RenameRequest {
  if (
    !isRecord(value) ||
    typeof value.from !== "string" ||
    value.from === "" ||
    typeof value.to !== "string" ||
    value.to === ""
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { from: string, to: string }");
  }
  return { from: value.from, to: value.to };
}
```

- [ ] **Step 4: `apps/server/src/features/files/files.routes.ts` を実装**

```ts
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Hono } from "hono";
import type { ListResponse, OkResponse } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import {
  listDir,
  makeDir,
  removePath,
  renamePath,
  statForDownload,
  uploadFile,
} from "./files.service";
import { optionalPath, parseMkdirBody, parseRenameBody, requirePath } from "./files.schema";

function contentDisposition(filename: string): string {
  // 日本語等の非 ASCII ファイル名は RFC 5987 の filename* でエンコードする
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function readJsonBody(readJson: () => Promise<unknown>): Promise<unknown> {
  try {
    return await readJson();
  } catch {
    throw new AppError("INVALID_REQUEST", "invalid JSON body");
  }
}

export function createFilesRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/list", async (c) => {
    const rel = optionalPath(c.req.query("path"));
    const entries = await listDir(root, rel);
    const res: ListResponse = { path: rel, entries };
    return c.json(res);
  });

  app.post("/upload", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const overwrite = c.req.query("overwrite") === "true";
    const body = c.req.raw.body;
    if (!body) {
      throw new AppError("INVALID_REQUEST", "request body is required");
    }
    await uploadFile(root, rel, Readable.fromWeb(body as unknown as NodeWebReadableStream), overwrite);
    const res: OkResponse = { ok: true };
    return c.json(res, 201);
  });

  app.get("/download", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const { abs, size, name } = await statForDownload(root, rel);
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Content-Disposition", contentDisposition(name));
    return c.body(Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream);
  });

  app.post("/mkdir", async (c) => {
    const body = parseMkdirBody(await readJsonBody(() => c.req.json()));
    await makeDir(root, body.path);
    const res: OkResponse = { ok: true };
    return c.json(res, 201);
  });

  app.post("/rename", async (c) => {
    const body = parseRenameBody(await readJsonBody(() => c.req.json()));
    await renamePath(root, body.from, body.to);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.delete("/delete", async (c) => {
    const rel = requirePath(c.req.query("path"));
    await removePath(root, rel);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  return app;
}
```

- [ ] **Step 5: `apps/server/src/app.ts` を全置換**

```ts
import { Hono } from "hono";
import type { ApiError } from "@nas-fm/shared";
import { createFilesRoutes } from "./features/files/files.routes";
import { AppError, statusOf } from "./lib/errors";

export function createApp(root: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api", createFilesRoutes(root));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return c.json(body, statusOf(err.code));
    }
    console.error(err);
    const body: ApiError = { error: { code: "INTERNAL", message: "internal server error" } };
    return c.json(body, 500);
  });

  return app;
}
```

- [ ] **Step 6: `apps/server/src/server.ts` を全置換**

```ts
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { resolveNasRoot } from "./lib/config";

const root = resolveNasRoot();
const app = createApp(root);
const port = 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port} (NAS_ROOT: ${root})`);
});
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS（routes 含む全テスト）

Run: `npm run typecheck`
Expected: 3ワークスペースすべて成功

- [ ] **Step 8: コミット**

```bash
git add apps/server/src
git commit -m "feat: /api ファイル操作ルートを追加"
```

---

### Task 8: Vite proxy・全体検証・ロードマップ更新

**Files:**
- Modify: `apps/web/vite.config.ts`（`server.proxy` 追加）
- Modify: `docs/roadmap.md`（Phase 1 チェック更新）

**Interfaces:**
- Consumes: Task 7 までのすべて（稼働するサーバ）

- [ ] **Step 1: `apps/web/vite.config.ts` を全置換（proxy 追加）**

```ts
/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

※ 既存ファイルとの差分は `server.proxy` ブロックのみ。import 順が異なる場合は既存の順を維持してよい。

- [ ] **Step 2: ルートで全チェックを実行**

```bash
npm run typecheck && npm run test && npm run lint && npm run fmt:check && npm run build
```
Expected: すべて成功（web 1 テスト + server 全テスト、build で `apps/web/dist` 生成）

- [ ] **Step 3: dev サーバで手動疎通（curl 禁止のため Node fetch）**

バックグラウンドで `npm run dev:server` を起動し、ログに `Server listening on http://0.0.0.0:8080 (NAS_ROOT: ...)` が出たら:

```bash
node -e "
const base = 'http://127.0.0.1:8080/api';
const json = { 'content-type': 'application/json' };
(async () => {
  let r = await fetch(base + '/mkdir', { method: 'POST', headers: json, body: JSON.stringify({ path: 'demo' }) });
  console.log('mkdir', r.status);
  r = await fetch(base + '/upload?path=demo/hello.txt', { method: 'POST', body: 'hello nas' });
  console.log('upload', r.status);
  r = await fetch(base + '/list?path=demo');
  console.log('list', r.status, JSON.stringify(await r.json()));
  r = await fetch(base + '/download?path=' + encodeURIComponent('demo/hello.txt'));
  console.log('download', r.status, await r.text());
  r = await fetch(base + '/rename', { method: 'POST', headers: json, body: JSON.stringify({ from: 'demo/hello.txt', to: 'demo/hello2.txt' }) });
  console.log('rename', r.status);
  r = await fetch(base + '/delete?path=demo', { method: 'DELETE' });
  console.log('delete', r.status);
  r = await fetch(base + '/list?path=' + encodeURIComponent('../'));
  console.log('traversal', r.status);
})();
"
```

Expected 出力:
```
mkdir 201
upload 201
list 200 {"path":"demo","entries":[{"name":"hello.txt","size":9,"mtime":...,"type":"file"}]}
download 200 hello nas
rename 200
delete 200
traversal 400
```

確認後、バックグラウンドのサーバを必ず停止する。（`.dev-share/` は gitignore 済み・demo は API で削除済み）

- [ ] **Step 4: `docs/roadmap.md` の Phase 1 を更新**

Phase 1 セクションの全チェックボックス `- [ ]` を `- [x]` に変更する（8項目: safeResolve / NAS_ROOT / Vitest 導入 / list / upload / download / mkdir・rename・delete / shared 型）。

- [ ] **Step 5: コミット**

```bash
git add apps/web/vite.config.ts docs/roadmap.md
git commit -m "chore: Vite に /api プロキシを追加しロードマップを更新"
```

---

## Self-Review（実施済み）

**1. Spec coverage:** 設計 spec の全項目とタスクの対応 — モジュール構成（T1–T7）/ 6エンドポイント＋競合ポリシー（T4–T7）/ 生ボディストリーム＋書きかけ削除（T6）/ RFC 5987（T7）/ 統一エラー JSON＋onError（T1, T7）/ NAS_ROOT＋.dev-share＋gitignore（T3）/ Vite proxy（T8）/ 実 fs テスト・safeResolve 網羅（T2, T4–T7）。ギャップなし。

**2. Placeholder scan:** TBD/TODO/「適切に」なし。全コードステップに完全なコードを記載。

**3. Type consistency:** `AppError(code, message)` / `statusOf` / `fromFsError(err, subject)` / service 6関数のシグネチャ / `createFilesRoutes(root)` / `createApp(root)` — 全タスク間で一致を確認。shared 型名（`ApiError` / `OkResponse` / `MkdirRequest` / `RenameRequest`）も T1 定義と T7 使用で一致。
