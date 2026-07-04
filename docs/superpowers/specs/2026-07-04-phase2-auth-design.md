# Phase 2: 認証 設計

- 日付: 2026-07-04
- 対象: `apps/server` にファイル操作 API を保護する認証、`apps/web` にログイン画面を実装する（`docs/spec.md` §4.1、`docs/roadmap.md` Phase 2）
- 前提: Phase 1（ファイル操作 API）・Phase 3（UI）は完成済み。単一管理ユーザー・LAN 内・フロントと同一オリジン運用

## 1. 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 認証方式 | **httpOnly Cookie + JWT**。ログイン成功で署名付き JWT を httpOnly Cookie にセット、ミドルウェアで検証 |
| 資格情報 | パスワードを **Node 標準 scrypt** でハッシュ化し `AUTH_PASSWORD_HASH` 環境変数に保持。新規依存ゼロ（`node:crypto`） |
| スコープ | サーバの認証（ミドルウェア＋`/api/auth/*`）＋ web のログイン画面の両方 |
| 未設定時 | 開発用固定パスワード（`admin`）＋固定 secret にフォールバックし起動時に警告。本番は systemd の `Environment=` で注入 |

## 2. アーキテクチャ概要

同一オリジン（本番は server が web の `dist` を配信、開発は Vite proxy `/api → localhost:8080`）を活かし、ログイン成功で署名付き JWT を httpOnly Cookie に載せる。ファイル操作 API は認証ミドルウェアで保護し、`/health` と `POST /api/auth/login` は公開。

## 3. サーバ構成

```
apps/server/src/
├─ lib/
│  ├─ password.ts        # hashPassword / verifyPassword（scrypt + timingSafeEqual）
│  └─ auth-config.ts     # resolveAuthConfig(): AUTH_SECRET / AUTH_PASSWORD_HASH を env から解決
├─ features/auth/
│  ├─ auth.service.ts    # verifyLogin(config, password) / issueToken(config) / verifyToken(config, token)
│  ├─ auth.routes.ts     # createAuthRoutes(config): POST /login・POST /logout・GET /me
│  └─ auth.middleware.ts # requireAuth(config): Cookie の JWT を検証、失敗で AppError("UNAUTHORIZED")
├─ scripts/hash-password.ts  # 本番用 AUTH_PASSWORD_HASH を生成する CLI（tsx で実行）
└─ app.ts                # createApp(root, authConfig) に変更
```

### 3.1 ルート保護（順序の曖昧さを避ける構成）

Hono のミドルウェア登録順に依存しない構成にする:

- `createFilesRoutes(root, config)` の先頭で `app.use("*", requireAuth(config))` を適用 → **files サブアプリが自分自身を保護**する
- `createApp` は `/api/auth`（auth サブアプリ・login は公開）と `/api`（files サブアプリ・自己保護）を別々にマウント。`/api/auth/*` は files サブアプリのミドルウェアを通らない
- `/health` は公開のまま

```ts
// createApp(root, authConfig) の骨子
app.get("/health", ...);                                   // 公開
app.route("/api/auth", createAuthRoutes(authConfig));       // login は公開、me/logout も可
app.route("/api", createFilesRoutes(root, authConfig));     // files は requireAuth で自己保護
app.onError(...);                                           // AppError → 統一 JSON（UNAUTHORIZED→401）
```

### 3.2 エンドポイント

| API | 動作 |
|---|---|
| `POST /api/auth/login`（body `{ password }`） | scrypt 照合。成功で `Set-Cookie: nasfm_token=<JWT>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`、`{ ok: true }` 200。失敗で 401 `UNAUTHORIZED` |
| `POST /api/auth/logout` | `nasfm_token` Cookie を削除、`{ ok: true }` 200 |
| `GET /api/auth/me` | Cookie の JWT を検証し `{ authenticated: boolean }`（未認証でも 200 で `false` を返す。ログイン画面の出し分けに使う） |
| 既存 `/api/list` `/api/upload` 等 | `requireAuth` 経由。有効な Cookie が無ければ 401 `UNAUTHORIZED` |

## 4. 資格情報・トークン

