# NAS-FileManager モノレポ再構成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現在の中途半端なリポジトリを `CLAUDE.local.md` 6章に沿った npm workspaces モノレポへ再構成し、各ワークスペースがビルド/起動でき `@nas-fm/shared` を相互 import できる最小の動く土台を作る。

**Architecture:** `apps/web`(@nas-fm/web, React+Vite)・`apps/server`(@nas-fm/server, Hono)・`packages/shared`(@nas-fm/shared, 型のみ) の3ワークスペース。`shared` は TS ソースを `exports` で公開し、Web は Vite が、Server は tsx が直接取り込む（ビルド不要）。型解決は各ワークスペース tsconfig の `paths` で行う。

**Tech Stack:** npm workspaces / TypeScript 6.0.3 / React 19.2.7 / Vite 8.1.0 / Vitest / Hono + @hono/node-server / tsx / oxlint / oxfmt / husky + lint-staged

## Global Constraints

- **コミット禁止:** このタスク中は `git commit` を一切行わない。各タスクは検証チェックポイントで終える。`git mv`（ワークツリー変更）は可。
- **機密ファイル:** `.env*` の読み取り・出力禁止。`printenv`/`env`/`curl`/`wget`/`rm -rf`/`git push --force` は使用禁止。HTTP 疎通確認は `curl` ではなく Node の `fetch` を使う。
- **依存バージョン:** `.npmrc` に `save-exact=true`・`min-release-age=3`・`engine-strict=true`。新規依存は `npm install <pkg>`（バージョン無指定）で入れ、exact 固定かつ3日以上経過版を npm に選ばせる。既知バージョンの依存は package.json に exact 直書き。
- **Node:** `.node-version`/`.nvmrc` = `24.16.0`。ルート package.json の `engines.node` も `24.16.0`。
- **命名:** ルート=`nas-fm`(private)、`@nas-fm/web`(`apps/web`)、`@nas-fm/server`(`apps/server`)、`@nas-fm/shared`(`packages/shared`)。
- **スコープ:** 骨組み＋最小の動く土台のみ。`/api/list` 等の機能実装・認証・shadcn/ui・プレビュー・本番バンドル(tsup等)・Tailscale は対象外。
- **TypeScript 方針:** project references の composite / `tsc -b` は使わない（cross-package の複雑さ回避）。型検査は各ワークスペースの `tsc -p ... --noEmit` を `npm run typecheck --workspaces --if-present` で束ねる。

---

## File Structure

**新規作成（ルート）**
- `package.json` — workspaces 定義・集約スクリプト・ツールを hoist
- `tsconfig.base.json` — 共通 compilerOptions
- `tsconfig.json` — 置き換え: 3ワークスペースを references する solution（エディタ用）
- `lint-staged.config.ts` — glob を `{apps,packages}/**` に更新

**移設（`git mv` / relocate）**
- `app/frontend/*` → `apps/web/*`、`app/backend/*` → `apps/server/*`、`app/` 削除
- ルート `vite.config.ts` → `apps/web/vite.config.ts`
- ルート `tsconfig.app.json` → `apps/web/tsconfig.app.json`
- ルート `tsconfig.node.json` → `apps/web/tsconfig.node.json`
- ルート `public/` → `apps/web/public/`

**新規作成（ワークスペース）**
- `packages/shared/package.json`, `packages/shared/src/types.ts`, `packages/shared/src/index.ts`, `packages/shared/tsconfig.json`
- `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/app.ts`, `apps/server/src/server.ts`
- `apps/web/package.json`(改稿), `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`
- 空 feature ディレクトリの `.gitkeep`（web: `src/features/{file-list,upload,auth}`, `src/components/ui`, `src/lib`; server: `src/features/{files,auth}`, `src/lib`）

**据え置き**
- `.npmrc` `.nvmrc` `.node-version` `.editorconfig` `.gitignore` `.oxlintrc.json` `.oxfmtrc.json` `.husky/` `README.md`

---

### Task 1: ディレクトリ移設とルート workspace の立ち上げ（`npm install` が通る状態）

