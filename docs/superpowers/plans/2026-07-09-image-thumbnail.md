# 画像サムネイルのサーバー側生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** グリッドの画像サムネイル（SVG除く）を、動画サムネイルと同じ `GET /api/thumbnail` エンドポイント経由でサーバー生成の縮小JPEGにする。

**Architecture:** 既存の `thumbnails.service.ts`（動画サムネイル基盤: キャッシュ・2並列セマフォ・in-flight共有・アトミック配置）はそのまま流用し、`generate()` 内でメディア種別により ffmpeg（動画）と sharp（画像）を呼び分ける。フロントは `FileGrid.tsx` の `Thumbnail` コンポーネントを画像/動画で共通化する。

**Tech Stack:** `sharp`（画像リサイズ、npm依存として追加）/ Hono / Vitest。

スペック: `docs/superpowers/specs/2026-07-09-image-thumbnail-design.md`

## Global Constraints

- Node `>=24.18.0`。依存は `npm install sharp -w @nas-fm/server`（バージョン無指定）で追加する
- `verbatimModuleSyntax: true` — 型のみの import は必ず `import type`
- フォーマット/リントは oxfmt / oxlint（pre-commitで自動実行）
- コミットは Conventional Commits（接頭辞は英語、本文は日本語）
- テスト実行: `npm run test -w @nas-fm/server -- <file>` / `npm run test -w @nas-fm/web -- <file>`

---

### Task 1: サーバー — `thumbnails.service.ts` に画像サムネイル生成を追加

**Files:**
- Modify: `apps/server/src/features/thumbnails/thumbnails.service.ts`
- Test: `apps/server/src/features/thumbnails/thumbnails.service.test.ts`

**Interfaces:**
- Consumes: 既存の `createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService`（`opts` の形は変更しない）
- Produces: `getThumbnail(relPath)` が画像（SVG除く）でも動作するようになる。`generateImageThumbnail(abs, absOut): Promise<void>`（モジュール内部関数、exportしない）

- [ ] **Step 1: 依存パッケージを追加する**

```bash
npm install sharp -w @nas-fm/server
```

（`sharp` はTypeScript型を同梱しているため `@types/sharp` は不要）

- [ ] **Step 2: 失敗するテストを書く**

`apps/server/src/features/thumbnails/thumbnails.service.test.ts` の先頭 import に追加:

```ts
import sharp from "sharp";
```

既存の `describe("createThumbnailService.getThumbnail", ...)` ブロックの末尾（最後の `it` の後、閉じ `});` の前）に追加:

```ts
  it("画像(jpg)のサムネイルをJPEGで生成する", async () => {
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toFile(path.join(root, "photo.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("photo.jpg");
    expect(result.endsWith(".jpg")).toBe(true);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("画像(png)からもJPEGサムネイルを生成する", async () => {
    await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
    })
      .png()
      .toFile(path.join(root, "photo.png"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("photo.png");
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("SVGはサムネイル対象外で INVALID_REQUEST", async () => {
    await writeFile(path.join(root, "logo.svg"), "<svg></svg>");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    await expect(svc.getThumbnail("logo.svg")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("元画像が480pxより大きい場合、480px以内にリサイズされる", async () => {
    await sharp({
      create: { width: 1000, height: 600, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toFile(path.join(root, "big.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("big.jpg");
    const meta = await sharp(result).metadata();
    expect(meta.width).toBeLessThanOrEqual(480);
    expect(meta.height).toBeLessThanOrEqual(480);
  });

  it("元画像が480pxより小さい場合、拡大されない", async () => {
    await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toFile(path.join(root, "small.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("small.jpg");
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(80);
  });

  it("EXIF回転情報を反映して出力する", async () => {
    // 横長(100x50)だが orientation=6（時計回り90度回転して表示すべき）を付与
    await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(path.join(root, "rotated.jpg"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    const result = await svc.getThumbnail("rotated.jpg");
    const meta = await sharp(result).metadata();
    // 回転後は縦長になっているはず
    expect(meta.width!).toBeLessThan(meta.height!);
  });

  it("破損画像は INVALID_REQUEST になり、キャッシュに残骸を残さない", async () => {
    await writeFile(path.join(root, "broken.jpg"), "not a real jpeg");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    await expect(svc.getThumbnail("broken.jpg")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await readdir(cacheDir)).toEqual([]);
  });
```

補足: 画像のキャッシュヒット（2回目は再生成しない）は既存の動画向けテスト（Task 4「2回目はキャッシュヒットしrunnerを呼ばない」）がすでに `getThumbnail` 共通のキャッシュチェック機構を検証済みのため、画像専用の重複テストは追加しない（メディア種別に関わらず同じコードパスを通るため）。

