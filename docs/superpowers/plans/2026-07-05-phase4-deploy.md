# Phase 4: 本番配信・デプロイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/web` の dist を `apps/server` から静的配信し、server を単一ファイルにバンドルして `release/` へパッケージングする一連の本番配信基盤を整え、systemd ユニットの env var 欠落を修正する。

**Architecture:** `createApp` に省略可能な `staticDir` を追加し `@hono/node-server/serve-static` を `/health`・`/api/*` 登録後にマウント(無ければスキップ、既存の `NAS_ROOT`/`AuthConfig` パターンと同型)。`apps/server` は esbuild で `dist/server.js` に単一バンドルし、ルートの `scripts/package-release.mjs` が server バンドルと web dist を `release/` にまとめる。systemd ユニットは実ファイル `deploy/nas-fm.service` として新規に用意し、`docs/spec.md` §7 の古いテンプレートとの齟齬(env var 欠落)を解消する。設計は `docs/superpowers/specs/2026-07-05-phase4-deploy-design.md`。

**Tech Stack:** Hono / `@hono/node-server`(`serve-static` サブパス)/ esbuild / Node `fs`・`path`(パッケージングスクリプト)/ systemd

## Global Constraints

- **禁止コマンド**(ユーザー設定): `curl` / `wget` / `rm -rf` / `env` / `printenv` / `git push --force`。HTTP 疎通確認は Node の `fetch`。`.env*` は読まない
- **依存追加**: `.npmrc` が `save-exact` / `min-release-age=3` を強制。新規依存はバージョン無指定で `npm install -D esbuild -w @nas-fm/server`(これ以外の新規依存は追加しない。パッケージングスクリプトは Node 標準の `fs`/`path` のみ)
- **TypeScript**: `erasableSyntaxOnly` 有効 → parameter property・enum 禁止。`verbatimModuleSyntax` 有効 → 型のみ import/export は `import type`/`export type`。`baseUrl` は使わない・`paths` の値は相対(既存 tsconfig は変更しない)
- **既存 API・テストへの後方互換**: `createApp(root, authConfig)` の呼び出し箇所(`files.routes.test.ts`・`auth.routes.test.ts`・`server.ts`)は `staticDir` を省略した2引数呼び出しのまま通ること。既存149テストは無変更で PASS すること
- **テスト**: server は実挙動を Hono `app.request()` で検証。Vitest imports は明示
- **コミット**: Conventional Commits(接頭辞英語・本文日本語)。pre-commit で lint-staged(oxfmt → oxlint --fix → typecheck)が自動実行。1タスク=1コミット。Node 24.16.0 固定
- **本番対象外**: Pi 実機での setgid/umask/Samba 相互編集検証はこのフェーズで行わない(`docs/spec.md` §3/§9 の既存手順書に委ねる)

---

## File Structure

```
apps/server/src/app.ts                  # T1: staticDir 引数追加、serveStatic マウント
apps/server/src/app.static.test.ts      # T1: 新規（static 配信専用テスト）
apps/server/src/server.ts               # T2: staticDir 算出、PORT env
apps/server/package.json                # T3: esbuild devDep、build スクリプト拡張
scripts/package-release.mjs             # T4: 新規（パッケージングスクリプト）
package.json（root）                     # T4: "package" スクリプト追加
.gitignore                              # T4: release/ を追加
deploy/nas-fm.service                   # T5: 新規（systemd ユニット）
docs/spec.md                            # T5: §7 コードブロックを deploy/nas-fm.service に合わせて更新
docs/roadmap.md                         # T6: Phase 4 の該当3項目をチェック
```

---

### Task 1: `createApp` に静的配信を追加(コア)

**Files:**
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/src/app.static.test.ts`

**Interfaces:**
- Consumes: 既存の `createFilesRoutes(root)`・`createAuthRoutes(authConfig)`・`requireAuth(authConfig)`(すべて無変更)
- Produces: `createApp(root: string, authConfig: AuthConfig, staticDir?: string): Hono` — `staticDir` 省略時は静的配信をマウントしない(既存呼び出し元は無変更で動く)

- [ ] **Step 1: 失敗するテストを書く**

`apps/server/src/app.static.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { AuthConfig } from "./lib/auth-config";
import { hashPassword } from "./lib/password";

const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };

let root: string;
let staticDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-root-"));
  staticDir = await mkdtemp(path.join(tmpdir(), "nasfm-static-"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>NAS-FileManager</title>");
  await mkdir(path.join(staticDir, "assets"));
  await writeFile(path.join(staticDir, "assets", "app.js"), "console.log('app');");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(staticDir, { recursive: true, force: true });
});

