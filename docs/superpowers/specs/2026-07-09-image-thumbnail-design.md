# 画像サムネイルのサーバー側生成 設計

日付: 2026-07-09
ステータス: 承認待ち

## 目的

グリッド表示の画像サムネイルは現在 `<img src={api.previewUrl(relPath)}>` で元画像をフルサイズのまま表示している。写真が多いNASでは一覧表示のたびに大きな画像を転送・デコードすることになり無駄が大きい。動画サムネイル機能（`docs/superpowers/specs/2026-07-08-video-thumbnail-design.md`）で作った「サーバー側生成＋ディスクキャッシュ＋同時実行制限」の基盤を画像にも拡張し、縮小版JPEGを返すようにする。

## 方針（決定事項）

- **SVGは対象外**。ベクタ形式ですでに軽量なため、従来通り `/api/preview` を直接表示する。サムネイル生成対象は jpg/jpeg/png/webp/gif
- グリッドの**遅延読み込みゲート（IntersectionObserver）を画像にも統一適用**し、`FileGrid.tsx` の `Thumbnail` コンポーネントを画像/動画で共通化する。画像もサーバー側生成コストが発生するようになるため、動画と同じ「可視範囲に入ってから生成リクエストを送る」保護が必要
- **サムネイル生成の同時実行制限は動画と共有**（合計で最大2並列）。メディア種別で分けず、`thumbnails.service.ts` の既存セマフォ・in-flight共有をそのまま両方に効かせる
- リサイズは **sharp**、出力は動画サムネイルと統一して**JPEG固定**（`<hash>.jpg`の命名パターンを維持）
- EXIFの回転情報を見て自動補正する（`.rotate()`、引数無し）。スマホ写真の横倒れ防止
- 480px以内にリサイズ（動画サムネイルの `scale=480:-2` と揃える）、`withoutEnlargement` で元画像より小さい場合は拡大しない
- デコンプレッションボム等の対策は sharp/libvips のデフォルトのピクセル数上限に委ねる。追加のタイムアウト機構は導入しない（sharpは十分高速で、ffmpegのような外部プロセスのハングとは性質が異なるためYAGNI）
- sharp が使えない状況（ffmpeg のように「システムにインストールされていない」ケース）は想定しない。sharp は npm 依存でビルドできれば必ず使えるため、動画の `UNSUPPORTED`/`detectFfmpeg` に相当する分岐は画像には作らない

## スコープ外

- HEIC対応（既存の割り切り通り、DLのみ）
- アニメーションGIFの動き保持（先頭フレームの静止画としてサムネイル化。動画の「静止画+再生アイコン」と同様の扱いで、GIFにも再生アイコン等の特別なUIは付けない）
- サムネイルサイズ・品質のユーザー設定

## 設計

### `thumbnails.service.ts` の変更（既存ファイルへの追記）

**入口チェックの拡張**（`getThumbnail` 内）

現在:
```ts
if (classifyPreview(path.basename(abs)) !== "video") {
  throw new AppError("INVALID_REQUEST", "thumbnail is only supported for videos");
}
```

変更後、動画または「画像かつ拡張子が `.svg` でない」場合のみ許可:
```ts
const kind = classifyPreview(path.basename(abs));
const ext = path.extname(abs).toLowerCase();
const supported = kind === "video" || (kind === "image" && ext !== ".svg");
if (!supported) {
  throw new AppError("INVALID_REQUEST", "thumbnail is not supported for this file type");
}
```

**`generate()` 内でメディア種別により分岐**

```ts
async function generate(abs: string, cachePath: string): Promise<string> {
  const kind = classifyPreview(path.basename(abs));
  if (kind === "video" && !runFfmpeg) {
    throw new AppError("UNSUPPORTED", "ffmpeg is not available");
  }
  await acquire();
  const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    if (kind === "video") {
      await runFfmpeg!(abs, tmp);
    } else {
      await generateImageThumbnail(abs, tmp);
    }
    await fs.rename(tmp, cachePath);
    return cachePath;
  } finally {
    release();
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}
```

`ThumbnailServiceOptions`（`root` / `cacheDir` / `runFfmpeg`）は**変更しない**。sharp はインジェクション（テスト用の差し替え）が不要なため、ffmpegのような `FfmpegRunner`型の注入口を新設しない。

**`generateImageThumbnail`（新規関数）**

```ts
async function generateImageThumbnail(abs: string, absOut: string): Promise<void> {
  try {
    await sharp(abs)
      .rotate()
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(absOut);
  } catch {
    throw new AppError("INVALID_REQUEST", "failed to generate thumbnail");
  }
}
```

