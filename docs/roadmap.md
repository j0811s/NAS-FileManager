# 開発ロードマップ

`docs/spec.md` の未実装部分をフェーズ分けしたもの。上から順に依存関係がある。
各 Phase は brainstorming → 設計（`docs/superpowers/specs/`）→ 実装計画（`docs/superpowers/plans/`）→ TDD 実装の流れで進める。

## 現在地（完了済み）

- npm workspaces モノレポ骨組み（`@nas-fm/web` / `@nas-fm/server` / `@nas-fm/shared`）
- server: Hono `/health`（`0.0.0.0:8080`）、web: 最小レンダリング + Vitest、shared: 基本型
- ツールチェーン（oxfmt / oxlint / husky + lint-staged）、Claude Code 設定（CLAUDE.md / rules / スキル / フック）

---

## Phase 1: ファイル操作 API（サーバ）— spec §4

- [x] `lib/safeResolve`（パストラバーサル検証）— **最初に・テスト必須**（spec §4.3A）。全エンドポイントが依存
- [x] `NAS_ROOT` 設定機構 — 環境変数で注入。未設定時は開発用 `.dev-share/`（gitignore・起動時自動作成）にフォールバック。Pi 本番は systemd の `Environment=` で `/srv/nas/share`
- [x] server に Vitest 導入（テストは `fs.mkdtemp` の一時ディレクトリで実 fs を使う）
- [x] `files` feature: `GET /api/list`（名前・サイズ・更新日時・種別）
- [x] `POST /api/upload` — **ストリーミング必須**（`pipeline` + `createWriteStream`、spec §4.3B）
- [x] `GET /api/download` — ストリーミング（`createReadStream` + `Content-Disposition`、spec §4.3D）
- [x] `POST /api/mkdir` / `POST /api/rename` / `DELETE /api/delete`
- [x] `packages/shared` に各エンドポイントのリクエスト/レスポンス型を追加

**開発方針（決定済み）:** モックは使わない。開発・テストとも実 fs で、差し替えるのはルートディレクトリ（`NAS_ROOT`）だけ。フロント開発も Vite の `server.proxy`（`/api` → `localhost:8080`）で実 API に接続する。Pi 固有の権限まわり（nas グループ / umask / setgid）だけは Phase 4 で実機検証する。macOS は大文字小文字を区別しないため、リネームの一部挙動が Pi (ext4) と異なる点に注意。

## Phase 2: 認証 — spec §4.1

- [x] 単一管理ユーザーの JWT またはセッション（`hono/jwt`）
- [x] 認証ミドルウェア（LAN 内限定でも最低限付ける方針）

## Phase 3: フロントエンド UI — spec §5

- [x] Tailwind CSS + shadcn/ui 初期化（`npx shadcn@latest init`）+ `lucide-react`
- [x] `file-list` feature: 一覧・パンくず・ソート（`Table` / `Breadcrumb` / `Button`）
- [x] `upload` feature: ドラッグ&ドロップ + 進捗表示（XHR `upload.onprogress` + `Progress`）
- [x] 行アクション: DL / フォルダ作成 / リネーム / 削除（`DropdownMenu` / `Dialog` / `AlertDialog`）
- [x] 通知・エラー表示（`Sonner`）
- [x] `auth` feature: ログイン画面

## Phase 4: 本番配信・デプロイ — spec §3, §7

- [x] web の `dist` を server から静的配信（本番は 1 プロセス）
- [x] server の単一 `server.js` バンドル（`tsup` / `esbuild`）
- [x] systemd ユニット（`Group=nas` / `UMask=0002` / `Environment=NAS_ROOT=/srv/nas/share`）
- [ ] Pi 実機で権限統一を検証（setgid 2775、SMB との相互編集・削除）

## Phase 5: プレビュー機能（拡張） — spec §10

- [ ] inline 配信エンドポイント（MIME 判定 `mime-types`・`X-Content-Type-Options: nosniff`・**Range 対応 206**）
- [ ] プレビュー UI（`Dialog`、画像 / 動画 / テキスト振り分け、非対応時は DL フォールバック必須）
- [ ] テキストはサイズ制限（先頭 N KB）+ シンタックスハイライト
- [ ] 割り切り: HEIC は DL のみ、Pi での動画トランスコードはしない

---

## やらないこと（spec の割り切り）

- 複数ユーザー権限・共有リンク（初版は単一管理ユーザー）
- 外部公開（LAN 内のみ。Tailscale は将来「足すだけ」で対応、コード変更不要）
- Pi 上での動画トランスコード（重すぎる）