ディレクトリを `apps/*` へ移し、ルートの workspace 配線・共通 tsconfig・各 package.json の骨格を作り、`npm install` で3ワークスペースがリンクされることを確認する。

**Files:**
- Move: `app/frontend` → `apps/web`, `app/backend` → `apps/server`
- Move: `vite.config.ts`,`tsconfig.app.json`,`tsconfig.node.json`,`public/` → `apps/web/`
- Create: `package.json`(root), `tsconfig.base.json`, `apps/server/package.json`, `packages/shared/package.json`
- Modify: `tsconfig.json`(root), `apps/web/package.json`, `lint-staged.config.ts`

**Interfaces:**
- Produces: workspace 名 `@nas-fm/web` / `@nas-fm/server` / `@nas-fm/shared`。ルートスクリプト `dev:web`/`dev:server`/`dev`/`build`/`typecheck`/`lint`/`lint:fix`/`fmt`/`fmt:check`。共通 tsconfig `tsconfig.base.json`。

- [ ] **Step 1: ディレクトリと web 用ファイルを移設**

```bash
git mv app/frontend apps/web
git mv app/backend apps/server
rmdir app
git mv vite.config.ts apps/web/vite.config.ts
git mv tsconfig.app.json apps/web/tsconfig.app.json
git mv tsconfig.node.json apps/web/tsconfig.node.json
git mv public apps/web/public
```

- [ ] **Step 2: ルート `package.json` を作成**

`package.json`:
```json
{
  "name": "nas-fm",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": "24.16.0"
  },
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "concurrently -k -n web,server -c blue,green \"npm:dev:web\" \"npm:dev:server\"",
    "dev:web": "npm run dev -w @nas-fm/web",
    "dev:server": "npm run dev -w @nas-fm/server",
    "build": "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "9.1.7",
    "lint-staged": "17.0.8",
    "oxfmt": "0.56.0",
    "oxlint": "1.71.0",
    "typescript": "6.0.3"
  }
}
```

- [ ] **Step 3: `tsconfig.base.json`（新規）を作成**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "es2023",
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 4: ルート `tsconfig.json` を solution に置き換え**

`tsconfig.json`（既存の内容を全置換）:
```json
{
  "files": [],
  "references": [
    { "path": "./apps/web" },
    { "path": "./apps/server" },
    { "path": "./packages/shared" }
  ]
}
```

- [ ] **Step 5: `apps/web/package.json` を改稿**

`apps/web/package.json`（全置換。ツール系 devDep とスクリプトはルートへ移動済み）:
```json
{
  "name": "@nas-fm/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@nas-fm/shared": "*",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "devDependencies": {
    "@types/node": "26.0.1",
    "@types/react": "19.2.17",
    "@vitejs/plugin-react": "6.0.3",
    "vite": "8.1.0"
  }
}
```

- [ ] **Step 6: `apps/server/package.json`（新規）を作成**

`apps/server/package.json`（依存は Task 3 で追加するため一旦スクリプトのみ）:
```json
{
  "name": "@nas-fm/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc -p tsconfig.json --noEmit",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@nas-fm/shared": "*"
  }
}
```

- [ ] **Step 7: `packages/shared/package.json`（新規）を作成**

`packages/shared/package.json`:
```json
{
  "name": "@nas-fm/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit"
  }
}
```

- [ ] **Step 8: `lint-staged.config.ts` の glob を更新**

`lint-staged.config.ts`（全置換）:
```ts
/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "{apps,packages}/**/src/**/*.{js,ts,jsx,tsx}": ["oxfmt", "oxlint --fix"],
  "{apps,packages}/**/src/**/*.{ts,tsx}": () => "npm run typecheck --workspaces --if-present",
};
```

- [ ] **Step 9: `packages/shared/.gitkeep` を削除（src で置き換わるため）**

```bash
git rm --cached packages/shared/.gitkeep 2>/dev/null || true
rm -f packages/shared/.gitkeep apps/web/src/.gitkeep apps/server/src/.gitkeep
```

