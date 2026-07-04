# Phase 4: 本番配信・デプロイ 設計

- 日付: 2026-07-05
- 対象: `apps/web` の静的配信、`apps/server` の単一バンドル、パッケージングスクリプト、systemd ユニットの整備(`docs/spec.md` §3・§7、`docs/roadmap.md` Phase 4)
- 前提: Phase 1〜3(ファイル操作 API・UI)・Phase 2(認証)は完成済み

## 1. スコープ(ユーザー確認済み)

Phase 4 の roadmap 4項目のうち、**ローカルで実装・検証できる3項目**をこのフェーズの対象とする。

| 項目 | 対応 |
|---|---|
| web の `dist` を server から静的配信 | 対象。実装・自動テストで検証 |
| server の単一バンドル | 対象。esbuild 直接。実装・ローカル実疎通で検証 |
| systemd ユニット | 対象。実ファイルとして配置。ローカルでは起動検証はできないため内容レビューのみ |
| Pi 実機での権限統一検証(setgid/umask/Samba 相互編集) | **対象外**。物理 Raspberry Pi へのアクセスが必要でこのセッションから実行不可。`docs/spec.md` §3/§9 の既存手順書に委ね、`docs/roadmap.md` の当該項目は未チェックのまま残す |

## 2. 静的配信(`createApp` の拡張)

### 2.1 シグネチャ変更

`apps/server/src/app.ts` の `createApp(root: string, authConfig: AuthConfig): Hono` に **第3引数 `staticDir?: string`(省略可)** を追加する: `createApp(root: string, authConfig: AuthConfig, staticDir?: string): Hono`。

### 2.2 マウント方式

- `staticDir` 指定時: `@hono/node-server/serve-static` の `serveStatic({ root: staticDir })` を、`/health` と `/api/auth`・`/api` のルート登録**より後**にマウントする(`app.use("/*", serveStatic({ root: staticDir }))`)
- Hono はミドルウェア/ハンドラを登録順にチェーンとして評価する。`/health` や `/api/list` は自身の登録済みハンドラが応答を返して終端するため、後から登録した static ミドルウェアには到達しない。static ハンドラに落ちるのは、他のどの登録済みルートにもマッチしない GET リクエストのみ(`/`、`/assets/*.js` など)
- `staticDir` 未指定時(開発時のデフォルト): static 配信を一切マウントしない。既存の `resolveNasRoot`/`resolveAuthConfig` と同じ「無ければスキップ」パターンに揃える
- このアプリはクライアントサイドルーティングを持たない単一画面(`FileBrowser` の内部 state で完結)のため、SPA フォールバック(未知パスを `index.html` に書き換える処理)は不要。既知の静的アセットパスのみを配信すればよい

### 2.3 `server.ts` の変更

- `import.meta.url` から自身のファイル位置を求め、隣接する `public/` ディレクトリのパスを `staticDir` として `createApp` に渡す
- 開発時(`tsx watch src/server.ts` で `src/server.ts` を直接実行)はその隣に `public/` が存在しないため、`staticDir` は「存在しないパス」になる。`app.ts` 側で `existsSync` により存在確認し、無ければマウントしない — 追加の環境分岐(NODE_ENV 判定等)は不要
- ポート番号を `process.env.PORT` があればそれを使い、無ければ `8080`(`docs/spec.md` §7 が指摘する「他サービスとのポート重複」への対応)

## 3. server の単一バンドル

- `apps/server` に `esbuild` を devDependency として追加(バージョン無指定で `npm install -D esbuild -w @nas-fm/server`。`.npmrc` の save-exact/min-release-age に従う)
- `apps/server/package.json` の `build` スクリプトを、web の `build`(`tsc --noEmit` → `vite build`)と同じ形に揃えて拡張する:
  `tsc -p tsconfig.json --noEmit && esbuild src/server.ts --bundle --platform=node --format=esm --outfile=dist/server.js`
- ルートの `npm run build`(`--workspaces --if-present`)は変更不要。各ワークスペースの `build` スクリプトが実体を持つ設計のため、server も自動的に実バンドルを生成するようになる
- minify はしない。可読性・Pi 上での journalctl によるスタックトレース調査のしやすさを優先する
- Node 組み込みモジュール(`node:fs`・`node:path`・`node:crypto`・`node:stream` 等)は `--platform=node` により自動的に外部化される。`hono`・`@hono/node-server`・`hono/jwt`・`hono/cookie` は純 JS(ネイティブ依存なし)のためバンドルに含めて問題ない

