# Phase 5: プレビュー機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画像・動画・テキストのインラインプレビューを実装する。サーバに Range 対応の `GET /api/preview` を追加し、web にプレビューダイアログ(画像/動画/テキスト/非対応フォールバック)を追加する。

**Architecture:** 拡張子ベースの型判定(`classifyPreview`)を `packages/shared` に置き、サーバ(inline 許可判定・Content-Type 決定)と web(表示コンポーネント振り分け)の両方で共用する。Range 解析は型を問わない汎用ロジックとして実装し、テキストの先頭256KiB制限は web 側が明示的に `Range: bytes=0-262143` を送ることで実現する(サーバに専用の切り詰めロジックは作らない)。設計は `docs/superpowers/specs/2026-07-05-phase5-preview-design.md`。

**Tech Stack:** Hono(既存の files ルートに追加)/ `mime-types`(サーバ)/ React + highlight.js(web)/ Vitest

## Global Constraints

- **禁止コマンド**(ユーザー設定): `curl` / `wget` / `rm -rf` / `env` / `printenv` / `git push --force`。HTTP 疎通確認は Node の `fetch`。`.env*` は読まない
- **依存追加**: `.npmrc` が `save-exact` / `min-release-age=3` を強制。新規依存はバージョン無指定で `npm install mime-types -w @nas-fm/server`・`npm install -D @types/mime-types -w @nas-fm/server`・`npm install highlight.js -w @nas-fm/web`
- **TypeScript**: `erasableSyntaxOnly` 有効 → parameter property・enum 禁止。`verbatimModuleSyntax` 有効 → 型のみ import/export は `import type`/`export type`。`baseUrl` は使わない・`paths` の値は相対
- **import 規約**: server 内部は相対 import、`@nas-fm/shared` は型・関数とも直接 import 可(既存の `classifyPreview` は関数なので通常の import)。web は feature 間 import を各 feature の `index.ts` 経由、UI プリミティブは `@/components/ui/*`(`dialog` は既存導入済み)
- **既存 API・テストへの後方互換**: `files.routes.test.ts` の既存テストは無変更で通ること。`FileTable.test.tsx`(3箇所)・`RowActions.test.tsx`(2箇所)は新しい `onPreview` prop 追加に伴い機械的に更新する(既存アサーションは変更しない)
- **テスト**: server は実挙動を Hono `app.request()` で検証。web は Vitest(jsdom) + Testing Library。Vitest imports は明示
- **コミット**: Conventional Commits(接頭辞英語・本文日本語)。pre-commit で lint-staged(oxfmt → oxlint --fix → typecheck)が自動実行。1タスク=1コミット。Node 24.16.0 固定
- **セキュリティ**: text 分類のファイルは常に `Content-Type: text/plain; charset=utf-8` を強制し、ファイルの本来の MIME(`.html`→`text/html` 等)は絶対に使わない。全レスポンスに `X-Content-Type-Options: nosniff` を付与

---

## File Structure

```
packages/shared/src/preview.ts            # T1: classifyPreview, PreviewKind
packages/shared/src/preview.test.ts       # T1
packages/shared/src/index.ts              # T1: 追加 export
apps/server/src/lib/range.ts              # T2: parseRange
apps/server/src/lib/range.test.ts         # T2
apps/server/src/lib/preview-mime.ts       # T3: previewContentType（mime-types 利用）
apps/server/src/lib/preview-mime.test.ts  # T3
apps/server/src/features/files/files.routes.ts       # T4: GET /preview 追加
apps/server/src/features/files/files.routes.test.ts  # T4: テスト追加（既存は無変更）
apps/web/src/lib/api.ts                   # T5: previewUrl 追加
apps/web/src/lib/api.test.ts              # T5
apps/web/src/features/file-list/dialogs/TextPreview.tsx       # T6
apps/web/src/features/file-list/dialogs/TextPreview.test.tsx  # T6
apps/web/src/features/file-list/dialogs/PreviewDialog.tsx      # T7
apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx # T7
apps/web/src/features/file-list/components/RowActions.tsx       # T8: onPreview 追加
apps/web/src/features/file-list/components/RowActions.test.tsx  # T8
apps/web/src/features/file-list/components/FileTable.tsx        # T8: onPreview 追加、file 名クリック
apps/web/src/features/file-list/components/FileTable.test.tsx   # T8
apps/web/src/features/file-list/components/FileBrowser.tsx      # T8: previewTarget state・PreviewDialog 配置
docs/roadmap.md                           # T9
```