- [ ] **Step 10: 依存インストールと concurrently 追加**

```bash
npm install
npm install -D concurrently
```
Expected: エラーなく完了し、`node_modules/@nas-fm/web`・`@nas-fm/server`・`@nas-fm/shared` がワークスペースへの symlink になる。

- [ ] **Step 11: 検証 — ワークスペースがリンクされている**

```bash
npm ls -ws --depth=0
node -e "console.log(require('fs').lstatSync('node_modules/@nas-fm/shared').isSymbolicLink())"
```
Expected: 3ワークスペースが列挙され、2つ目のコマンドが `true` を出力する。

---

### Task 2: `@nas-fm/shared` の最小型

共有型（`FileEntry`/`FileType`/`ListResponse`）を定義し、単体で型検査が通ることを確認する。

**Files:**
- Create: `packages/shared/src/types.ts`, `packages/shared/src/index.ts`, `packages/shared/tsconfig.json`

**Interfaces:**
- Produces:
  - `type FileType = "file" | "dir"`
  - `interface FileEntry { name: string; size: number; mtime: number; type: FileType }`
  - `interface ListResponse { path: string; entries: FileEntry[] }`
  - すべて `@nas-fm/shared` から型として再エクスポート。

- [ ] **Step 1: `packages/shared/src/types.ts` を作成**

```ts
export type FileType = "file" | "dir";

export interface FileEntry {
  name: string;
  size: number;
  /** 最終更新時刻（epoch ミリ秒） */
  mtime: number;
  type: FileType;
}

export interface ListResponse {
  path: string;
  entries: FileEntry[];
}
```

- [ ] **Step 2: `packages/shared/src/index.ts`（バレル）を作成**

```ts
export type { FileEntry, FileType, ListResponse } from "./types";
```

- [ ] **Step 3: `packages/shared/tsconfig.json` を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 検証 — shared の型検査が通る**

Run: `npm run typecheck -w @nas-fm/shared`
Expected: エラー0で終了（終了コード0）。

---

### Task 3: `@nas-fm/server` の最小 Hono アプリ（/health）

Hono の `/health` エンドポイントと `0.0.0.0:8080` の listen を実装し、`@nas-fm/shared` の型を import して疎通・起動確認する。

**Files:**
- Create: `apps/server/src/app.ts`, `apps/server/src/server.ts`, `apps/server/tsconfig.json`
- Create: `apps/server/src/features/files/.gitkeep`, `apps/server/src/features/auth/.gitkeep`, `apps/server/src/lib/.gitkeep`
- Modify: `apps/server/package.json`（依存追加）

**Interfaces:**
- Consumes: `@nas-fm/shared` の `FileEntry`（型）。
- Produces: `export const app`（Hono インスタンス、`GET /health`）。`server.ts` は entrypoint。

- [ ] **Step 1: server の依存を追加**

```bash
npm install hono @hono/node-server -w @nas-fm/server
npm install -D tsx @types/node -w @nas-fm/server
```
Expected: `apps/server/package.json` に exact 固定で追加される。

- [ ] **Step 2: `apps/server/tsconfig.json` を作成**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"],
      "@nas-fm/shared": ["../../packages/shared/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `apps/server/src/app.ts` を作成**

```ts
import { Hono } from "hono";
import type { FileEntry } from "@nas-fm/shared";

export const app = new Hono();

app.get("/health", (c) => {
  // @nas-fm/shared の型解決をワークスペース越しに検証するための参照。
  const sampleType: FileEntry["type"] = "dir";
  return c.json({ status: "ok", sampleType });
});
```

- [ ] **Step 4: `apps/server/src/server.ts` を作成**

```ts
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port}`);
});
```

- [ ] **Step 5: 空 feature ディレクトリの `.gitkeep` を作成**

```bash
mkdir -p apps/server/src/features/files apps/server/src/features/auth apps/server/src/lib
touch apps/server/src/features/files/.gitkeep apps/server/src/features/auth/.gitkeep apps/server/src/lib/.gitkeep
```

- [ ] **Step 6: 検証 — 型検査**

Run: `npm run typecheck -w @nas-fm/server`
Expected: エラー0で終了。

- [ ] **Step 7: 検証 — 起動して /health に応答**

サーバをバックグラウンド起動する（Bash の run_in_background を使用）:
Run: `npm run dev:server`
ログに `Server listening on http://0.0.0.0:8080` が出たら、別コマンドで疎通確認（`curl` は使わず Node fetch）:
```bash
node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.text().then(t=>console.log(r.status,t)))"
```
Expected: `200 {"status":"ok","sampleType":"dir"}` が出力される。確認後、バックグラウンドのサーバを停止する。