## 4. パッケージング(`npm run package`)

- ルートに `scripts/package-release.mjs` を新規作成する。新規依存は追加せず `node:fs`(`fs.rmSync`/`fs.mkdirSync`/`fs.cpSync`)と `node:path` のみを使う
- 処理内容: `release/` を(存在すれば)削除して作り直し → `apps/server/dist/server.js` を `release/server.js` にコピー → `apps/web/dist/` の中身を `release/public/` にコピー
- ルート `package.json` に `"package": "npm run build && node scripts/package-release.mjs"` を追加する
- 実行結果 `release/` は `/opt/nas-fm` にそのままコピーすれば動く構成(`release/server.js` + `release/public/`)

## 5. systemd ユニットと関連ドキュメントの修正

`docs/spec.md` §7 の既存ユニットテンプレートは Phase 1/Phase 2 より前に書かれたもので、**`NAS_ROOT`・`AUTH_SECRET`・`AUTH_PASSWORD_HASH` の `Environment=` 設定が欠落している**。このまま本番投入すると、環境変数が未設定のため `resolveAuthConfig()` の開発用デフォルト(パスワード `admin`、固定 secret)が有効になってしまう実害のある齟齬であり、このフェーズで修正する。

- `deploy/nas-fm.service` を新規作成する(実ファイルとして配置)。内容:
  - `WorkingDirectory=/opt/nas-fm`、`ExecStart=/usr/bin/node /opt/nas-fm/server.js`(パッケージング後のレイアウトと一致)
  - `Environment=NAS_ROOT=/srv/nas/share`
  - `Environment=AUTH_SECRET=<ランダムな長い文字列に置き換える>`
  - `Environment=AUTH_PASSWORD_HASH=<hash-password.ts で生成した値に置き換える>`(コメントで `npx tsx apps/server/scripts/hash-password.ts <password>` を使う旨を明記)
  - `Environment=PORT=8080`(§4.3 で追加したポート設定に対応。他サービスと重複する場合はここを変更)
  - `Group=nas`・`UMask=0002`(既存どおり。§3 の権限統一に必須)
- `docs/spec.md` §7 のコードブロックを `deploy/nas-fm.service` の内容に合わせて更新し、二重管理・内容の乖離を防ぐ

## 6. テスト・検証

### 6.1 自動テスト(`apps/server/src/app.ts` 関連)

- `staticDir` に一時ディレクトリ(`index.html`・`assets/app.js` のフィクスチャを用意)を指定した `createApp` で:
  - `GET /` → 200、`Content-Type` が HTML、`index.html` の中身を返す
  - `GET /assets/app.js` → 200、JS の中身を返す
  - `GET /health` → 200(static マウント後も既存の挙動を維持)
  - `GET /api/list`(Cookie 無し)→ 401(static マウントが認証ガードを迂回しないことを確認)
- `staticDir` を渡さない(既存の呼び出し方)場合: `GET /` → 404(static 未マウント、既存 149 テストは無変更で通ることが期待値)

### 6.2 ローカル実疎通(Node fetch。curl 禁止)

1. `npm run package` を実行し `release/server.js`・`release/public/` が生成されることを確認
2. `node release/server.js` をバックグラウンド起動(`NAS_ROOT`/`AUTH_SECRET`/`AUTH_PASSWORD_HASH` は開発用デフォルトのまま、`PORT` はデフォルト 8080)
3. Node fetch で `GET /`(200・HTML)、`GET /assets/*.js` のいずれか一つ(200)、`GET /health`(200)、`GET /api/list`(未認証 401 → ログイン → 認証済み 200)を確認
4. バックグラウンドサーバーを停止

### 6.3 対象外の検証

- Pi 実機での setgid(2775)・umask(0002)・Samba との相互編集/削除の検証は、`docs/spec.md` §3・§9 の既存手順書に委ねる。`docs/roadmap.md` の当該チェック項目は未チェックのまま残す

## 7. 非ゴール

- Pi 実機でのデプロイ実行・権限統一の実地検証(本フェーズ対象外、§1 参照)
- HTTPS/リバースプロキシ、Tailscale 導入(spec §8 で「後付け」と明示済み、Phase 4 の対象外)
- ビルド成果物の圧縮・minify、Docker 化などの追加最適化(YAGNI)
