import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
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
  /** キー→生成中 Promise。同一ファイルへの並行リクエストで ffmpeg を重複起動しない */
  const inflight = new Map<string, Promise<string>>();
  /** Pi 5 (4GB) 保護のため ffmpeg の同時実行数を制限する */
  const MAX_CONCURRENT = 2;
  let running = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (running < MAX_CONCURRENT) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    running++;
  }

  function release(): void {
    running--;
    waiters.shift()?.();
  }

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
}

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

export interface ProcessRunnerSpec {
  command: string;
  args: (absIn: string, absOut: string) => string[];
  timeoutMs: number;
}

/** 外部コマンドを spawn する FfmpegRunner を作る。タイムアウトで SIGKILL する。 */
export function createProcessRunner(spec: ProcessRunnerSpec): FfmpegRunner {
  return (absIn, absOut) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args(absIn, absOut), { stdio: "ignore" });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new AppError("INTERNAL", "thumbnail generation timed out"));
      }, spec.timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new AppError("UNSUPPORTED", "ffmpeg is not available"));
          return;
        }
        reject(new AppError("INTERNAL", `failed to run ffmpeg: ${String(err)}`));
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        // タイムアウト reject 済みの場合、この resolve/reject は無視される（Promise は一度しか確定しない）
        if (exitCode === 0) {
          resolve();
        } else {
          reject(new AppError("INVALID_REQUEST", "failed to generate thumbnail"));
        }
      });
    });
}

/**
 * 本番用 runner。-ss 1 で 1 秒目のフレームを抽出（1 秒未満の動画は ffmpeg が末尾にクランプ）。
 * 出力の拡張子が .tmp-xxx のため、-c:v mjpeg -f image2 で形式を明示する。
 */
export const ffmpegRunner: FfmpegRunner = createProcessRunner({
  command: "ffmpeg",
  args: (absIn, absOut) => [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    "1",
    "-i",
    absIn,
    "-frames:v",
    "1",
    "-vf",
    "scale=480:-2",
    "-c:v",
    "mjpeg",
    "-f",
    "image2",
    "-y",
    absOut,
  ],
  timeoutMs: 15_000,
});

/** ffmpeg が実行可能かを起動時に確認する用。ハングした場合もサーバー起動をブロックし続けないようタイムアウトする。 */
export function detectFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