破損画像・非対応カラープロファイル等、sharp が投げるあらゆるエラーは動画のffmpeg失敗時と同じ `INVALID_REQUEST` にマップする（ルート層のエラー処理は無変更で済む）。

キャッシュキー（`sha256(relPath|mtime|size)`）・2並列セマフォ・in-flight共有・アトミック配置（`.tmp-*` → `rename`）は既存のまま**無変更で両メディア種別に効く**。

### フロントエンド: `FileGrid.tsx` の `Thumbnail` 共通化

現在は画像分岐（プレーンな `loading="lazy"` の `<img>`）と動画分岐（IntersectionObserverゲート付き）が別ロジック。以下のように統合する:

- `isSvg = name.toLowerCase().endsWith(".svg")` を判定
- `needsGeneratedThumbnail = (kind === "image" && !isSvg) || kind === "video"` を判定
- SVGは従来通り `api.previewUrl(relPath)` を `loading="lazy"` で直接表示（生成なし、ゲートなし）
- `needsGeneratedThumbnail` な場合（画像・動画共通）:
  - 既存の動画用IntersectionObserverロジック（rootMargin 200px、可視になったら`visible`を立てて`observer.disconnect()`）をそのまま共通化して使う
  - `visible` になるまでは種別に応じたアイコン（`ImageIcon` / `Film`）を表示
  - `visible` になったら `<img src={api.thumbnailUrl(relPath)} loading="lazy" onError={...}>` を表示
  - 動画のみ、その上に再生アイコンのオーバーレイを追加表示（画像には付けない）
  - `onError` は種別に応じたアイコンへのフォールバックのまま維持
- `api.thumbnailUrl()` は動画サムネイル実装時に追加済みのものをそのまま画像にも使う。フロント側の新規APIメソッドは不要

### 依存関係

- `sharp`（画像リサイズ）— `apps/server` の dependencies に追加。Raspberry Pi の Linux ARM64 向けにプリビルドバイナリが提供されている
- テスト専用の追加依存は不要。`sharp({ create: { width, height, channels, background } })` で合成テスト画像を生成し、`sharp(outputPath).metadata()` でリサイズ結果（幅・高さ）を検証できる

## テスト（Vitest）

- `thumbnails.service.test.ts`（追記）
  - 画像（jpg/png/webp/gif）のサムネイル生成・キャッシュヒット・mtime変化での再生成（既存の動画テストと同型）
  - SVGは `INVALID_REQUEST` で拒否される
  - 元画像が480pxより大きい場合、生成結果が480px以内にリサイズされる（`sharp(output).metadata()` で検証）
  - 元画像が480pxより小さい場合、拡大されない（`withoutEnlargement`の確認）
  - EXIF回転情報を持つ画像で、出力が正しい向きになる（sharpで意図的にEXIF回転タグ付きの合成画像を作り検証）
  - 破損画像（不正なバイト列を書き込んだファイル）で `INVALID_REQUEST` になり、キャッシュに残骸を残さない
  - 画像・動画混在の同時実行を新たにテストする必要はない。セマフォ（`acquire`/`release`）は `generate()` 内で種別に関わらず同じ箇所を通るため、既存の動画向け並列テスト（Task 4）がすでに機構自体を検証済み。sharpの実処理は`FfmpegRunner`のような差し替え可能なゲートを持たないため、意図的にブロッキングさせるテストは書かない（実装時は `generateImageThumbnail` 呼び出しが `acquire()`/`release()` の内側にあることをコードレビューで確認すれば十分）
- `FileGrid.test.tsx`（更新）
  - 画像（SVG以外）は `thumbnailUrl` を使い、IntersectionObserverのゲートを通ること（動画と同じ検証パターン）
  - SVGは引き続き `previewUrl` を直接使い、ゲートを通らず即表示されること
  - 画像の `onError` で `ImageIcon` にフォールバックすること（再生アイコンは表示されないこと）

## 影響範囲

- 変更: `apps/server/src/features/thumbnails/thumbnails.service.ts`（入口チェック拡張・`generate()`分岐・`generateImageThumbnail`追加）
- 変更: `apps/web/src/features/file-list/components/FileGrid.tsx`（`Thumbnail`コンポーネントの画像/動画共通化）
- 依存追加: `sharp`（`@nas-fm/server` の dependencies）
- 新規 feature ディレクトリ・新規エンドポイント: なし（既存の `GET /api/thumbnail` をそのまま両メディア種別で共用）
