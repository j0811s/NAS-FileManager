# PWA インストール可能化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ホーム画面に追加してアプリらしく開けるよう、`apps/web` に PWA の manifest とアイコン一式、関連する `<head>` タグを追加する。

**Architecture:** Service Worker は追加しない（このアプリは LAN 内 `http://` 限定でセキュアコンテキストが無く、Service Worker は登録できないため）。`apps/web/public/manifest.webmanifest` と `apps/web/public/icons/*.png` を静的アセットとして追加し、`apps/web/index.html` にそれらを参照する `<head>` タグを追加するだけ。既存の静的配信（Vite dev / Hono `serveStatic`）にそのまま乗る。

**Tech Stack:** 既存の `sharp`（`@nas-fm/server` の依存。npm workspaces でルート `node_modules` に hoist 済み）を、アイコン生成用の一回限りの Node スクリプトから利用する。`apps/web` に新規 npm 依存は追加しない。

設計の詳細・背景は `docs/superpowers/specs/2026-08-09-pwa-installability-design.md` を参照。

## Global Constraints

- コミットメッセージ: Conventional Commits。接頭辞は英語（`feat`）、本文は日本語（CLAUDE.md）
- 新規 npm 依存を追加しない（設計で決定済み）
- Node は `>=24.18.0` 前提（既存環境で満たされている）
- `apps/web/src/**` 以外のファイル（`public/`, `index.html`, `scripts/`）を触るため `.claude/rules/features.md` の feature 間 import 境界は本タスクでは対象外
- pre-commit で oxfmt → oxlint --fix → typecheck が自動実行される（husky + lint-staged）。新規 `.mjs` スクリプトは `apps/web/tsconfig.app.json`（`include: ["src"]`）にも `tsconfig.node.json`（`include: ["vite.config.ts"]`）にも含まれないため typecheck 対象外（確認済み）

---

## File Structure

- Create: `apps/web/scripts/generate-pwa-icons.mjs` — アイコン SVG（インライン文字列）を `sharp` で PNG 化する一回限りのスクリプト。デザインを変える際はこのファイルの SVG 文字列を編集して再実行する
- Create: `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` — 上記スクリプトの生成物
- Create: `apps/web/public/manifest.webmanifest` — Web App Manifest
- Modify: `apps/web/index.html` — `<link rel="manifest">` 等の `<head>` タグ追加

---

### Task 1: PWA アイコンを生成する

**Files:**
- Create: `apps/web/scripts/generate-pwa-icons.mjs`
- Create: `apps/web/public/icons/icon-192.png`
- Create: `apps/web/public/icons/icon-512.png`
- Create: `apps/web/public/icons/icon-maskable-512.png`
- Create: `apps/web/public/icons/apple-touch-icon.png`

**Interfaces:**
- Produces: `apps/web/public/icons/icon-192.png`（192x192）、`icon-512.png`（512x512、`purpose: any` としても使う）、`icon-maskable-512.png`（512x512、`purpose: maskable`。グリフは中心から半径 204.8px の safe zone 内に収まっている）、`apple-touch-icon.png`（180x180、不透明・アルファチャンネル無し）。Task 2 の manifest がこれらのファイル名をそのまま参照する

- [ ] **Step 1: スクリプトを作成する**

`apps/web/scripts/generate-pwa-icons.mjs` を作成する:

```js
// PWA 用アイコンを SVG から生成する。
// sharp は @nas-fm/server の依存（npm workspaces でルート node_modules に hoist 済み）を利用するため、
// このモノレポの外では単体で動かない。
// 実行: node apps/web/scripts/generate-pwa-icons.mjs
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const BG = "#18181b";
const FG = "#fafafa";

// 512x512 の NAS/ドライブをモチーフにした単色グリフ。
// 本体(272x152)は中心(256,256)基準で対称配置のため、そのままで maskable safe zone
// （中心から半径 204.8px の円）に収まる。専用の maskable 版 SVG は不要。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <rect x="120" y="180" width="272" height="152" rx="24" fill="${FG}"/>
  <rect x="152" y="268" width="208" height="16" rx="8" fill="${BG}"/>
  <circle cx="352" cy="300" r="12" fill="${BG}"/>
</svg>`;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../public/icons");
await mkdir(outDir, { recursive: true });

const svgBuffer = Buffer.from(svg);

await sharp(svgBuffer).resize(192, 192).png().toFile(path.join(outDir, "icon-192.png"));
await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(outDir, "icon-512.png"));
await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(outDir, "icon-maskable-512.png"));
await sharp(svgBuffer)
  .resize(180, 180)
  .flatten({ background: BG })
  .png()
  .toFile(path.join(outDir, "apple-touch-icon.png"));

