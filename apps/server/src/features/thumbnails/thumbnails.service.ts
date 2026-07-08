import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { classifyPreview } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

/** 入力動画 absIn からサムネイル JPEG を absOut に生成する。失敗時は throw。 */
export type FfmpegRunner = (absIn: string, absOut: string) => Promise<void>;

export interface ThumbnailServiceOptions {
  root: string;
  cacheDir: string;
  /** null は ffmpeg が使えない環境（getThumbnail は UNSUPPORTED を投げる） */
  runFfmpeg: FfmpegRunner | null;
}

export interface ThumbnailService {
  /** キャッシュ済みサムネイル JPEG の絶対パスを返す。未生成なら生成してから返す。 */
  getThumbnail(relPath: string): Promise<string>;
}

export function createThumbnailService(opts: ThumbnailServiceOptions): ThumbnailService {
  const { root, cacheDir, runFfmpeg } = opts;

  async function generate(abs: string, cachePath: string): Promise<string> {
    if (!runFfmpeg) {
      throw new AppError("UNSUPPORTED", "ffmpeg is not available");
    }
    await fs.mkdir(cacheDir, { recursive: true });
    // 同一ファイルシステム内の rename でアトミックに配置するため、一時ファイルはキャッシュディレクトリ内に置く
    const tmp = `${cachePath}.tmp-${randomBytes(6).toString("hex")}`;
    try {
      await runFfmpeg(abs, tmp);
      await fs.rename(tmp, cachePath);
      return cachePath;
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  return {
    async getThumbnail(relPath: string): Promise<string> {
      const abs = safeResolve(root, relPath);
      if (classifyPreview(path.basename(abs)) !== "video") {
        throw new AppError("INVALID_REQUEST", "thumbnail is only supported for videos");
      }
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
      return generate(abs, cachePath);
    },
  };
}