describe("静的配信（staticDir 指定時）", () => {
  it("/ で index.html を返す", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("NAS-FileManager");
  });

  it("/assets/app.js で JS ファイルを返す", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("static マウント後も /health は影響を受けない", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("static マウント後も /api/list は認証ガードのまま（Cookie 無しで 401）", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/api/list?path=");
    expect(res.status).toBe(401);
  });
});

describe("静的配信（staticDir 未指定時）", () => {
  it("/ は 404（static 未マウント、既存の開発時挙動）", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server`
Expected: FAIL(`createApp` が3引数目を受け付けない型エラー、または static 系テストが 404 になる)

- [ ] **Step 3: `apps/server/src/app.ts` を全置換**

```ts
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ApiError } from "@nas-fm/shared";
import type { AuthConfig } from "./lib/auth-config";
import { AppError, statusOf } from "./lib/errors";
import { createAuthRoutes } from "./features/auth/auth.routes";
import { requireAuth } from "./features/auth/auth.middleware";
import { createFilesRoutes } from "./features/files/files.routes";

export function createApp(root: string, authConfig: AuthConfig, staticDir?: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  // 認証ルート（login は公開）。files のガードより先に登録する。
  app.route("/api/auth", createAuthRoutes(authConfig));

  // /api/auth/* を除いた /api/* を JWT で保護する。
  // （files を /api にマウントすると /api/auth と接頭辞が重なるため、ここで明示的に除外する）
  const guard = requireAuth(authConfig);
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) {
      return next();
    }
    return guard(c, next);
  });

  app.route("/api", createFilesRoutes(root));

  // web のビルド成果物を配信する（本番のみ。staticDir が無ければ静的配信自体を行わない）。
  // /health・/api/* はここより前に登録済みのハンドラで終端するため、この後段には落ちてこない。
  if (staticDir) {
    app.use("/*", serveStatic({ root: staticDir }));
  }

  app.onError((err, c) => {
    if (err instanceof AppError && err.code !== "INTERNAL") {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return c.json(body, statusOf(err.code));
    }
    // 想定外の fs エラー（fromFsError の INTERNAL 分岐）や AppError 以外の例外はここに来る。
    // 内部詳細（パス・errno 等）をレスポンスに含めず、サーバ側ログにのみ残す。
    console.error(err);
    const body: ApiError = { error: { code: "INTERNAL", message: "internal server error" } };
    return c.json(body, 500);
  });

  return app;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server`
Expected: PASS(全テストファイル。既存の `files.routes.test.ts`・`auth.routes.test.ts` も無変更で通る)

- [ ] **Step 5: typecheck・lint を確認してコミット**

```bash
npm run typecheck -w @nas-fm/server
git add apps/server/src/app.ts apps/server/src/app.static.test.ts
git commit -m "feat: 静的ファイル配信のマウントを追加（staticDir 未指定時はスキップ）"
```
Expected: typecheck 0。

---

### Task 2: `server.ts` の staticDir 算出・PORT 化

**Files:**
- Modify: `apps/server/src/server.ts`

**Interfaces:**
- Consumes: `createApp(root, authConfig, staticDir?)`(Task 1 で追加)
- Produces: なし(entrypoint。テストの対象外)

- [ ] **Step 1: `apps/server/src/server.ts` を全置換**

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { resolveAuthConfig } from "./lib/auth-config";
import { resolveNasRoot } from "./lib/config";

const root = resolveNasRoot();
const authConfig = resolveAuthConfig();

// バンドル後（release/server.js）は隣に public/ が置かれる想定。
// 開発時（tsx で src/server.ts を直接実行）はその場所に public/ が存在しないため、
// 静的配信は自動的にスキップされる（NAS_ROOT/AuthConfig と同じ「無ければスキップ」方針）。
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const staticDir = existsSync(publicDir) ? publicDir : undefined;

const app = createApp(root, authConfig, staticDir);
const port = Number(process.env.PORT) || 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port} (NAS_ROOT: ${root})`);
});
```

- [ ] **Step 2: 検証してコミット**

```bash
npm run test -w @nas-fm/server
npm run typecheck -w @nas-fm/server
git add apps/server/src/server.ts
git commit -m "feat: server の起動時に静的配信ディレクトリと PORT を解決する"
```
Expected: 全 PASS、typecheck 0。開発時は `public/` が存在しないため static 配信はスキップされる(この時点ではまだ手動確認不要。Task 7 の実疎通で確認する)。

---

### Task 3: server の単一バンドル(esbuild)

**Files:**
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: なし
- Produces: `apps/server/dist/server.js`(`npm run build -w @nas-fm/server` 実行後に生成される単一バンドル)

- [ ] **Step 1: esbuild を追加**

```bash
npm install -D esbuild -w @nas-fm/server
```
Expected: `apps/server/package.json` の `devDependencies` に exact 固定で `esbuild` が追加される。

- [ ] **Step 2: `build` スクリプトを拡張**

`apps/server/package.json` の `scripts.build` を書き換える(他のキーは変更しない):
```json
    "build": "tsc -p tsconfig.json --noEmit && esbuild src/server.ts --bundle --platform=node --format=esm --outfile=dist/server.js",