---

### Task 1: `classifyPreview`(共有の型判定ロジック)

**Files:**
- Create: `packages/shared/src/preview.ts` + `preview.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `type PreviewKind = "image" | "video" | "text"`、`classifyPreview(filename: string): PreviewKind | null`

- [ ] **Step 1: 失敗するテストを書く**

`packages/shared/src/preview.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyPreview } from "./preview";

describe("classifyPreview", () => {
  it.each(["a.jpg", "a.JPG", "a.jpeg", "a.png", "a.webp", "a.gif"])(
    "%s は image",
    (name) => {
      expect(classifyPreview(name)).toBe("image");
    },
  );

  it.each(["a.mp4", "a.webm", "a.ogv", "a.ogg"])("%s は video", (name) => {
    expect(classifyPreview(name)).toBe("video");
  });

  it.each(["a.txt", "a.md", "a.json", "a.svg", "a.html", "a.ts", "a.py", "a.log"])(
    "%s は text",
    (name) => {
      expect(classifyPreview(name)).toBe("text");
    },
  );

  it.each(["a.zip", "a.pdf", "a.heic", "a.mkv", "README", "Makefile"])(
    "%s は非対応（null）",
    (name) => {
      expect(classifyPreview(name)).toBeNull();
    },
  );
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/shared`
Expected: FAIL(`./preview` が無い)

- [ ] **Step 3: `packages/shared/src/preview.ts` を実装**

```ts
export type PreviewKind = "image" | "video" | "text";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogv", ".ogg"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".log",
  ".csv",
  ".xml",
  ".html",
  ".htm",
  ".svg",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sh",
  ".sql",
]);

/** ファイル拡張子からプレビュー種別を判定する。拡張子が無い・未対応の場合は null。 */
export function classifyPreview(filename: string): PreviewKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}
```

- [ ] **Step 4: `packages/shared/src/index.ts` を全置換**

```ts
export type {
  ApiError,
  ApiErrorCode,
  AuthStatus,
  FileEntry,
  FileType,
  ListResponse,
  LoginRequest,
  MkdirRequest,
  OkResponse,
  RenameRequest,
} from "./types";
export { classifyPreview } from "./preview";
export type { PreviewKind } from "./preview";
```

- [ ] **Step 5: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/shared
npm run typecheck
git add packages/shared/src/preview.ts packages/shared/src/preview.test.ts packages/shared/src/index.ts
git commit -m "feat: プレビュー種別判定 classifyPreview を追加"
```
Expected: 全 PASS、typecheck 0(3ワークスペース)。

---

### Task 2: Range ヘッダ解析

**Files:**
- Create: `apps/server/src/lib/range.ts` + `range.test.ts`

