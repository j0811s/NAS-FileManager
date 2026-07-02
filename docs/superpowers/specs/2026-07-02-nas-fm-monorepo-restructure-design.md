# NAS-FileManager モノレポ再構成 設計

- 日付: 2026-07-02
- 対象: リポジトリのディレクトリ構成を `CLAUDE.local.md` 6章に沿って npm workspaces のモノレポへ再構成する
- スコープ: **骨組み＋最小の動く土台**（各ワークスペースがビルド/起動でき、`@nas-fm/shared` を相互 import 可能な状態まで）。`list`/`upload` などの機能実装は次フェーズ。
- 制約: 今回は **git commit を行わない**（ローカルの作業ツリー変更のみ）。

---

## 1. 目的とゴール

`CLAUDE.local.md`（仕様書）6章が定めるモノレポ構成を、現在の中途半端な状態から完成させる。追加ツールは使わず **npm workspaces** のみで管理する。

完了条件（このフェーズの受け入れ基準）:

1. ルートで `npm install` が成功し、ワークスペースが解決される。
2. `npm run build` で `apps/web` が `dist` を生成し、`apps/server` の型検査が通る。
3. `apps/server` が `0.0.0.0` で listen し、`GET /health` が応答する。
4. `apps/web` が最小レンダリングで起動する。
5. `apps/web` / `apps/server` の双方が `@nas-fm/shared` の型を import できる。
6. `npm run typecheck` / `lint` / `fmt:check` が通る。

非ゴール（今回やらないこと）:

- `/api/list` などの各機能の実装、認証、shadcn/ui 導入、プレビュー機能。
- 本番用の単一 `server.js` バンドル（`tsup`/`esbuild`）と systemd 配備。
- 外部到達（Tailscale 等）。

---

## 2. 命名とパッケージ

| ワークスペース | ディレクトリ | パッケージ名 |
| --- | --- | --- |
| フロント（React + Vite） | `apps/web` | `@nas-fm/web` |
| バックエンド（Hono） | `apps/server` | `@nas-fm/server` |
| 共有型 | `packages/shared` | `@nas-fm/shared` |
| ルート | `.` | `nas-fm`（private） |

ディレクトリ名はパッケージ名の末尾（web/server/shared）と一致させ、`-w apps/web` と `-w @nas-fm/web` のどちらでも直感的に指せるようにする。これにより仕様 6.4 のスクリプト例（`npm run dev -w apps/web`）と整合する。

---

## 3. `@nas-fm/shared` の参照方式（アーキテクチャ上の要点）

**採用: ソース参照方式。**

- `packages/shared/package.json` の `exports` を TS ソース（`./src/index.ts`）に向け、`shared` 自体はビルドしない。
- `apps/web` は Vite が、`apps/server` は `tsx` がそのまま TS ソースを解決・取り込む。
- 型解決は `tsconfig.base.json` の `paths` に `@nas-fm/shared` → `packages/shared/src` を定義して行う。

理由:

- ビルド順序（shared → apps）が不要で、`shared` を編集すると両アプリへ即反映される。
- 仕様7章の本番像（ビルド済み web を server が単一プロセスで配信）と整合する。本番で web は Vite が、server はバンドラが shared を取り込む前提のため、ソース参照が自然。
- 素の `node server.js` 化（バンドル）は実デプロイを行う次フェーズで `tsup`/`esbuild` を足せばよく、今回は保留する。

不採用: コンパイル参照（`shared` を `dist` へ事前ビルド）。素の node と最も相性が良い一方、build 順序が必要で開発時の手間が増えるため、本フェーズでは採らない。

---

## 4. 目標ディレクトリ構成

