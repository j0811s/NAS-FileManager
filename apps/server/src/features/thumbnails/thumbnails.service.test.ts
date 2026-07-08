import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbnailService, type FfmpegRunner } from "./thumbnails.service";

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
});