```

- [ ] **Step 3: ビルドを実行して検証**

```bash
npm run build -w @nas-fm/server
```
Expected: エラーなく完了し `apps/server/dist/server.js` が生成される。

```bash
node -e "const fs=require('fs'); console.log(fs.existsSync('apps/server/dist/server.js') ? 'OK: bundle exists' : 'FAIL: bundle missing')"
```
Expected: `OK: bundle exists`

- [ ] **Step 4: 既存テストが壊れていないことを確認してコミット**

```bash
npm run test -w @nas-fm/server
npm run typecheck -w @nas-fm/server
git add apps/server/package.json package-lock.json
git commit -m "feat: server を esbuild で単一ファイルにバンドルする"
```
Expected: 全 PASS、typecheck 0(`apps/server/dist/` は `.gitignore` の `dist` パターンで既に無視される)。

---

### Task 4: パッケージングスクリプト(`npm run package`)

**Files:**
- Create: `scripts/package-release.mjs`
- Modify: `package.json`(root)、`.gitignore`

**Interfaces:**
- Consumes: `apps/server/dist/server.js`(Task 3)、`apps/web/dist/`(既存の Vite ビルド出力)
- Produces: `release/server.js`・`release/public/`(`npm run package` 実行後)

- [ ] **Step 1: `scripts/package-release.mjs` を作成**

```js
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(rootDir, "release");
const serverBundle = path.join(rootDir, "apps/server/dist/server.js");
const webDist = path.join(rootDir, "apps/web/dist");

