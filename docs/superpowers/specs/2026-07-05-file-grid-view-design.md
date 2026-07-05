# ファイル一覧のグリッド（サムネイル）表示 設計

日付: 2026-07-05
ステータス: 承認待ち

## 目的

ファイル一覧に、既存のテーブル表示に加えてグリッド（サムネイル）表示を追加する。写真の多い NAS で中身を一覧しやすくする。

## 方針（決定事項）

- 表示形式: グリッド（画像・動画はサムネイル、その他はアイコン）
- サムネイル取得: 既存の inline 配信 API（`api.previewUrl()`）をそのまま使う。サーバ変更なし・依存追加なし。転送量は元データそのままだが LAN 内運用なので許容
  - 画像: `<img src>` に直接指定
  - 動画: `<video>` 要素 + メディアフラグメント `#t=1` で **1 秒目のフレーム**を静止表示。preview API が Range 対応（206）済みなのでブラウザのシークがそのまま機能する
- グリッド中のソート: ツールバーにソート用ドロップダウンを表示（テーブルと state 共有）
- **デフォルトはグリッド表示**。localStorage に保存済みの選択があればそちらを優先

## スコープ外

- サーバ側のサムネイル縮小生成・キャッシュ（将来の拡張として後付け可能）
- サーバ側（ffmpeg）での動画フレーム抽出（spec の「Pi で動画トランスコードはしない」方針に従いクライアント側で行う）

## 設計

### 表示切替（FileBrowser）

- `viewMode: "table" | "grid"` state を追加
  - 初期値: `localStorage` のキー `nas-fm:view-mode` から復元。未保存なら `"grid"`
  - 変更時に localStorage へ保存
- ツールバー行（「新しいフォルダ」ボタンの行）に lucide の `List` / `LayoutGrid` アイコンボタンを設置。選択中のモードは `variant` で強調。新規 shadcn コンポーネントは追加しない
- `viewMode` に応じて `FileTable` / `FileGrid` を出し分け

### FileGrid コンポーネント（新規: `features/file-list/components/FileGrid.tsx`）

- レスポンシブ CSS Grid（`grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6`）
- 各カード:
  - 正方形のサムネイル領域 + ファイル名（truncate） + 右上に既存 `RowActions` メニュー（クリックは `stopPropagation`）
  - サムネイル領域は `classifyPreview(name)`（`@nas-fm/shared`）で振り分け:
    - 画像 → `<img src={api.previewUrl(relPath)} loading="lazy">`（`object-cover`、読み込み失敗時は「エラー処理」参照）
    - 動画 → `<video src={api.previewUrl(relPath) + "#t=1"} preload="metadata" muted playsInline>`（再生はせず 1 秒目のフレームを静止表示。`object-cover`・`pointer-events-none` でカードのクリックを妨げない。1 秒未満の動画はブラウザが末尾にクランプするのでそのまま許容。読み込み失敗時は「エラー処理」参照）
    - フォルダ → `Folder` アイコン、その他 → `File` アイコン
- クリック動作はテーブル行と同一: フォルダ = `onOpenDir`、ファイル = `onPreview`
- props はテーブルと同系統（`entries` / `path` / `onOpenDir` / `onPreview` / `onRename` / `onDelete` / `onMove`）。ソート操作はグリッド内には持たない（ツールバー側）

### グリッド時のソートセレクタ

- グリッド表示中のみ、ツールバーに既存 `DropdownMenu` でソートセレクタを表示（名前 / サイズ / 更新日時 × 昇順 / 降順）
- `sortKey` / `sortDir` は `FileBrowser` の既存 state を共有。テーブルに切り替えても並び順は維持

## エラー処理

- サムネイル読み込み失敗時は**種別に応じたアイコン**にフォールバックする（何のファイルかは判別できたままにする）。トーストは出さない（一覧表示の副次要素のため）
  - 画像の `onError` → `Image` アイコン
  - 動画の `onError` → `Film` アイコン（HEVC な `.mov` などブラウザ非対応コーデック・削除直後・権限エラー）
  - 動画の `loadedmetadata` で `videoWidth === 0` → `Film` アイコン（音声のみの `.ogg` など映像トラックが無いケース。エラーは発生せず真っ黒なカードになるのを防ぐ）

## テスト（Vitest）

- `FileGrid.test.tsx`（新規）
  - フォルダカードのクリックで `onOpenDir` が呼ばれる
  - ファイルカードのクリックで `onPreview` が呼ばれる
  - 画像ファイルは `previewUrl` を src に持つ `img[loading="lazy"]` が描画される
  - 動画ファイルは `previewUrl + "#t=1"` を src に持つ `video[preload="metadata"]` が描画される
  - その他ファイル・フォルダはアイコン表示（`img` / `video` が無い）
  - 画像の `onError` でアイコン表示に切り替わる
  - 動画の `onError` / `videoWidth === 0` の `loadedmetadata` でアイコン表示に切り替わる
- `FileBrowser.test.tsx`（追記）
  - 初期表示がグリッドであること（localStorage 未保存時）
  - 切替ボタンでテーブル ⇔ グリッドが切り替わり、選択が localStorage に保存されること

## 影響範囲

- 変更: `apps/web/src/features/file-list/components/FileBrowser.tsx`
- 新規: `apps/web/src/features/file-list/components/FileGrid.tsx` / `FileGrid.test.tsx`
- サーバ・shared・依存関係: 変更なし