---

### Task 4: `@nas-fm/web` の最小 React アプリ ＋ Vitest

最小レンダリング・`@` エイリアス・`@nas-fm/shared` 型 import・Vitest スモークテストを整え、型検査/テスト/ビルドが通ることを確認する。

**Files:**
- Create: `apps/web/tsconfig.json`(web solution — Task 1 のルート `tsconfig.json` が参照する `./apps/web` を解決するため), `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`
- Create: `apps/web/src/features/{file-list,upload,auth}/.gitkeep`, `apps/web/src/components/ui/.gitkeep`, `apps/web/src/lib/.gitkeep`
- Modify: `apps/web/vite.config.ts`, `apps/web/tsconfig.app.json`, `apps/web/tsconfig.node.json`, `apps/web/package.json`(devDep 追加)

**Interfaces:**
- Consumes: `@nas-fm/shared` の `FileEntry`（型）。
- Produces: `export function App()`。エイリアス `@/*` → `apps/web/src/*`。

- [ ] **Step 1: web にテスト用 devDep を追加**

```bash
npm install -D vitest jsdom @testing-library/react @types/react-dom -w @nas-fm/web
```

- [ ] **Step 2: `apps/web/vite.config.ts` を改稿（エイリアス＋Vitest）**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
```

- [ ] **Step 3: `apps/web/tsconfig.app.json` を改稿（base を extends＋paths）**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["vite/client", "vitest/globals"],
    "jsx": "react-jsx",
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"],
      "@nas-fm/shared": ["../../packages/shared/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: `apps/web/tsconfig.node.json` を改稿（base を extends）**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "lib": ["ES2023"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4b: `apps/web/tsconfig.json`（web solution）を作成**

Task 1 で作ったルート `tsconfig.json` は `./apps/web` を references しているため、`apps/web/tsconfig.json` を用意して参照を解決させる（エディタ用途。CLI は `tsc -p tsconfig.app.json`/`tsconfig.node.json` を直接呼ぶため `tsc -b` は使わない）。

`apps/web/tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 5: `apps/web/index.html` を作成**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NAS-FileManager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `apps/web/src/app/App.tsx` を作成**

```tsx
import type { FileEntry } from "@nas-fm/shared";

const sample: FileEntry = {
  name: "example.txt",
  size: 0,
  mtime: 0,
  type: "file",
};

export function App() {
  return (
    <main>
      <h1>NAS-FileManager</h1>
      <p>{sample.name}</p>
    </main>
  );
}
```

- [ ] **Step 7: `apps/web/src/main.tsx` を作成（`@` エイリアス経由 import）**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: スモークテスト `apps/web/src/app/App.test.tsx` を作成（失敗する状態を先に）**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "@/app/App";