console.log(`icons written to ${outDir}`);
```

- [ ] **Step 2: スクリプトを実行する**

Run: `node apps/web/scripts/generate-pwa-icons.mjs`
Expected: `icons written to .../apps/web/public/icons` と出力され、`apps/web/public/icons/` に 4 つの PNG が作られる

- [ ] **Step 3: 生成結果を検証する**

Run:
```bash
node -e '
import("sharp").then(async ({ default: sharp }) => {
  const files = ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
  for (const f of files) {
    const meta = await sharp(`apps/web/public/icons/${f}`).metadata();
    console.log(f, meta.width, meta.height, meta.format, "hasAlpha:", meta.hasAlpha);
  }
});
'
```

Expected:
```
icon-192.png 192 192 png hasAlpha: true
icon-512.png 512 512 png hasAlpha: true
icon-maskable-512.png 512 512 png hasAlpha: true
apple-touch-icon.png 180 180 png hasAlpha: false
```

`apple-touch-icon.png` の `hasAlpha` が `false`（＝完全に不透明）であることが特に重要（iOS 側でマスクをかけるため、透過があると背景が黒くなる）。

- [ ] **Step 4: commit**

```bash
git add apps/web/scripts/generate-pwa-icons.mjs apps/web/public/icons
git commit -m "$(cat <<'EOF'
feat: PWA用アイコンを追加する
EOF
)"
```

---

### Task 2: manifest.webmanifest を追加する

**Files:**
- Create: `apps/web/public/manifest.webmanifest`

**Interfaces:**
- Consumes: Task 1 が生成した `apps/web/public/icons/icon-192.png` / `icon-512.png` / `icon-maskable-512.png`
- Produces: `/manifest.webmanifest`（Vite dev では `apps/web/public/` がそのままルートに配信される。本番は Hono の `serveStatic` 経由。Task 3 の `index.html` がこのパスを `<link rel="manifest">` で参照する）

- [ ] **Step 1: manifest ファイルを作成する**

`apps/web/public/manifest.webmanifest` を作成する:

```json
{
  "name": "NAS-FileManager",
  "short_name": "NAS-FM",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

`background_color` / `theme_color` は `apps/web/src/index.css` の `--background: oklch(1 0 0)`（= `#ffffff`）に合わせている。`start_url` / `scope` は相対パス（LAN IP や将来の Tailscale ホスト名が変わっても機能するため。設計docの注意点）。

- [ ] **Step 2: JSON の妥当性を確認する**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/public/manifest.webmanifest', 'utf8')); console.log('valid json')"`
Expected: `valid json`

- [ ] **Step 3: commit**

```bash
git add apps/web/public/manifest.webmanifest
git commit -m "$(cat <<'EOF'
feat: PWA manifestを追加する
EOF
)"
```

---

### Task 3: index.html に PWA 用タグを追加する

**Files:**
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: Task 2 の `/manifest.webmanifest`、Task 1 の `/icons/apple-touch-icon.png`

- [ ] **Step 1: index.html を編集する**

`apps/web/index.html` の現在の内容:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NAS-FileManager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

これを次の内容に置き換える:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="NAS-FM" />
    <title>NAS-FileManager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`theme-color` はダーク版を出し分けない（`next-themes` の `ThemeProvider` が未配線で `.dark` クラスが付与されることが無く、アプリは常にライト表示のため。`apps/web/src/app/providers.tsx` を確認済み）。

- [ ] **Step 2: dev サーバで配信されることを確認する**

Run:
```bash
npm run dev:web -w @nas-fm/web &
DEV_PID=$!
sleep 2
curl -s http://localhost:5173/ | grep -o 'manifest.webmanifest\|apple-touch-icon.png'
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/manifest.webmanifest
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/icons/apple-touch-icon.png
kill "$DEV_PID"
```

（非対話シェルでは `%1` のジョブ制御が使えないことがあるため `$!` で PID を直接拾う）

Expected: `manifest.webmanifest` と `apple-touch-icon.png` が index.html の grep 結果に出力され、両 curl とも `200` が返る

- [ ] **Step 3: commit**

```bash
git add apps/web/index.html
git commit -m "$(cat <<'EOF'
feat: index.htmlにPWA用metaタグを追加する
EOF
)"
```

---

### Task 4: 本番ビルドでの配信を検証する（コード変更なし）

**Files:**
- （変更なし。`npm run package` の成果物 `release/` は `.gitignore` 済み）

**Interfaces:**
- Consumes: Task 1〜3 の全成果物

- [ ] **Step 1: ビルド・パッケージングを実行する**

Run: `npm run package`
Expected: `release/server.js`, `release/public/`, `release/node_modules/` が作られ、エラーなく完了する

- [ ] **Step 2: release/public にアセットが含まれることを確認する**

Run: `ls release/public/manifest.webmanifest release/public/icons/`
Expected: `manifest.webmanifest` と 4 つの PNG が一覧に出る（`apps/web/dist` を丸ごと `release/public/` にコピーする既存の仕組み `scripts/package-release.mjs` に乗っているだけなので、追加対応なしでここに含まれるはず）

- [ ] **Step 3: 実サーバでの Content-Type を確認する**

Run:
```bash
PORT=8099 node release/server.js &
SERVER_PID=$!
sleep 1
curl -sI http://localhost:8099/manifest.webmanifest | grep -i content-type
curl -sI http://localhost:8099/icons/icon-512.png | grep -i content-type
kill "$SERVER_PID"
```

Expected: 1行目が `content-type: application/manifest+json`、2行目が `content-type: image/png`（Hono の mime テーブルに `webmanifest: "application/manifest+json"` が登録済みであることをソースで確認済み）

この Task はコード変更を伴わないため commit は無い。

---

## 実装後の手動確認（自動化不可）

以下は subagent/エージェントでは実行できない、人間による実機確認。実装完了後にユーザーへ依頼する:

1. Pi へデプロイ（または開発機で `npm run package` の release を LAN 経由で起動）した状態で、iPhone の Safari から `http://<PiのIP>:8080` を開く
2. 共有ボタン →「ホーム画面に追加」
3. ホーム画面のアイコンをタップして起動し、Safari の URL バー/ツールバーが表示されず standalone で開くかを確認する
4. 結果に応じて、コミットメッセージや今後の記録で「対応完了」ではなく実態（iOS で有効 / HTTPS 化待ち）を明記する