- [ ] **Step 3: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: FAIL（画像は `INVALID_REQUEST`「thumbnail is only supported for videos」で拒否される）

- [ ] **Step 4: 実装する**

`apps/server/src/features/thumbnails/thumbnails.service.ts` の先頭 import に追加:

```ts
import sharp from "sharp";
```

`generate` 関数のシグネチャと中身を変更（`kind` 引数を追加し、メディア種別で分岐）:

```ts
  async function generate(
    abs: string,
    cachePath: string,
    kind: "video" | "image",
  ): Promise<string> {
    if (kind === "video" && !runFfmpeg) {
      throw new AppError("UNSUPPORTED", "ffmpeg is not available");
    }
    await acquire();
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
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

`getThumbnail` 内の入口チェックと `generate` 呼び出しを変更:

```ts
  return {
    async getThumbnail(relPath: string): Promise<string> {
      const abs = safeResolve(root, relPath);
      const kind = classifyPreview(path.basename(abs));
      const ext = path.extname(abs).toLowerCase();
      const supported = kind === "video" || (kind === "image" && ext !== ".svg");
      if (!supported) {
        throw new AppError("INVALID_REQUEST", "thumbnail is not supported for this file type");
      }
      const mediaKind = kind as "video" | "image";
      const st = await fs.stat(abs).catch(() => null);
      if (!st) {
        throw new AppError("NOT_FOUND", `not found: ${relPath}`);
      }
      if (st.isDirectory()) {
        throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
      }
      // mtime をキーに含めるため、更新されたファイルは自動で別キャッシュになる
      const key = createHash("sha256")
        .update(`${relPath}|${Math.trunc(st.mtimeMs)}|${st.size}`)
        .digest("hex");
      const cachePath = path.join(cacheDir, `${key}.jpg`);
      const cached = await fs.stat(cachePath).catch(() => null);
      if (cached) {
        return cachePath;
      }
      const existing = inflight.get(key);
      if (existing) {
        return existing;
      }
      const promise = generate(abs, cachePath, mediaKind).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
```

`createThumbnailService` 関数の閉じ `}`（現在96行目）の直後に、新しいモジュール内部関数を追加:

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

- [ ] **Step 5: テストが通ることを確認**

Run: `npm run test -w @nas-fm/server -- src/features/thumbnails/thumbnails.service.test.ts`
Expected: PASS（7テスト追加、既存分含め全件）

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add apps/server/package.json package-lock.json apps/server/src/features/thumbnails/thumbnails.service.ts apps/server/src/features/thumbnails/thumbnails.service.test.ts
git commit -m "feat: サムネイル生成に画像(sharp)対応を追加"
```

---

### Task 2: フロントエンド — `Thumbnail` コンポーネントを画像/動画で共通化

**Files:**
- Modify: `apps/web/src/features/file-list/components/FileGrid.tsx`
- Test: `apps/web/src/features/file-list/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `api.thumbnailUrl(path)` / `api.previewUrl(path)`（既存、変更なし）
- Produces: SVG以外の画像も動画と同じ遅延読み込みゲート＋`thumbnailUrl`を使うようになる

- [ ] **Step 1: 既存テストを更新し、失敗するテストを追加する**

`apps/web/src/features/file-list/components/FileGrid.test.tsx` の `entries` 配列に `logo.svg` を追加:

```ts
const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "cat.jpg", size: 100, mtime: 1700000000000, type: "file" },
  { name: "mov.mp4", size: 200, mtime: 1700000000000, type: "file" },
  { name: "doc.pdf", size: 300, mtime: 1700000000000, type: "file" },
  { name: "logo.svg", size: 50, mtime: 1700000000000, type: "file" },
];
```

以下の2テストを**削除**:

```ts
  it("画像は previewUrl を src に持つ遅延読み込み img を描画する", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=cat.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("サブフォルダ内では path を含めた previewUrl になる", () => {
    renderGrid({ path: "photos" });
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=photos%2Fcat.jpg");
  });
```

同じ場所に以下を**追加**:

```ts
  it("画像は thumbnailUrl を src に持つ遅延読み込み img を描画する", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=cat.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("サブフォルダ内では path を含めた thumbnailUrl になる", () => {
    renderGrid({ path: "photos" });
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=photos%2Fcat.jpg");
  });

  it("SVGはサムネイル生成せず previewUrl を直接使う", () => {
    renderGrid();
    const img = screen.getByAltText("logo.svg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=logo.svg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("画像サムネイルには再生アイコンを重ねない", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.parentElement?.querySelector(".lucide-play")).toBeNull();
  });

  it("画像はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)", () => {
    let capturedCallback: IntersectionObserverCallback | undefined;
    class ManualIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        capturedCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);

    renderGrid({ entries: [entries[1]] });
    expect(screen.queryByAltText("cat.jpg")).not.toBeInTheDocument();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByAltText("cat.jpg")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
```

既存の「動画はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)」テストを、複数コンポーネントが同時にIntersectionObserverを生成するようになったことで `capturedCallback` の対象が曖昧にならないよう、`renderGrid()` を `renderGrid({ entries: [entries[2]] })` に変更（mov.mp4のみに限定）:

```ts
  it("動画はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)", () => {
    let capturedCallback: IntersectionObserverCallback | undefined;
    class ManualIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        capturedCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);

    renderGrid({ entries: [entries[2]] });
    expect(screen.queryByAltText("mov.mp4")).not.toBeInTheDocument();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByAltText("mov.mp4")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test -w @nas-fm/web -- src/features/file-list/components/FileGrid.test.tsx`
Expected: FAIL（画像がまだ `previewUrl` を使っている、SVGの新規テストが失敗する等）

- [ ] **Step 3: 実装する**

`apps/web/src/features/file-list/components/FileGrid.tsx` の `Thumbnail` コンポーネント全体を置き換え:

```tsx
function Thumbnail({ name, relPath }: { name: string; relPath: string }) {
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const kind = classifyPreview(name);
  const isSvg = name.toLowerCase().endsWith(".svg");
  const needsGeneratedThumbnail = (kind === "image" && !isSvg) || kind === "video";

  // 可視範囲に入るまでサムネイルのリクエストを遅延し、生成リクエストがサーバに殺到しないようにする
  useEffect(() => {
    if (!needsGeneratedThumbnail || visible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [needsGeneratedThumbnail, visible]);

  if (kind === "image" && isSvg && !failed) {
    return (
      <img
        src={api.previewUrl(relPath)}
        alt={name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (needsGeneratedThumbnail && !failed) {
    return (
      <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
        {visible ? (
          <>
            <img
              src={api.thumbnailUrl(relPath)}
              alt={name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
            {kind === "video" && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-background/70 p-1.5">
                  <Play size={16} className="fill-current text-foreground" />
                </span>
              </span>
            )}
          </>
        ) : kind === "video" ? (
          <Film size={40} className="text-muted-foreground" />
        ) : (
          <ImageIcon size={40} className="text-muted-foreground" />
        )}
      </div>
    );
  }
  if (kind === "image") return <ImageIcon size={40} className="text-muted-foreground" />;
  if (kind === "video") return <Film size={40} className="text-muted-foreground" />;
  return <File size={40} className="text-muted-foreground" />;
}
```

`FileGrid` 本体（`export function FileGrid`）は変更しない。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test -w @nas-fm/web -- src/features/file-list/components/FileGrid.test.tsx`
Expected: PASS

Run: `npm run test -w @nas-fm/web`
Expected: PASS（全件、回帰なし）

- [ ] **Step 5: コミット**

```bash
git add apps/web/src/features/file-list/components/FileGrid.tsx apps/web/src/features/file-list/components/FileGrid.test.tsx
git commit -m "feat: 画像サムネイルもサーバー生成(sharp)に切り替え、Thumbnailコンポーネントを画像/動画で共通化"
```

---

### Task 3: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全ワークスペースの検証コマンド**

```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

Expected: エラーなし（`packages/shared` に既存の無関係な `.svg` テスト失敗が1件ある場合はこの機能の変更によるものではないため無視してよい。それ以外の失敗があってはならない）

- [ ] **Step 2: 実動作の確認**

1. `npm run dev` で起動し、ブラウザでログイン
2. 大きめの写真（1MB以上、480pxより大きい解像度）を含むフォルダを表示し、グリッドで縮小サムネイルが表示されることを確認
3. スマホで撮影した縦向き写真（EXIF回転情報付き）がある場合、グリッド上で正しい向きに表示されることを確認
4. SVGファイルがある場合、引き続き元画像が直接表示されることを確認（劣化しない）
5. `THUMB_CACHE_DIR`（開発時は `apps/server/.thumb-cache`）に画像分の `<hash>.jpg` が生成されていることを確認
6. ブラウザの DevTools Network タブで、実際に転送されるサムネイルのファイルサイズが元画像より大幅に小さいことを確認

- [ ] **Step 3: 完了処理**

superpowers:finishing-a-development-branch スキルに従って完了判断する（main 直接運用のため、コミットのみで完結。push はユーザー判断）。