```text
nas-fm/                        # ルート（private, name: "nas-fm"）
├─ package.json                # 新規: workspaces=[apps/*,packages/*], 集約スクリプト, ツールをhoist
├─ tsconfig.base.json          # 新規: 共通compilerOptions + paths(@nas-fm/shared)
├─ tsconfig.json               # solutionファイル（references: web/server/shared）
├─ .npmrc / .nvmrc / .node-version / .editorconfig / .gitignore   # 据え置き
├─ .husky/pre-commit
├─ lint-staged.config.ts       # globを apps/**,packages/** へ更新
├─ .oxlintrc.json / .oxfmtrc.json                                  # 据え置き（schemaはルートnode_modules）
├─ apps/
│  ├─ web/                     # @nas-fm/web （root の vite/tsconfig/public を移設）
│  │  ├─ package.json          # name=@nas-fm/web, react/react-dom/vite/vitest 等のみ
│  │  ├─ index.html            # 新規（Vite要）
│  │  ├─ vite.config.ts        # 移設＋Vitest設定同居
│  │  ├─ tsconfig.json / tsconfig.app.json / tsconfig.node.json    # 移設＋baseをextends
│  │  ├─ public/               # favicon.svg, icons.svg を移設
│  │  └─ src/
│  │     ├─ features/          # file-list/ upload/ auth/（.gitkeep 空）
│  │     ├─ components/ui/     # shadcn生成先（.gitkeep）
│  │     ├─ lib/               # cn 等（最小 util）
│  │     ├─ app/               # App.tsx, providers
│  │     └─ main.tsx           # 最小実装
│  └─ server/                  # @nas-fm/server
│     ├─ package.json          # hono, @hono/node-server, tsx(dev)
│     ├─ tsconfig.json         # base を extends
│     └─ src/
│        ├─ features/          # files/ auth/（.gitkeep 空）
│        ├─ lib/               # safeResolve の置き場（.gitkeep）
│        ├─ app.ts             # Honoインスタンス（/health のみ）
│        └─ server.ts          # entrypoint（0.0.0.0 で listen）
└─ packages/
   └─ shared/                  # @nas-fm/shared
      ├─ package.json          # exports→./src/index.ts
      ├─ tsconfig.json
      └─ src/
         ├─ types.ts           # FileEntry / ListResponse 等の最小型
         └─ index.ts           # バレル
```

各 feature ディレクトリは中身が無いため `.gitkeep` を置いて空ディレクトリを保持する（機能実装は次フェーズ）。

---

## 5. 最小実装の中身（動作確認できる最低限）

機能ロジックは書かない。ワークスペース配線が機能することの検証に必要な最小限のみ。

- `packages/shared/src/types.ts`: `FileEntry`（name/size/mtime/type 程度）と `ListResponse`（entries など）の最小型。
- `packages/shared/src/index.ts`: 上記を再エクスポートするバレル。
- `apps/server/src/app.ts`: Hono インスタンスを生成し `GET /health` のみ定義（`@nas-fm/shared` の型を1つ import して疎通確認）。
- `apps/server/src/server.ts`: `@hono/node-server` で `0.0.0.0` に listen する entrypoint。ポートは仕様の 8080。
- `apps/web/index.html` + `apps/web/src/main.tsx` + `apps/web/src/app/App.tsx`: 最小レンダリング（`@nas-fm/shared` の型を import して疎通確認）。
- `apps/web/src/lib/`: 将来の `cn` などの置き場（今は空 or 最小）。

---

## 6. ルート集約

### 6.1 workspaces と依存の hoist

- ルート `package.json`: `"private": true`, `"workspaces": ["apps/*","packages/*"]`。
- 開発ツールをルート devDependencies へ集約（各アプリからは削除）: `husky` / `lint-staged` / `oxlint` / `oxfmt` / `typescript`。
- `prepare: "husky"` はルートへ移す。
- `.oxlintrc.json` / `.oxfmtrc.json` の `$schema`（`./node_modules/...`）はルートの node_modules から解決されるため据え置き。

### 6.2 ルートスクリプト（仕様 6.4 準拠）

- `dev:web` = `npm run dev -w @nas-fm/web`
- `dev:server` = `npm run dev -w @nas-fm/server`
- `dev` = `concurrently` で web/server を同時起動（`concurrently` をルート devDep に追加）
- `build` = `npm run build --workspaces --if-present`
  - `@nas-fm/web`: `tsc -b && vite build`（dist を実生成）
  - `@nas-fm/server`: `tsc -p tsconfig.json --noEmit`（型検査。実バンドルは次フェーズ）
  - `@nas-fm/shared`: build スクリプト無し（`--if-present` によりスキップ）