**Interfaces:**
- Produces: `type RangeResult = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "invalid" }`、`parseRange(rangeHeader: string | null | undefined, size: number): RangeResult`

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/lib/range.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("Range ヘッダが無ければ full", () => {
    expect(parseRange(undefined, 1000)).toEqual({ kind: "full" });
    expect(parseRange(null, 1000)).toEqual({ kind: "full" });
  });

  it("bytes=start-end を解析する", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ kind: "partial", start: 100, end: 199 });
  });

  it("bytes=start- （終端省略）はファイル末尾までにする", () => {
    expect(parseRange("bytes=900-", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("end がサイズを超えたら末尾にクランプする", () => {
    expect(parseRange("bytes=0-99999", 1000)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("start がサイズ以上は invalid", () => {
    expect(parseRange("bytes=1000-1001", 1000)).toEqual({ kind: "invalid" });
  });

  it("start > end は invalid", () => {
    expect(parseRange("bytes=100-50", 1000)).toEqual({ kind: "invalid" });
  });

  it("複数レンジ指定は非対応として full にフォールバックする", () => {
    expect(parseRange("bytes=0-99,200-299", 1000)).toEqual({ kind: "full" });
  });

  it("不正な形式は full にフォールバックする", () => {
    expect(parseRange("potato", 1000)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-500", 1000)).toEqual({ kind: "full" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL(`./range` が無い)

- [ ] **Step 3: `apps/server/src/lib/range.ts` を実装**

```ts
export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "invalid" };

const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;

/**
 * HTTP Range ヘッダを解析する。単一の bytes=start-end / bytes=start- 形式のみ対応し、
 * 複数レンジ（カンマ区切り）や接尾辞形式（bytes=-N）など非対応の形式は "full" として
 * ファイル全体を返す挙動にフォールバックする（HTTP 仕様上、サーバが Range を無視して
 * 全体を返すことは許容されている）。
 */
export function parseRange(rangeHeader: string | null | undefined, size: number): RangeResult {
  if (!rangeHeader) return { kind: "full" };
  const match = RANGE_PATTERN.exec(rangeHeader.trim());
  if (!match) return { kind: "full" };
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (start >= size || start > end) {
    return { kind: "invalid" };
  }
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
```

- [ ] **Step 4: テストが通ることを確認してコミット**

```bash
npm run test -w @nas-fm/server
npm run typecheck -w @nas-fm/server
git add apps/server/src/lib/range.ts apps/server/src/lib/range.test.ts
git commit -m "feat: HTTP Range ヘッダの解析を追加"
```
Expected: PASS。

---

### Task 3: プレビュー用 Content-Type 判定

**Files:**
- Create: `apps/server/src/lib/preview-mime.ts` + `preview-mime.test.ts`

**Interfaces:**
- Consumes: `PreviewKind`(`@nas-fm/shared`)
- Produces: `previewContentType(kind: PreviewKind, filename: string): string`

- [ ] **Step 1: 依存を追加**

```bash
npm install mime-types -w @nas-fm/server
npm install -D @types/mime-types -w @nas-fm/server
```
Expected: `apps/server/package.json` に exact 固定で追加される。

- [ ] **Step 2: 失敗するテストを書く**

`apps/server/src/lib/preview-mime.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { previewContentType } from "./preview-mime";

describe("previewContentType", () => {
  it("image は実際の MIME を返す", () => {
    expect(previewContentType("image", "a.jpg")).toBe("image/jpeg");
    expect(previewContentType("image", "a.png")).toBe("image/png");
  });

  it("video は実際の MIME を返す", () => {
    expect(previewContentType("video", "a.mp4")).toBe("video/mp4");
    expect(previewContentType("video", "a.webm")).toBe("video/webm");
  });

  it("text は常に text/plain（本来の MIME を使わない）", () => {
    expect(previewContentType("text", "a.html")).toBe("text/plain; charset=utf-8");
    expect(previewContentType("text", "a.svg")).toBe("text/plain; charset=utf-8");
    expect(previewContentType("text", "a.json")).toBe("text/plain; charset=utf-8");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL(`./preview-mime` が無い)

- [ ] **Step 4: `apps/server/src/lib/preview-mime.ts` を実装**

```ts
import mime from "mime-types";
import type { PreviewKind } from "@nas-fm/shared";

/**
 * プレビュー配信時の Content-Type を決定する。
 * text 分類は本来の MIME（.html→text/html 等）を絶対に使わず、常に text/plain を強制する
 * （ブラウザに HTML/SVG を実行させないための XSS 対策。docs/spec.md §10.1 参照）。
 */
export function previewContentType(kind: PreviewKind, filename: string): string {
  if (kind === "text") return "text/plain; charset=utf-8";
  const type = mime.lookup(filename);
  return type || "application/octet-stream";
}
```

- [ ] **Step 5: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/server
npm run typecheck -w @nas-fm/server
git add apps/server/src/lib/preview-mime.ts apps/server/src/lib/preview-mime.test.ts apps/server/package.json package-lock.json
git commit -m "feat: プレビューの Content-Type 判定を追加（text は text/plain 強制）"
```
Expected: 全 PASS、typecheck 0。

---

### Task 4: `GET /api/preview` ルート

**Files:**
- Modify: `apps/server/src/features/files/files.routes.ts`
- Modify: `apps/server/src/features/files/files.routes.test.ts`(追加のみ。既存テストは変更しない)

**Interfaces:**
- Consumes: `classifyPreview`(`@nas-fm/shared`)、`previewContentType`(`../../lib/preview-mime`)、`parseRange`(`../../lib/range`)、既存の `statForDownload(root, relPath)`(`./files.service`。変更不要 — `{abs, size, name}` をそのまま利用できる)
- Produces: `GET /preview?path=` エンドポイント(`createFilesRoutes` に追加)

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/features/files/files.routes.test.ts` の末尾(`describe("GET /health"...)` の前)に追加:
```ts
describe("GET /api/preview", () => {
  it("画像は実際の MIME で 200 を返す", async () => {
    await writeFile(path.join(root, "a.jpg"), "fake-jpeg-bytes");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/preview?path=a.jpg", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("テキストは常に text/plain を返す（本来の MIME を使わない）", async () => {
    await writeFile(path.join(root, "a.html"), "<html>hi</html>");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/preview?path=a.html", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe("<html>hi</html>");
  });

  it("Range 指定で 206 と部分バイトを返す", async () => {
    await writeFile(path.join(root, "a.txt"), "0123456789");
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/preview?path=a.txt",
      withAuth({ headers: { Range: "bytes=2-5" } }),
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");
  });

  it("範囲外の Range は 416 を返す", async () => {
    await writeFile(path.join(root, "a.txt"), "0123456789");
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/preview?path=a.txt",
      withAuth({ headers: { Range: "bytes=100-200" } }),
    );
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */10");
  });

  it("非対応の拡張子は 400", async () => {
    await writeFile(path.join(root, "a.zip"), "zip-bytes");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/preview?path=a.zip", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("存在しないファイルは 404", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/preview?path=missing.txt", withAuth());
    expect(res.status).toBe(404);
  });

  it("Cookie 無しは 401", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/preview?path=a.txt");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL(`/api/preview` が存在せず 404 になる)

- [ ] **Step 3: `apps/server/src/features/files/files.routes.ts` を編集**

ファイル冒頭の import に追加(既存の import 群の末尾など、適切な位置に追加):
```ts
import { classifyPreview } from "@nas-fm/shared";
import { previewContentType } from "../../lib/preview-mime";
import { parseRange } from "../../lib/range";
```
※ `import type { ListResponse, OkResponse } from "@nas-fm/shared";` の行はそのまま残し、`classifyPreview` は型ではなく関数なので別行の通常 import として追加する。

`createFilesRoutes` 内、`app.get("/download", ...)` の定義の直後に追加:
```ts
  app.get("/preview", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const { abs, size, name } = await statForDownload(root, rel);
    const kind = classifyPreview(name);
    if (!kind) {
      throw new AppError("INVALID_REQUEST", "unsupported preview type");
    }
    const contentType = previewContentType(kind, name);
    const range = parseRange(c.req.header("range"), size);

    c.header("Content-Type", contentType);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    c.header("Accept-Ranges", "bytes");

    if (range.kind === "invalid") {
      c.header("Content-Range", `bytes */${size}`);
      return c.body(null, 416);
    }

    if (range.kind === "partial") {
      c.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      c.header("Content-Length", String(range.end - range.start + 1));
      return c.body(
        Readable.toWeb(
          createReadStream(abs, { start: range.start, end: range.end }),
        ) as unknown as ReadableStream,
        206,
      );
    }

    c.header("Content-Length", String(size));
    return c.body(Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream);
  });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS(新規テスト含め全テストファイル。既存の `/api/download` 等のテストも無変更で通る)

- [ ] **Step 5: typecheck を確認してコミット**

```bash
npm run typecheck -w @nas-fm/server
git add apps/server/src/features/files/files.routes.ts apps/server/src/features/files/files.routes.test.ts
git commit -m "feat: /api/preview エンドポイント（Range対応・text/plain強制）を追加"
```
Expected: typecheck 0。

---

### Task 5: web の API クライアント(`previewUrl`)

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Produces: `api.previewUrl(path: string): string`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/lib/api.test.ts` の末尾(`describe("api.downloadUrl"...)` の直後など)に追加:
```ts
describe("api.previewUrl", () => {
  it("パスをエンコードした preview URL を返す", () => {
    expect(api.previewUrl("docs/レポート.txt")).toBe(
      `/api/preview?path=${encodeURIComponent("docs/レポート.txt")}`,
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL(`api.previewUrl` が無い)

- [ ] **Step 3: `apps/web/src/lib/api.ts` に追加**

`downloadUrl` の定義の直後に追加:
```ts
  previewUrl(path: string): string {
    return `/api/preview?path=${encodeURIComponent(path)}`;
  },
```

- [ ] **Step 4: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "feat: web の API クライアントに previewUrl を追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 6: `TextPreview` コンポーネント

**Files:**
- Create: `apps/web/src/features/file-list/dialogs/TextPreview.tsx` + `TextPreview.test.tsx`

**Interfaces:**
- Produces: `TextPreview({ url }: { url: string })` — Range 付き fetch でテキストを取得し highlight.js でハイライト表示。206 応答時は切り詰めバナーを表示

- [ ] **Step 1: 依存を追加**

```bash
npm install highlight.js -w @nas-fm/web
```
Expected: `apps/web/package.json` に exact 固定で追加される。

- [ ] **Step 2: 失敗するテストを書く**

`apps/web/src/features/file-list/dialogs/TextPreview.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPreview } from "./TextPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

describe("TextPreview", () => {
  it("200 応答ではテキストを表示し切り詰めバナーを出さない", async () => {
    mockFetch(200, "const x = 1;");
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(screen.getByText(/const x/)).toBeInTheDocument());
    expect(screen.queryByText(/256KB/)).toBeNull();
  });

  it("206 応答では切り詰めバナーを表示する", async () => {
    mockFetch(206, "partial content");
    render(<TextPreview url="/api/preview?path=a.log" />);
    await waitFor(() => expect(screen.getByText(/256KB/)).toBeInTheDocument());
  });

  it("fetch が Range: bytes=0-262143 ヘッダを送る", async () => {
    const fetchMock = vi.fn(async () => new Response("x", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-262143");
  });

  it("エラー応答では失敗メッセージを表示する", async () => {
    mockFetch(500, "");
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(screen.getByText(/失敗/)).toBeInTheDocument());
  });
});
```

※ このテストの `Range: bytes=0-262143` は 256KiB(262144バイト)の**終端インデックス**(0始まり・両端含む)で、実装の `TEXT_PREVIEW_LIMIT` 定数から `` `bytes=0-${TEXT_PREVIEW_LIMIT - 1}` `` として組み立てる値と一致する。

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL(`./TextPreview` が無い)

- [ ] **Step 4: `apps/web/src/features/file-list/dialogs/TextPreview.tsx` を実装**

```tsx
import { useEffect, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

const TEXT_PREVIEW_LIMIT = 262144; // 256KiB。先頭のみ取得しブラウザに全読み込みさせないための上限

type TextPreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; text: string; truncated: boolean };

export function TextPreview({ url }: { url: string }) {
  const [state, setState] = useState<TextPreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(url, { headers: { Range: `bytes=0-${TEXT_PREVIEW_LIMIT - 1}` } })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok && res.status !== 206) {
          setState({ status: "error" });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        setState({ status: "loaded", text, truncated: res.status === 206 });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === "loading") {
    return <p className="text-muted-foreground">読み込み中…</p>;
  }
  if (state.status === "error") {
    return <p className="text-destructive">テキストの読み込みに失敗しました。</p>;
  }

  // highlight.js は入力の HTML 特殊文字を自身でエスケープしてから span でラップするため、
  // dangerouslySetInnerHTML への注入は安全（highlight.js の標準的な利用方法）。
  const highlighted = hljs.highlightAuto(state.text).value;

  return (
    <div className="max-h-[70vh] overflow-auto">
      {state.truncated && (
        <p className="mb-2 text-sm text-muted-foreground">先頭256KBのみ表示しています。</p>
      )}
      <pre className="text-sm">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
```

- [ ] **Step 5: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add apps/web/src/features/file-list/dialogs/TextPreview.tsx apps/web/src/features/file-list/dialogs/TextPreview.test.tsx apps/web/package.json package-lock.json
git commit -m "feat: テキストプレビュー（Range制限・シンタックスハイライト）を追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 7: `PreviewDialog` コンポーネント

**Files:**
- Create: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` + `PreviewDialog.test.tsx`

**Interfaces:**
- Consumes: `classifyPreview`(`@nas-fm/shared`)、`api.previewUrl`/`api.downloadUrl`(`@/lib/api`)、`TextPreview`(`./TextPreview`)
- Produces: `PreviewDialog({ open, onOpenChange, name, path }: { open: boolean; onOpenChange: (v: boolean) => void; name: string; path: string })`

- [ ] **Step 1: 失敗するテストを書く**

`apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx`:
```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "./PreviewDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreviewDialog", () => {
  it("画像は img タグで表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.jpg" path="docs/a.jpg" />);
    const img = screen.getByRole("img", { name: "a.jpg" });
    expect(img).toHaveAttribute("src", `/api/preview?path=${encodeURIComponent("docs/a.jpg")}`);
  });

  it("動画は video タグで表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.mp4" path="a.mp4" />);
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/api/preview?path=a.mp4");
  });

  it("テキストは TextPreview を表示する（fetch が呼ばれる）", async () => {
    const fetchMock = vi.fn(async () => new Response("code", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreviewDialog open onOpenChange={() => {}} name="a.ts" path="a.ts" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("非対応の拡張子はダウンロードへのフォールバックを表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.zip" path="docs/a.zip" />);
    expect(screen.getByText("プレビューできません")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.zip")}`);
  });

  it("open が false のときは中身を描画しない", () => {
    render(<PreviewDialog open={false} onOpenChange={() => {}} name="a.jpg" path="a.jpg" />);
    expect(screen.queryByRole("img", { name: "a.jpg" })).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL(`./PreviewDialog` が無い)

- [ ] **Step 3: `apps/web/src/features/file-list/dialogs/PreviewDialog.tsx` を実装**

```tsx
import { classifyPreview } from "@nas-fm/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
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
  const url = api.previewUrl(path);
  const downloadHref = api.downloadUrl(path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {open && kind === "image" && (
          <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
        )}
        {open && kind === "video" && (
          <video controls src={url} className="max-h-[70vh] w-full" />
        )}
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

- [ ] **Step 4: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add apps/web/src/features/file-list/dialogs/PreviewDialog.tsx apps/web/src/features/file-list/dialogs/PreviewDialog.test.tsx
git commit -m "feat: プレビューダイアログ（画像/動画/テキスト/非対応フォールバック）を追加"
```
Expected: 全 PASS、typecheck 0。

---

### Task 8: 起動導線(ファイル名クリック + RowActions)と `FileBrowser` 統合

**Files:**
- Modify: `apps/web/src/features/file-list/components/RowActions.tsx` + `RowActions.test.tsx`
- Modify: `apps/web/src/features/file-list/components/FileTable.tsx` + `FileTable.test.tsx`
- Modify: `apps/web/src/features/file-list/components/FileBrowser.tsx`

**Interfaces:**
- Consumes: `PreviewDialog`(`../dialogs/PreviewDialog`、同一 feature 内なので相対 import)
- Produces: `RowActions`/`FileTable` に `onPreview: (entry: FileEntry) => void` prop を追加

- [ ] **Step 1: `RowActions.test.tsx` に失敗するテストを追加**

既存の2テストの `render(<RowActions entry={...} path={...} onRename={() => {}} onDelete={() => {}} />)` の3箇所すべてに `onPreview={() => {}}` を追加する(以下は全置換後の内容):
```tsx
import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowActions } from "./RowActions";

const file: FileEntry = { name: "a.txt", size: 1, mtime: 0, type: "file" };

describe("RowActions", () => {
  it("ファイルにダウンロードリンク（正しい href）を出す", async () => {
    render(
      <RowActions
        entry={file}
        path="docs"
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    // DropdownMenuItem asChild は Radix が role="menuitem" を上書きするため、
    // アクセシブルロールは "link" ではなく "menuitem" になる（<a href> 自体は保持される）。
    const link = await screen.findByRole("menuitem", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.txt")}`);
    expect(link).toHaveAttribute("download");
  });

  it("ディレクトリにはダウンロードリンクを出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions entry={dir} path="" onPreview={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(await screen.findByRole("menuitem", { name: /名前を変更/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /ダウンロード/ })).toBeNull();
  });

  it("ファイルの操作メニューから onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    render(
      <RowActions
        entry={file}
        path="docs"
        onPreview={onPreview}
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    await userEvent.click(await screen.findByRole("menuitem", { name: /プレビュー/ }));
    expect(onPreview).toHaveBeenCalledWith(file);
  });

  it("ディレクトリの操作メニューにはプレビュー項目を出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions entry={dir} path="" onPreview={() => {}} onRename={() => {}} onDelete={() => {}} />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(screen.queryByRole("menuitem", { name: /プレビュー/ })).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL(`onPreview` prop が無く型エラー、または「プレビュー」項目が無く失敗)

- [ ] **Step 3: `RowActions.tsx` を全置換**

```tsx
import type { FileEntry } from "@nas-fm/shared";
import { Download, Eye, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

export function RowActions({
  entry,
  path,
  onPreview,
  onRename,
  onDelete,
}: {
  entry: FileEntry;
  path: string;
  onPreview: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  const rel = path ? `${path}/${entry.name}` : entry.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="操作メニュー">
          <MoreVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entry.type === "file" && (
          <DropdownMenuItem onClick={() => onPreview(entry)}>
            <Eye size={16} className="mr-2" />
            プレビュー
          </DropdownMenuItem>
        )}
        {entry.type === "file" && (
          <DropdownMenuItem asChild>
            <a href={api.downloadUrl(rel)} download>
              <Download size={16} className="mr-2" />
              ダウンロード
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onRename(entry)}>
          <Pencil size={16} className="mr-2" />
          名前を変更
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(entry)}>
          <Trash2 size={16} className="mr-2" />
          削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: `FileTable.test.tsx` に `onPreview` を追加(3箇所)し、ファイル名クリックのテストを追加**

既存の3箇所の `<FileTable ... onRename={() => {}} onDelete={() => {}} />` すべてに `onPreview={() => {}}` を追加する(全置換後):
```tsx
import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTable } from "./FileTable";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "a.txt", size: 12, mtime: 1700000000000, type: "file" },
];

describe("FileTable", () => {
  it("エントリ名を表示する", () => {
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={() => {}}
        onPreview={() => {}}
        path=""
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("ディレクトリ名クリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={onOpenDir}
        onPreview={() => {}}
        path=""
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("ファイル名クリックで onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={() => {}}
        onPreview={onPreview}
        path=""
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByText("a.txt"));
    expect(onPreview).toHaveBeenCalledWith(entries[1]);
  });

  it("名前ヘッダクリックで onSortChange('name')", async () => {
    const onSortChange = vi.fn();
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={onSortChange}
        onOpenDir={() => {}}
        onPreview={() => {}}
        path=""
        onRename={() => {}}
        onDelete={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前/ }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });
});
```

- [ ] **Step 5: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web`
Expected: FAIL(`onPreview` prop 未対応の型エラー、ファイル名クリックが `onOpenDir` を誤って呼ぶか無反応)

- [ ] **Step 6: `FileTable.tsx` を編集**

props 型に `onPreview: (entry: FileEntry) => void;` を追加(`onOpenDir` の直後):
```tsx
export function FileTable({
  entries,
  sortKey,
  sortDir,
  onSortChange,
  onOpenDir,
  onPreview,
  path,
  onRename,
  onDelete,
}: {
  entries: FileEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  path: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
```

ファイル行のファイル名表示部分を置換:
```tsx
                {entry.type === "dir" ? (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onOpenDir(entry.name)}
                  >
                    {entry.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onPreview(entry)}
                  >
                    {entry.name}
                  </button>
                )}
```

`<RowActions .../>` の呼び出しに `onPreview={onPreview}` を追加:
```tsx
              <RowActions
                entry={entry}
                path={path}
                onPreview={onPreview}
                onRename={onRename}
                onDelete={onDelete}
              />
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web`
Expected: PASS(全テストファイル)

- [ ] **Step 8: `FileBrowser.tsx` に `previewTarget` state と `PreviewDialog` を追加**

import に追加:
```tsx
import { PreviewDialog } from "../dialogs/PreviewDialog";
```

`deleteTarget` の state 宣言の直後に追加:
```tsx
  const [previewTarget, setPreviewTarget] = useState<FileEntry | null>(null);
```

`<FileTable .../>` の呼び出しに `onPreview={setPreviewTarget}` を追加:
```tsx
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          path={path}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
        />
```

`<DeleteDialog .../>` の直後、`</div>` の前に追加:
```tsx
      <PreviewDialog
        open={previewTarget !== null}
        onOpenChange={(v) => !v && setPreviewTarget(null)}
        name={previewTarget?.name ?? ""}
        path={previewTarget ? rel(previewTarget.name) : ""}
      />
```

- [ ] **Step 9: テスト・typecheck を確認してコミット**

```bash
npm run test -w @nas-fm/web
npm run typecheck -w @nas-fm/web
git add apps/web/src/features/file-list
git commit -m "feat: ファイル名クリックとRowActionsからプレビューを開けるようにする"
```
Expected: 全 PASS、typecheck 0。

---

### Task 9: 全体検証・実疎通・ロードマップ更新

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: ルートで全チェック**

```bash
npm run typecheck && npm run test && npm run lint && npm run fmt:check && npm run build
```
Expected: すべて成功。`fmt:check` が差分を出したら `npm run fmt` して再確認し、どのファイルが整形されたか記録する。

- [ ] **Step 2: dev サーバでの実疎通(Node fetch。curl 禁止)**

`npm run dev:server` をバックグラウンド起動する。起動ログを確認後、ログインしてプレビューエンドポイントを疎通確認する:
```bash
node -e "
const base = 'http://127.0.0.1:8080';
const json = { 'content-type': 'application/json' };
(async () => {
  const fs = require('fs');
  fs.writeFileSync('.dev-share-test.txt', 'hello preview');
  let r = await fetch(base + '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ password: 'admin' }) });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  r = await fetch(base + '/api/preview?path=.dev-share-test.txt', { headers: { Cookie: cookie } });
  console.log('preview 200?', r.status, await r.text());
  r = await fetch(base + '/api/preview?path=.dev-share-test.txt', { headers: { Cookie: cookie, Range: 'bytes=0-4' } });
  console.log('preview range 206?', r.status, r.headers.get('content-range'), await r.text());
})();
"
```
Expected:
```
preview 200? 200 hello preview
preview range 206? 206 bytes 0-4/13 hello
```
確認後、バックグラウンドのサーバーを停止し、`apps/server/.dev-share/.dev-share-test.txt`(作成された場合)を後片付けする。

- [ ] **Step 3: `docs/roadmap.md` の Phase 5 を更新**

Phase 5 セクションの4項目すべてを `- [x]` にする(4項目目「割り切り」は T1 で HEIC 拡張子を `IMAGE_EXTENSIONS` に含めず、動画トランスコード処理を一切実装しないことで、実装済みの制約として満たされている):
```
- [x] inline 配信エンドポイント(MIME 判定 `mime-types`・`X-Content-Type-Options: nosniff`・**Range 対応 206**)
- [x] プレビュー UI(`Dialog`、画像 / 動画 / テキスト振り分け、非対応時は DL フォールバック必須)
- [x] テキストはサイズ制限(先頭 N KB)+ シンタックスハイライト
- [x] 割り切り: HEIC は DL のみ、Pi での動画トランスコードはしない
```

- [ ] **Step 4: コミット**

```bash
git add docs/roadmap.md
git commit -m "chore: Phase 5 プレビュー機能の完了に合わせてロードマップを更新"
```

---

## Self-Review(実施済み)

**1. Spec coverage:** 設計 spec の各項目 → タスク対応 — `classifyPreview` 共有ロジック(T1)/ Range 解析(T2)/ Content-Type 判定・text/plain 強制(T3)/ `/api/preview` エンドポイント本体(T4)/ web API クライアント(T5)/ テキストプレビュー・Range 再利用による切り詰め(T6)/ プレビューダイアログ・非対応フォールバック(T7)/ 起動導線(ファイル名クリック+ドロップダウン)・FileBrowser 統合(T8)/ 検証・roadmap(T9)。ギャップなし。

**2. Placeholder scan:** TBD/TODO なし。全コードステップに実コードを記載。T9 Step3 の roadmap 更新は既存ファイルの現在の記載形式を確認した上で編集する旨を明記(プレースホルダではなく手順の注記)。

**3. Type consistency:** `classifyPreview(filename): PreviewKind | null` / `parseRange(rangeHeader, size): RangeResult` / `previewContentType(kind, filename): string` を T1-T3 で定義し、T4 の route 実装がそのシグネチャ通りに使用。`RowActions`/`FileTable` の `onPreview: (entry: FileEntry) => void` を T8 で一貫して使用(ファイル名クリックとドロップダウン項目の両方から同じ prop を呼ぶ設計)。`PreviewDialog` の props(`open`/`onOpenChange`/`name`/`path`)は既存の `RenameDialog`(`currentName` 等)と同じ「呼び出し側が unwrap 済みの値を渡す」パターンに揃えており、`FileBrowser.tsx` の統合(T8 Step8)と整合。