test("renders app heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeDefined();
});
```

- [ ] **Step 9: テストを実行して緑になることを確認**

Run: `npm run test -w @nas-fm/web`
Expected: 1 passed（App が既に Step 6 で存在するため成功）。もし赤なら App.tsx の見出し文言を確認。

- [ ] **Step 10: 空 feature ディレクトリの `.gitkeep` を作成**

```bash
mkdir -p apps/web/src/features/file-list apps/web/src/features/upload apps/web/src/features/auth apps/web/src/components/ui apps/web/src/lib
touch apps/web/src/features/file-list/.gitkeep apps/web/src/features/upload/.gitkeep apps/web/src/features/auth/.gitkeep apps/web/src/components/ui/.gitkeep apps/web/src/lib/.gitkeep
```

- [ ] **Step 11: 検証 — 型検査とビルド**

Run: `npm run typecheck -w @nas-fm/web`
Expected: エラー0。

Run: `npm run build -w @nas-fm/web`
Expected: 成功し `apps/web/dist/index.html` と `apps/web/dist/assets/` が生成される。

---

### Task 5: モノレポ全体の検証と最終確認

ルートの集約スクリプトが一通り通り、旧構成の残骸が無いことを確認する。

**Files:**
- 変更なし（検証のみ）

- [ ] **Step 1: ルート一括ビルド**

Run: `npm run build`
Expected: `@nas-fm/web` が dist を生成、`@nas-fm/server` の型検査が通過（`@nas-fm/shared` は build スクリプト無しでスキップ）。全体が終了コード0。

- [ ] **Step 2: ルート一括 型検査**

Run: `npm run typecheck`
Expected: 3ワークスペースすべて型検査成功。

- [ ] **Step 3: Lint / Format チェック**

Run: `npm run lint`
Expected: エラー0。

Run: `npm run fmt:check`
Expected: すべてフォーマット済み（差分なし）。差分があれば `npm run fmt` で整形し再確認。

- [ ] **Step 4: 旧構成の残骸が無いことを確認**

```bash
test ! -d app && echo "app/ removed OK"
ls apps packages
git status
```
Expected: `app/ removed OK` が出力され、`apps/{web,server}`・`packages/shared` が存在。ルート直下に `vite.config.ts`/`tsconfig.app.json`/`tsconfig.node.json`/`public/` が残っていない。

- [ ] **Step 5: dev サーバ疎通の最終確認**

`npm run dev:server` をバックグラウンド起動し、ログに listen が出たら:
```bash
node -e "fetch('http://127.0.0.1:8080/health').then(r=>r.text().then(t=>console.log(r.status,t)))"
```
Expected: `200 {"status":"ok","sampleType":"dir"}`。確認後にサーバ停止。

- [ ] **Step 6: 完了報告（コミットはしない）**

作業ツリーに変更が残った状態で完了。`git status` の内容をユーザーに提示し、コミット要否の判断を仰ぐ（このタスク中は自動コミットしない）。

---

## Self-Review

**1. Spec coverage（設計 spec 各節→タスク対応）**
- 命名（web/server/shared, @nas-fm/*）→ Task 1
- shared のソース参照（exports→src, paths）→ Task 1(paths), Task 2(exports), Task 3/4(consumers)
- 目標ツリー／ファイル移設 → Task 1
- 最小実装（shared 型 / server /health / web 最小レンダリング）→ Task 2/3/4
- ルート集約（workspaces・scripts・ツール hoist・tsconfig.base）→ Task 1
- 空 feature ディレクトリ(.gitkeep) → Task 3/4
- lint-staged glob 更新 → Task 1
- 受け入れ基準6項目の検証 → Task 5（＋各タスクの検証ステップ）
- 対象外（機能実装/認証/shadcn/本番バンドル/Tailscale）→ 未着手で正しい
  ギャップなし。

**2. Placeholder scan:** TBD/TODO・「適切に」等の曖昧語なし。全コードステップに実コードを記載。OK。

**3. Type consistency:** `FileEntry`(name/size/mtime/type)・`FileType`("file"|"dir")・`ListResponse`(path/entries) は Task 2 で定義し、Task 3(`FileEntry["type"]`)・Task 4(`FileEntry` リテラル `type:"file"`) と整合。`app`(Hono)・`App`(React) の名前も server/web で一貫。OK。

**注記（spec からの意図的な調整）:** spec 6.3 の「ルート `tsc -b`」は cross-package の composite が必要で壊れやすいため、`npm run typecheck --workspaces --if-present` に置換。ルート `tsconfig.json` は references を持つ solution としてエディタ用に残す（CLI では `tsc -b` を呼ばない）。
