# Phase 3: フロントエンド UI 設計

- 日付: 2026-07-03
- 対象: `apps/web` に Phase 1 のファイル操作 API を使う UI を実装する（`docs/spec.md` §5、`docs/roadmap.md` Phase 3）
- 前提: Phase 1 の API（list/upload/download/mkdir/rename/delete）は完成済み・無認証。Vite dev proxy `/api → localhost:8080` も設定済み

## 1. 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 認証 UI | **Phase 3 から除外**。ログイン画面は Phase 2（認証バックエンド）実装後に回す。今は無認証 API に直結 |
| スコープ | 単一 spec/plan。ファイル操作 UI（一覧・DL・アップロード・行アクション・通知）に集中 |
| サーバ状態管理 | **TanStack Query**（`@tanstack/react-query`）。`useQuery`/`useMutation`＋`invalidateQueries` |
| アップロード進捗 | **XMLHttpRequest** の `upload.onprogress`（fetch は upload 進捗を取得できないため）。生ボディ送信で Phase 1 の `POST /api/upload?path=` に適合 |
| UI ライブラリ | Tailwind CSS v4 + shadcn/ui（Open Code 方式）+ lucide-react |

## 2. 技術スタックとセットアップ

- **Tailwind CSS v4**: `@tailwindcss/vite` プラグイン。CSS-first 設定（`tailwind.config.js` を作らず `src/index.css` の `@theme` で管理）
- **shadcn/ui**: `npx shadcn@latest init` で `components.json` 生成。生成コンポーネントは `src/components/ui/`。既存の `@/*` エイリアス（vite.config.ts / tsconfig.app.json）を利用
- **@tanstack/react-query**: サーバ状態
- **lucide-react**: アイコン
- 依存は `.npmrc`（save-exact / min-release-age=3 / engine-strict）準拠。shadcn/tailwind が導入する Radix・class-variance-authority・clsx・tailwind-merge 等も exact 固定される。バージョン無指定でインストールする

## 3. ディレクトリ構成（features 構成・`.claude/rules/features.md` 準拠）

```
apps/web/src/
├─ index.css                     # Tailwind ディレクティブ + shadcn テーマ変数
├─ main.tsx                      # createRoot（既存）
├─ app/
│  ├─ App.tsx                    # レイアウト（ヘッダ + FileBrowser）
│  └─ providers.tsx              # QueryClientProvider + Sonner Toaster
├─ lib/
│  ├─ api.ts                     # API クライアント（fetch ラッパ + XHR upload）
│  ├─ error-messages.ts          # ApiErrorCode → 日本語メッセージ
│  └─ utils.ts                   # cn()（shadcn 生成）
├─ components/ui/                # shadcn 生成物（button/table/dialog/...）
└─ features/
   ├─ file-list/
   │  ├─ components/
   │  │  ├─ FileBrowser.tsx      # パンくず + テーブル + アクションを束ねる親
   │  │  ├─ FileTable.tsx        # 一覧テーブル（ソート）
   │  │  ├─ Breadcrumbs.tsx      # パンくずナビ
   │  │  └─ RowActions.tsx       # 行の DropdownMenu（DL/rename/delete）
   │  ├─ hooks/
   │  │  ├─ useFileList.ts       # useQuery(['list', path])
   │  │  └─ useFileMutations.ts  # mkdir/rename/delete の useMutation
   │  ├─ dialogs/                # MkdirDialog / RenameDialog / DeleteDialog
   │  └─ index.ts                # 公開境界（FileBrowser を export）
   └─ upload/
      ├─ components/UploadDropzone.tsx  # D&D ドロップ領域 + Progress
      ├─ hooks/useUpload.ts             # XHR アップロード + 進捗 state
      └─ index.ts
```

- feature 間 import は `index.ts` 経由のみ。`file-list` から `upload` を使う場合も公開境界経由
- `lib/api.ts` はフロント専用の API クライアント（feature 横断のため lib に置く）

## 4. データフロー

- **現在ディレクトリ**は `FileBrowser` の React state（`useState<string>("")`。空文字が NAS_ROOT 直下）。パンくず・行のフォルダクリックで更新
- **一覧**: `useFileList(path)` = `useQuery({ queryKey: ["list", path], queryFn: () => api.list(path) })`。ソートは取得後のクライアント側（名前/サイズ/更新日時、ディレクトリ優先）
- **ミューテーション**: `useMutation` の `onSuccess` で `queryClient.invalidateQueries({ queryKey: ["list", path] })` → 一覧自動更新
- **ダウンロード**: `api.downloadUrl(path)` が返す URL を `<a href download>` で開く（ストリーム DL）
- **アップロード**: `useUpload` が XHR で `POST /api/upload?path=<dir>/<filename>` に生ボディ送信、`upload.onprogress` を Progress に反映、完了で `invalidateQueries`

## 5. API クライアント（lib/api.ts）

- `list(path): Promise<ListResponse>`、`mkdir(path)`、`rename(from, to)`、`delete(path)` は `fetch`。非 2xx は `ApiError`（shared 型）を throw
- `downloadUrl(path): string` = `/api/download?path=<encoded>`
- `upload(dir, file, { onProgress }): Promise<void>` は XHR（進捗のため）。`overwrite` は将来対応（初版は既存衝突時 409 をトーストで通知）
- パスは常に `encodeURIComponent`。エラー本文の `ApiError.error.code` を保持したまま throw

## 6. エラーハンドリング

- `lib/error-messages.ts`: `ApiErrorCode → 日本語`（例: `CONFLICT`→「同名の項目が既に存在します」、`NOT_FOUND`→「見つかりませんでした」、`PATH_TRAVERSAL`/`INVALID_REQUEST`→「不正な操作です」、`INTERNAL`→「サーバでエラーが発生しました」）
- ミューテーション失敗: `onError` で `code`→日本語を `Sonner` のエラートースト表示。成功時は成功トースト
- 一覧取得失敗: 画面内にエラー表示＋「再試行」ボタン（`refetch`）

## 7. テスト（Vitest + @testing-library/react）

- `lib/api.ts`: `globalThis.fetch` をモックし、リクエスト URL・メソッド・エラー変換（非 2xx→ApiError）を検証。`downloadUrl` のエンコードを検証
- `lib/error-messages.ts`: 全 `ApiErrorCode` に日本語が対応することを検証
- feature コンポーネント: `QueryClientProvider`（テスト用に retry: false の QueryClient）でラップし、一覧描画・パンくず遷移・ソート・ダイアログ操作・削除確認を検証。API は `lib/api` をモック
- アップロード: XHR 依存を `useUpload`/`api.upload` に隔離し、進捗コールバックとエラー分岐を単体テスト（jsdom は XHR upload progress を完全再現しないため、XHR をモックして `upload.onprogress` を手動発火）

## 8. 非ゴール

- 認証・ログイン画面（Phase 2）
- 静的配信・本番バンドル・systemd（Phase 4）
- プレビュー/Range 配信（Phase 5）
- 複数ファイル同時アップロードの並列制御（初版は順次）、ドラッグでの移動、共有リンク