- `typecheck` = ルート `tsc -b`（solution references 経由）
- `lint` = `oxlint` / `lint:fix` = `oxlint --fix`
- `fmt` = `oxfmt` / `fmt:check` = `oxfmt --check`

### 6.3 TypeScript 設定

- `tsconfig.base.json`（新規・ルート）: 共通 `compilerOptions`（現行 app/node 設定の共通項）と `paths`（`@nas-fm/shared` → `packages/shared/src`）。
- `tsconfig.json`（ルート）: `files: []` の solution ファイルで、`apps/web` / `apps/server` / `packages/shared` を `references` する。
- 各ワークスペースの `tsconfig*.json` は `tsconfig.base.json` を `extends` し、自分の `@/*`（`src/*`）paths と `include` を持つ。
  - `apps/web`: 現行の `tsconfig.app.json`（ブラウザ/JSX）と `tsconfig.node.json`（vite.config 用）の二分割を維持し、`tsBuildInfoFile`/`include` を移設先に合わせて調整。

### 6.4 バージョン方針

`.npmrc`（`save-exact=true`, `min-release-age=3`, `engine-strict=true`）を尊重。現行の実バージョン（react 19.2.7 / react-dom 19.2.7 / vite 8.1.0 / typescript 6.0.3 / oxlint 1.71.0 / oxfmt 0.56.0 / husky 9.1.7 / lint-staged 17.0.8 / @vitejs/plugin-react 6.0.3 / @types/node 26.0.1 / @types/react 19.2.17）を踏襲。新規追加（hono / @hono/node-server / tsx / vitest / @testing-library/react / concurrently）は exact 固定・3日以上経過したバージョンを使用。

---

## 7. 移行手順（履歴保持のため `git mv` 主体、commit はしない）

1. `git mv app/frontend apps/web`、`git mv app/backend apps/server`、空になった `app/` を削除。
2. ルートの `vite.config.ts` / `tsconfig.app.json` / `tsconfig.node.json` / `public/` を `apps/web/` へ移設。`tsconfig.base.json` を新規化し、各 tsconfig で `extends`。移設に伴い `include`・`tsBuildInfoFile`・`paths` を調整。
3. ルート `package.json`（workspaces）を新規作成し、ツールを hoist。`apps/web/package.json` を `@nas-fm/web` にリネームし、hoist 済みツール依存を除去。`index.html` を追加。
4. `apps/server/package.json`・`packages/shared/package.json` と各最小ソースを作成（第5節）。`apps/server` に `tsx`・`hono`・`@hono/node-server` を追加。
5. `lint-staged.config.ts` の glob を `app/**` → `apps/**` に更新し、`packages/**` も対象に含める。`tsc` 参照をルート構成に合わせる。
6. 各 feature の空ディレクトリに `.gitkeep` を配置。

---

## 8. 検証

ルートで以下を実行し、第1節の受け入れ基準を満たすことを確認する。

1. `npm install`（ワークスペース解決・シンボリックリンク生成）。
2. `npm run build`（web が `apps/web/dist` を生成、server 型検査が通過）。
3. `npm run dev:server` → 別シェルで `GET http://localhost:8080/health` が 200 を返す。
4. `npm run dev:web` → Vite が起動し最小画面が表示される。
5. `npm run typecheck` / `npm run lint` / `npm run fmt:check` が通る。
6. `apps/web` / `apps/server` から `import type { FileEntry } from "@nas-fm/shared"` が型解決される。

---

## 9. リスクと対処

| リスク | 対処 |
| --- | --- |
| `tsc` がクロスパッケージの `@nas-fm/shared`（bare specifier）を解決できない | `tsconfig.base.json` の `paths` で `packages/shared/src` にマップ。型検査はこれで解決。実行時は workspace symlink ＋ Vite/`tsx` が解決 |
| 素の `node server.js` では TS ソースの shared を実行できない | 本フェーズの server 実行は `tsx`。本番用バンドルは次フェーズで `tsup`/`esbuild` を導入 |
| `min-release-age=3` で新規依存の install が弾かれる | 追加する依存は 3 日以上経過した exact バージョンを選定 |
| ツール hoist 後に schema パス（`./node_modules/...`）がずれる | ルートに hoist されるため `.oxlintrc.json`/`.oxfmtrc.json` はルート実行前提で据え置き |