for (const [label, p] of [
  ["apps/server/dist/server.js", serverBundle],
  ["apps/web/dist", webDist],
]) {
  if (!existsSync(p)) {
    console.error(`必要なビルド成果物が見つかりません: ${label}（先に npm run build を実行してください）`);
    process.exit(1);
  }
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

cpSync(serverBundle, path.join(releaseDir, "server.js"));
cpSync(webDist, path.join(releaseDir, "public"), { recursive: true });

console.log(`release/ を作成しました:\n  release/server.js\n  release/public/`);
```

- [ ] **Step 2: ルート `package.json` に `package` スクリプトを追加**

`package.json` の `scripts` に追加(`"prepare": "husky"` の前などどこでもよい):
```json
    "package": "npm run build && node scripts/package-release.mjs",
```

- [ ] **Step 3: `.gitignore` に `release/` を追加**

`.gitignore` の `dist` の行の近くに追記:
```
release
```

- [ ] **Step 4: 実行して検証**

```bash
npm run package
```
Expected: `npm run build` が全ワークスペースで成功した後、`release/server.js` と `release/public/index.html` が存在するとのログが出る。

```bash
node -e "
const fs = require('fs');
console.log(fs.existsSync('release/server.js') ? 'OK: server.js' : 'FAIL: server.js missing');
console.log(fs.existsSync('release/public/index.html') ? 'OK: public/index.html' : 'FAIL: public/index.html missing');
"
```
Expected: 両方 `OK`。

- [ ] **Step 5: コミット**

```bash
git add scripts/package-release.mjs package.json .gitignore
git commit -m "feat: server バンドルと web dist を release/ にまとめる npm run package を追加"
```

---

### Task 5: systemd ユニットと spec.md の整合

**Files:**
- Create: `deploy/nas-fm.service`
- Modify: `docs/spec.md`(§7 のコードブロックのみ)

**Interfaces:**
- Consumes: なし(ドキュメント／設定ファイルのみ)

- [ ] **Step 1: `deploy/nas-fm.service` を作成**

```ini
[Unit]
Description=Self-hosted NAS File Manager (React + Hono)
After=network.target

[Service]
User=<あなたのユーザー名>
Group=nas
UMask=0002
WorkingDirectory=/opt/nas-fm
Environment=NAS_ROOT=/srv/nas/share
Environment=PORT=8080
# 本番用の値に置き換えること。AUTH_SECRET はランダムな長い文字列。
# AUTH_PASSWORD_HASH は `npx tsx apps/server/scripts/hash-password.ts <password>` の出力を使う。
Environment=AUTH_SECRET=<ランダムな長い文字列に置き換える>
Environment=AUTH_PASSWORD_HASH=<hash-password.ts で生成した値に置き換える>
ExecStart=/usr/bin/node /opt/nas-fm/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: `docs/spec.md` §7 のコードブロックを更新**

`docs/spec.md` の以下のブロック(既存):
```ini
[Unit]
Description=Self-hosted NAS File Manager (React + Hono)
After=network.target

[Service]
User=<あなたのユーザー名>
Group=nas
UMask=0002
WorkingDirectory=/opt/nas-fm
ExecStart=/usr/bin/node /opt/nas-fm/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
を、`deploy/nas-fm.service` の内容(Step 1 と同じ)に置き換える。加えて直前の見出し行を「`/etc/systemd/system/nas-fm.service`」から以下に変更する:
```
`deploy/nas-fm.service` を `/etc/systemd/system/nas-fm.service` にコピーして使う（値は環境に合わせて書き換える）。
```

- [ ] **Step 3: コミット**

```bash
git add deploy/nas-fm.service docs/spec.md
git commit -m "docs: systemdユニットに NAS_ROOT/AUTH_SECRET/AUTH_PASSWORD_HASH の設定を追加"
```

---

### Task 6: 全体検証・実疎通・ロードマップ更新

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: ルートで全チェック**

```bash
npm run typecheck && npm run test && npm run lint && npm run fmt:check && npm run build
```
Expected: すべて成功。`fmt:check` が差分を出したら `npm run fmt` して再確認、どのファイルが整形されたか記録する。

- [ ] **Step 2: `npm run package` の実行確認**

```bash
npm run package
```
Expected: `release/server.js`・`release/public/` が生成される(Task 4 で検証済みだが、Task 1〜5 の変更をすべて含んだ状態で再確認する)。

- [ ] **Step 3: バンドル済みサーバーの実疎通(Node fetch。curl 禁止)**

`node release/server.js` をバックグラウンド起動する(Bash の `run_in_background` を使用)。起動ログに `Server listening on http://0.0.0.0:8080` と出ること、および開発用認証の WARNING が出ることを確認する。

```bash
node -e "
const base = 'http://127.0.0.1:8080';
const json = { 'content-type': 'application/json' };
(async () => {
  let r = await fetch(base + '/');
  console.log('static /', r.status, (r.headers.get('content-type') ?? ''));
  r = await fetch(base + '/health');
  console.log('health', r.status);
  r = await fetch(base + '/api/list?path=');
  console.log('no-auth list', r.status);
  r = await fetch(base + '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ password: 'admin' }) });
  console.log('login', r.status);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  r = await fetch(base + '/api/list?path=', { headers: { Cookie: cookie } });
  console.log('auth list', r.status);
})();
"
```
Expected:
```
static / 200 text/html; charset=utf-8
health 200
no-auth list 401
login 200
auth list 200
```
確認後、バックグラウンドのサーバーを必ず停止する。`release/` は `.gitignore` 済みのため後片付け不要。

- [ ] **Step 4: `docs/roadmap.md` の Phase 4 を更新**

Phase 4 セクションの4項目のうち、以下の3項目を `- [x]` にする:
```
- [x] web の `dist` を server から静的配信(本番は 1 プロセス)
- [x] server の単一 `server.js` バンドル(`tsup` / `esbuild`)
- [x] systemd ユニット(`Group=nas` / `UMask=0002` / `Environment=NAS_ROOT=/srv/nas/share`)
```
「Pi 実機で権限統一を検証」の行は `- [ ]` のまま変更しない。

- [ ] **Step 5: コミット**

```bash
git add docs/roadmap.md
git commit -m "chore: Phase 4 のローカル実装完了に合わせてロードマップを更新"
```

---

## Self-Review(実施済み)

**1. Spec coverage:** 設計 spec の各項目 → タスク対応 — `createApp` の `staticDir` 拡張・登録順による認証迂回防止(T1)/ `server.ts` の算出・PORT 化(T2)/ esbuild 単一バンドル(T3)/ `npm run package`(T4)/ systemd ユニットの env var 修正・spec.md との整合(T5)/ 自動テスト(T1)・実疎通(T6)/ Pi 実機検証は対象外のまま roadmap 未チェック維持(T6 Step4)。ギャップなし。

**2. Placeholder scan:** TBD/TODO なし。`deploy/nas-fm.service` の `<あなたのユーザー名>` 等は spec.md 由来のプレースホルダ表記(ユーザーが環境に応じて書き換える値)であり、計画自体の未確定事項ではない。全コードステップに実コードを記載。

**3. Type consistency:** `createApp(root: string, authConfig: AuthConfig, staticDir?: string): Hono` を T1 で定義し、T2(`server.ts`)がそのシグネチャ通りに呼び出す。既存呼び出し元(`files.routes.test.ts`・`auth.routes.test.ts`)は2引数のままで T1 の後方互換性(第3引数省略可)により無変更で動作する。`scripts/package-release.mjs` が参照するパス(`apps/server/dist/server.js`・`apps/web/dist`)は T3(esbuild outfile)・既存の Vite build 出力とそれぞれ一致。整合。
