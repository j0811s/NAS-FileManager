import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createProcessRunner, createThumbnailService, detectFfmpeg, type FfmpegRunner } from "./thumbnails.service";

let root: string;
let cacheParent: string;
let cacheDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-root-"));
  cacheParent = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-cache-"));
  // 存在しないサブディレクトリを指定し、service が自分で作ることを検証する
  cacheDir = path.join(cacheParent, "cache");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cacheParent, { recursive: true, force: true });
});

/** absOut にダミー JPEG を書き込む成功 runner */
function okRunner() {
  return vi.fn(async (_absIn: string, absOut: string) => {
    await writeFile(absOut, "jpeg-bytes");
  });
}

describe("createThumbnailService.getThumbnail", () => {
  it("動画以外の拡張子は INVALID_REQUEST", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("a.txt")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("../evil.mp4")).rejects.toMatchObject({
      code: "PATH_TRAVERSAL",
    });
  });

  it("存在しないファイルは NOT_FOUND", async () => {
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("missing.mp4")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("ディレクトリは IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "dir.mp4"));
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: okRunner() });
    await expect(svc.getThumbnail("dir.mp4")).rejects.toMatchObject({ code: "IS_A_DIRECTORY" });
  });

  it("runFfmpeg が null（ffmpeg 不在）は UNSUPPORTED", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: null });
    await expect(svc.getThumbnail("mov.mp4")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("キャッシュミス時は runner を呼び、生成結果のパスを返す", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const result = await svc.getThumbnail("mov.mp4");
    expect(result.startsWith(cacheDir + path.sep)).toBe(true);
    expect(result.endsWith(".jpg")).toBe(true);
    expect(await readFile(result, "utf8")).toBe("jpeg-bytes");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(path.join(root, "mov.mp4"), expect.stringContaining(".tmp-"));
  });

  it("2回目はキャッシュヒットし runner を呼ばない", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const first = await svc.getThumbnail("mov.mp4");
    const second = await svc.getThumbnail("mov.mp4");
    expect(second).toBe(first);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("ファイルが更新される(mtime/size 変化)と再生成する", async () => {
    const abs = path.join(root, "mov.mp4");
    await writeFile(abs, "data");
    const runner = okRunner();
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const first = await svc.getThumbnail("mov.mp4");
    await writeFile(abs, "data-updated");
    const second = await svc.getThumbnail("mov.mp4");
    expect(second).not.toBe(first);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("runner 失敗時はエラーが伝播し、キャッシュに残骸を残さない", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const runner: FfmpegRunner = vi.fn(async () => {
      throw new Error("ffmpeg failed");
    });
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    await expect(svc.getThumbnail("mov.mp4")).rejects.toThrow("ffmpeg failed");
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it("同一ファイルへの並行リクエストは生成を1回だけ行い同じ結果を返す", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const runner: FfmpegRunner = vi.fn(async (_absIn, absOut) => {
      await gate;
      await writeFile(absOut, "jpeg-bytes");
    });
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const p1 = svc.getThumbnail("mov.mp4");
    const p2 = svc.getThumbnail("mov.mp4");
    releaseGate();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("生成は最大2並列に制限される", async () => {
    for (const name of ["a.mp4", "b.mp4", "c.mp4"]) {
      await writeFile(path.join(root, name), name);
    }
    let current = 0;
    let max = 0;
    const gates: Array<() => void> = [];
    const runner: FfmpegRunner = async (_absIn, absOut) => {
      current++;
      max = Math.max(max, current);
      await new Promise<void>((resolve) => gates.push(resolve));
      current--;
      await writeFile(absOut, "x");
    };
    const svc = createThumbnailService({ root, cacheDir, runFfmpeg: runner });
    const all = Promise.all([svc.getThumbnail("a.mp4"), svc.getThumbnail("b.mp4"), svc.getThumbnail("c.mp4")]);
    // 2件目までは開始されるが、3件目はセマフォ待ちになる
    await vi.waitFor(() => expect(gates.length).toBe(2));
    expect(current).toBe(2);
    // 1件解放すると3件目が開始される
    gates.shift()!();
    await vi.waitFor(() => expect(gates.length).toBe(2));
    // 残りを解放して完了させる
    gates.shift()!();
    gates.shift()!();
    await all;
    expect(max).toBe(2);
  });

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
});

describe("createProcessRunner", () => {
  it("コマンド成功(exit 0)で resolve し、出力が書かれる", async () => {
    const out = path.join(cacheParent, "out.jpg");
    const runner = createProcessRunner({
      command: process.execPath,
      // node -e <script> <absOut> — 固定 args の代わりにテスト用スクリプトで absOut へ書き込む
      args: (_absIn, absOut) => ["-e", "require('node:fs').writeFileSync(process.argv[1], 'ok')", absOut],
      timeoutMs: 10_000,
    });
    await runner("in.mp4", out);
    expect(await readFile(out, "utf8")).toBe("ok");
  });

  it("コマンド失敗(exit 非0)は INVALID_REQUEST", async () => {
    const runner = createProcessRunner({
      command: process.execPath,
      args: () => ["-e", "process.exit(1)"],
      timeoutMs: 10_000,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("コマンド不在(ENOENT)は UNSUPPORTED", async () => {
    const runner = createProcessRunner({
      command: "nasfm-definitely-missing-command",
      args: () => [],
      timeoutMs: 10_000,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("タイムアウトでプロセスを kill し INTERNAL", async () => {
    const runner = createProcessRunner({
      command: process.execPath,
      args: () => ["-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 200,
    });
    await expect(runner("in.mp4", "out.jpg")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

describe("detectFfmpeg", () => {
  it("resolves within a few seconds even if ffmpeg is slow or absent", async () => {
    const result = await detectFfmpeg();
    expect(typeof result).toBe("boolean");
  });
});
