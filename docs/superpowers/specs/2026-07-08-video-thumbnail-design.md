# 動画サムネイルのサーバー側生成 設計

日付: 2026-07-08
ステータス: 承認待ち

## 目的

グリッド表示の動画サムネイルを `<video>` 要素からサーバー生成の静止画（`<img>`）に置き換える。

動機はバグの根治: グリッドの `<video>` がブラウザのハードウェア合成（オーバーレイ面）で描画されると、CSS の z-index / stacking context を無視してプレビューダイアログの `<video>` より上に表示されることがある。グリッドから `<video>` 要素を無くせばこの衝突は構造的に起こり得ない。副次効果として、動画メタデータの都度ダウンロードが不要になり転送量・クライアント負荷も下がる。

## 方針（決定事項）

- 対象は**動画のみ**（画像は現行の `<img src={previewUrl}>` のまま。エンドポイントは汎用的に設計し、画像縮小は将来の拡張とする）
- 生成は**システムの ffmpeg**（Pi は `apt install ffmpeg`、開発 Mac は `brew install ffmpeg`）。npm 依存は追加しない
  - ffmpeg が無い環境ではサムネイル生成をエラーで返し、フロントはアイコン表示にフォールバック（アプリは壊れない）
- **オンデマンド生成＋ディスクキャッシュ**。バックグラウンド一括生成（インデクサ）は YAGNI で採らない
- キャッシュは**アプリ専用ディレクトリ**（環境変数 `THUMB_CACHE_DIR`、未設定時は `<cwd>/.thumb-cache` を自動作成）。NAS_ROOT は汚さない
- `docs/spec.md` の「Pi で ffmpeg トランスコードはしない」は再生用フルトランスコードの話。1 フレーム抽出は負荷が桁違いに軽く、方針と矛盾しない（spec.md に追記して明文化する）

## スコープ外

- 画像の縮小サムネイル生成（sharp）
- キャッシュの GC（キーに mtime を含むため誤ったサムネイルは返らない。孤児は 1 枚 20〜50KB 程度で数千本でも数十 MB のため初版では放置。肥大化したら上限つき GC を後付け）
- 失敗結果のネガティブキャッシュ（IntersectionObserver + `onError` で実質リクエストは 1 回きりのため初版では不要）

## 設計

### サーバー: `thumbnails` feature（新規）

features 構成ルールに沿って `apps/server/src/features/thumbnails/` に 3 ファイル。

**`thumbnails.routes.ts`** — `GET /api/thumbnail?path=<rel>`

- `app.ts` で files と同様にマウントし、既存の JWT ガード（`/api/*`）配下に入れる
- 成功時: `image/jpeg` ボディ + ヘッダ `Cache-Control: private, max-age=86400` / `X-Content-Type-Options: nosniff` / `Content-Disposition: inline`（ブラウザキャッシュで 2 回目以降のリクエスト自体を減らす）

**`thumbnails.service.ts`** — 中核ロジック

1. パス検証は既存 `lib/safe-resolve` を再利用。`classifyPreview(name)`（`@nas-fm/shared`）が `"video"` 以外なら `INVALID_REQUEST`
2. キャッシュキー: `sha256(relPath + mtimeMs + size)` → `<cacheDir>/<hash>.jpg`。ヒットなら即ストリーム返却
3. ミス時に ffmpeg を spawn:
   `ffmpeg -ss 1 -i <abs> -frames:v 1 -vf scale=480:-2 -f image2 <一時ファイル>`
   一時ファイルはキャッシュディレクトリ内（`<hash>.tmp-<random>` 等）に置き、成功後に `rename(2)` でキャッシュパスへ移動（同一ファイルシステム内でのアトミック配置。生成途中の不完全ファイルを配信しない）
   - `-ss 1` は 1 秒未満の動画でも ffmpeg が最終フレームにクランプするため許容（現行 `#t=1` と同じ挙動）
4. **同時生成はセマフォで 2 並列に制限**（Pi 5 / 4GB の保護）。同一キーへの並行リクエストは in-flight の Promise を共有して重複生成を防ぐ
5. ffmpeg プロセスに **15 秒の kill タイマー**（巨大・破損ファイルで Pi が固まるのを防止）
6. ffmpeg 呼び出しは関数として注入可能にし、テストではモックする

**`thumbnails.schema.ts`** — クエリ検証（`files.schema` の `requirePath` パターンを踏襲）

### 設定と ffmpeg 検出

- `lib/config.ts` に `resolveThumbCacheDir()` を追加（`resolveNasRoot` と同パターン: `THUMB_CACHE_DIR` があれば検証して使い、無ければ `<cwd>/.thumb-cache` を自動作成）
- サーバ起動時に `ffmpeg -version` で存在確認。無ければ warn ログを 1 回出し、`/api/thumbnail` はエラーを返す（下記）