- パスワードハッシュ形式: `scrypt$<saltBase64>$<hashBase64>`。`AUTH_PASSWORD_HASH` に保持
- `hashPassword(password)`: 16バイトのランダム salt を生成し scrypt（keylen 64）でハッシュ、上記形式の文字列を返す
- `verifyPassword(password, stored)`: 保存値を parse し、同 salt で再ハッシュして `crypto.timingSafeEqual` で比較。形式不正・不一致は `false`
- JWT: `hono/jwt` の `sign`/`verify`。ペイロード `{ sub: "admin", exp }`（exp = 現在 + 7日）。署名鍵は `AUTH_SECRET`
- **未設定時（開発）**: `AUTH_PASSWORD_HASH` 未設定なら固定パスワード `admin` のハッシュ、`AUTH_SECRET` 未設定なら固定の開発用鍵を使い、起動ログに `WARNING: 開発用の認証設定を使用中。本番では AUTH_SECRET と AUTH_PASSWORD_HASH を設定すること` を出す
- `scripts/hash-password.ts`: 引数のパスワードから `AUTH_PASSWORD_HASH` 値を生成し出力（`npx tsx apps/server/scripts/hash-password.ts <password>`）

## 5. 共有型（packages/shared）

- `ApiErrorCode` に `"UNAUTHORIZED"` を追加。`statusOf` で 401 にマップ
- `LoginRequest { password: string }`、`AuthStatus { authenticated: boolean }` を追加し `index.ts` から `export type`

## 6. web 構成

```
apps/web/src/features/auth/
├─ hooks/useAuth.ts          # useQuery(["me"]) → AuthStatus（api.me）
├─ components/LoginForm.tsx  # パスワード入力 → login mutation → ["me"] 無効化、失敗トースト
├─ components/AuthGate.tsx   # useAuth: 未認証は LoginForm、認証済みは children
└─ index.ts                  # AuthGate / useAuth を公開
```

- `lib/api.ts` に `login(password): Promise<void>` / `logout(): Promise<void>` / `me(): Promise<AuthStatus>` を追加。同一オリジンのため fetch は Cookie を自動送出（既定の `credentials: "same-origin"`）
- `App.tsx`: `<AuthGate>` で `FileBrowser` を包む。認証済み時はヘッダにログアウトボタン（logout mutation → `["me"]` 無効化）
- セッション期限切れ（操作中の 401）: api クライアントが `UNAUTHORIZED` を throw。`useFileMutations` / `useUpload` / `useFileList` のエラー経路で `queryClient.invalidateQueries(["me"])` を呼び、`AuthGate` がログイン画面へ戻す

## 7. エラーハンドリング

- `requireAuth`: Cookie 無し / JWT 不正 / 期限切れ → `AppError("UNAUTHORIZED", ...)` → `onError` が 401 統一 JSON
- web: `error-messages.ts` に `UNAUTHORIZED: "ログインが必要です"` を追加。ログイン失敗トーストは「パスワードが違います」

## 8. テスト（TDD・実挙動）

- `password.ts`: hash↔verify 往復、誤パスワード拒否、壊れた保存値で `false`、timingSafeEqual 使用
- `auth-config.ts`: env 設定時はそれを使用、未設定時は開発デフォルト＋警告ログ（`console.warn` を spy）
- `auth.service.ts`: issueToken→verifyToken 往復、改竄トークン拒否、期限切れ拒否
- `auth.routes` / `middleware`（`app.request()`）: login 成功で Set-Cookie、誤パスワード 401、Cookie 付きで保護ルート 200・無しで 401、logout で Cookie 削除、me が Cookie 有無を反映
- web: `api.login/logout/me`（fetch モック）、`LoginForm` 送信で login 呼び出し、`AuthGate` が me の結果で LoginForm / children を出し分け

## 9. 非ゴール

- 複数ユーザー・ロール・パスワード変更 UI（初版は単一管理者。パスワード変更はハッシュ差し替え＋再起動）
- HTTPS 前提の `Secure` Cookie（LAN HTTP 運用。将来 env で切替可能にする含みは残す）
- CSRF トークン（`SameSite=Lax` ＋ 同一オリジン ＋ ログインは POST のみで初版は許容）
- ログイン試行のレート制限・ロックアウト（将来。単一ユーザー・LAN 内のため初版は割り切り）
