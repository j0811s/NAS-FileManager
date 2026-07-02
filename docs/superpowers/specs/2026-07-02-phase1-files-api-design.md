# Phase 1: ファイル操作 API 設計

- 日付: 2026-07-02
- 対象: `apps/server` にファイル操作 API（`docs/spec.md` §4）を実装する。Phase 1（`docs/roadmap.md`）
- 前提: モノレポ骨組みは実装済み。認証は Phase 2（本フェーズの API は LAN 内・無認証）

## 1. 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| アップロード転送方式 | **生ボディストリーム**（1リクエスト=1ファイル）。multipart/busboy は使わない |
| 競合ポリシー | **安全優先**: upload 既存あり→409（`overwrite=true` で上書き）／rename 移動先あり→409／mkdir 同名あり→409／delete はファイル・ディレクトリ（再帰）とも削除可（確認は UI の AlertDialog が担う） |
| 開発環境 | **モック不使用**。実 fs ＋ `NAS_ROOT` 環境変数注入。テストは `mkdtemp` の一時ディレクトリ |
| アーキテクチャ | routes / service 分離＋集中エラーマッピング（spec §6.3 の features 構成に準拠） |
| バリデーション | 手書き（`files.schema.ts`）。zod 等の依存は追加しない（パラメータが単純なため） |

## 2. モジュール構成

```
apps/server/src/
├─ lib/
│  ├─ config.ts        # NAS_ROOT 解決（env → 無ければ <cwd>/.dev-share を自動作成）
│  ├─ safe-resolve.ts  # safeResolve(root, userPath)（spec §4.3A のロジック）
│  └─ errors.ts        # AppError（code 付き）と code→HTTP ステータス対応
├─ features/files/
│  ├─ files.routes.ts  # Hono サブアプリ。入出力変換のみ
│  ├─ files.service.ts # fs 操作の純関数群（HTTP 非依存。(root, relPath, ...) を受ける）
│  └─ files.schema.ts  # リクエストの手書きバリデーション
└─ app.ts              # app.route("/api", filesRoutes) + onError で AppError→JSON
```

- `packages/shared/src/types.ts` に API 型を追加し `index.ts` から `export type`:
  `ListResponse`（既存）/ `UploadResponse` / `MkdirRequest` / `RenameRequest` / `DeleteResponse` 等の各レスポンス型 / `ApiError`（`{ error: { code, message } }`）/ `ApiErrorCode`
- パスはすべて **NAS_ROOT からの相対パス**（クエリまたは JSON フィールド、URL エンコード済み）。全エンドポイントが最初に `safeResolve` を通す

## 3. エンドポイント仕様

| API | 挙動 | エラー |
|---|---|---|
| `GET /api/list?path=` | ディレクトリの `FileEntry[]`（name / size / mtime / type）。`type: "dir"` のエントリは `size: 0` とする。`path` 空文字は NAS_ROOT 直下。ソートはクライアント側 | 404（存在しない）/ 400（ファイルを指定） |
| `POST /api/upload?path=&overwrite=` | 生ボディを `pipeline(Readable.fromWeb(body), createWriteStream(dest))` でディスクへ直接書く。既存あり→409（`overwrite=true` で上書き）。親ディレクトリ無し→404（自動 mkdir しない）。**途中失敗時は書きかけファイルを best-effort で削除** | 409 / 404 / 400（body なし） |
| `GET /api/download?path=` | `createReadStream` をストリーム返却。`Content-Length`（stat から）+ `Content-Disposition: attachment`。日本語ファイル名は RFC 5987（`filename*=UTF-8''...`）でエンコード | 404 / 400（ディレクトリを指定） |
| `POST /api/mkdir`（body: `{path}`） | ディレクトリ作成。同名あり→409 | 409 / 404（親なし） |
| `POST /api/rename`（body: `{from,to}`） | `fs.rename`。移動先あり→409（上書きしない） | 409 / 404 |
| `DELETE /api/delete?path=` | ファイル/ディレクトリとも削除（ディレクトリは再帰）。NAS_ROOT 自体は削除不可（400） | 404 |

- パストラバーサル検出は一律 **400**（code: `PATH_TRAVERSAL`）
- エラーレスポンスは統一 JSON: `{ "error": { "code": "CONFLICT", "message": "..." } }`

## 4. NAS_ROOT と開発環境

- `lib/config.ts` が `process.env.NAS_ROOT` を読む。未設定なら `<process.cwd()>/.dev-share` を自動作成して使用
  - `npm run dev:server` は cwd = `apps/server` のため、実体は `apps/server/.dev-share`。`.gitignore` に `.dev-share/` を追加
- Pi 本番は systemd の `Environment=NAS_ROOT=/srv/nas/share`（Phase 4 で設定）
- `apps/web/vite.config.ts` に dev proxy を追加: `/api` → `http://localhost:8080`（本フェーズは設定のみ。UI は Phase 3）

## 5. エラーハンドリング

- service は `AppError(code, message)` を投げる。code→HTTP 対応:
  - `PATH_TRAVERSAL` → 400 / `INVALID_REQUEST` → 400 / `NOT_A_DIRECTORY`・`IS_A_DIRECTORY` → 400
  - `NOT_FOUND` → 404 / `CONFLICT` → 409 / その他（想定外）→ 500
- fs エラー（`ENOENT` / `EEXIST` / `ENOTDIR` 等）は service 内で AppError に変換する
- `app.ts` の `onError`: AppError → 対応ステータス＋統一 JSON。AppError 以外 → 500 ＋ サーバログ（レスポンスに内部情報を漏らさない）

## 6. テスト（TDD・実 fs）

- `apps/server` に Vitest を導入（root `npm run test --workspaces --if-present` に自動参加）
- **safeResolve 単体テスト**: `../` 系・絶対パス・エンコード済みトラバーサル・空文字・ルート自身などを網羅
- **service テスト**: `fs.mkdtemp(os.tmpdir())` で一時ルートを作り、実 fs で各操作の正常系・409・404 を検証。テスト後に後片付け
- **route テスト**: Hono の `app.request()`（HTTP サーバ起動不要）でステータスコード・エラー JSON・ダウンロード内容・アップロード書き込み結果を検証
- 「アップロードをメモリに載せない」性質は自動テストでは担保しづらいため、実装を `pipeline` ＋ `createWriteStream` に限定することで担保する（コードレビュー観点）

## 7. 非ゴール

- 認証（Phase 2）、UI（Phase 3）、静的配信・バンドル・systemd（Phase 4）、プレビュー/Range（Phase 5）
- 複数ファイル同時アップロードのサーバ側対応（フロントがリクエストを分ける）
- tus 等の再開可能アップロード（将来検討）