### エラー処理

- ffmpeg 不在: `UNSUPPORTED`（HTTP 501）を返す。エラーコードは新規: `packages/shared` の `ApiErrorCode` に `UNSUPPORTED` を追加し、`lib/errors` の `statusOf` に 501 のマッピングを追加（戻り型の union にも 501 を追加）
- ffmpeg 失敗（exit code 非 0。壊れたファイル・音声のみの `.ogg` で映像トラック無し等）: `INVALID_REQUEST`（400）
- タイムアウト（15 秒）: プロセスを kill して `INTERNAL`（500）
- パス不正・非動画・ファイル不存在: 既存の `AppError` 体系（`INVALID_REQUEST` / `NOT_FOUND`）に乗せる
- いずれの場合もフロントは `<img>` の `onError` で `Film` アイコンにフォールバックし、トーストは出さない（現行のグリッドのエラー方針と同じ）

### フロントエンド: FileGrid の Thumbnail 差し替え

- `lib/api.ts` に `thumbnailUrl(path)` を追加（`previewUrl` と同パターン）
- `FileGrid.tsx` の `Thumbnail` の動画分岐を `<video>` から `<img src={api.thumbnailUrl(relPath)} loading="lazy">` に変更。**グリッドから `<video>` 要素が完全に消える**（バグの根治点）
- IntersectionObserver（rootMargin 200px）は**維持**する。`loading="lazy"` だけに頼ると、ブラウザのプリフェッチ距離が広く可視範囲外の生成リクエストが Pi に殺到しうるため、可視近傍に入ってから `<img>` を差し込む現行構造を残す
- `onError` → `Film` アイコン（現行の失敗フォールバックを踏襲）。`videoWidth === 0` 判定はサーバ側で ffmpeg が失敗を返すため不要になり削除
- 読み込み成功したサムネイルの上に、動画と分かる小さな再生アイコン（lucide `Play`）を半透明の丸背景でオーバーレイ表示

### ドキュメント・デプロイ

- `docs/spec.md` 10.2 動画セクションに追記: サムネイルは ffmpeg の 1 フレーム抽出で生成（再生用トランスコードは引き続き行わない）。`THUMB_CACHE_DIR` の説明
- `docs/spec.md` 7 章（デプロイ）に `sudo apt install ffmpeg` を追記。`deploy/nas-fm.service` の `Environment=` に `THUMB_CACHE_DIR` の例を追加（秘密値ではないためユニットファイル直書きで問題ない）

## テスト（Vitest）

- `thumbnails.service.test.ts`（新規）
  - キャッシュヒット時は ffmpeg を呼ばずキャッシュを返す
  - キャッシュミス時は ffmpeg（モック）を呼び、結果をキャッシュに保存して返す
  - 同一キーの並行リクエストで ffmpeg が 1 回しか呼ばれない
  - パストラバーサル・非動画拡張子・不存在ファイルの拒否
  - ffmpeg 失敗（非 0 exit）でエラー、キャッシュに残骸が無い
  - ffmpeg 不在時に `UNSUPPORTED` エラー
- `thumbnails.routes.test.ts`（新規）
  - 未認証は 401
  - 成功時 200 / `image/jpeg` / `Cache-Control` ヘッダ
  - エラーコードのマッピング（400 / 404 / 501）
- `FileGrid.test.tsx`（更新）
  - 動画ファイルは `thumbnailUrl` を src に持つ `img` が描画される（`video` 要素が無いことを検証）
  - `onError` で `Film` アイコンにフォールバック
  - IntersectionObserver 前はアイコン表示（既存の遅延テストを img 版に更新)
- 実 ffmpeg を使う統合テストは CI に ffmpeg が無い可能性があるため入れない。手動検証（実動画でのサムネイル生成・Dialog との重なり解消）はリリース前に `/verify` で実施

## 影響範囲

- 新規: `apps/server/src/features/thumbnails/`（routes / service / schema + テスト）
- 変更: `apps/server/src/app.ts`（マウント）、`apps/server/src/lib/config.ts`（キャッシュディレクトリ解決）、`apps/server/src/lib/errors.ts`（`UNSUPPORTED` → 501）
- 変更: `packages/shared/src/types.ts`（`ApiErrorCode` に `UNSUPPORTED` 追加）
- 変更: `apps/web/src/lib/api.ts`、`apps/web/src/features/file-list/components/FileGrid.tsx` / `FileGrid.test.tsx`
- 変更: `docs/spec.md`、`deploy/nas-fm.service`
- npm 依存追加: なし（システム ffmpeg）
