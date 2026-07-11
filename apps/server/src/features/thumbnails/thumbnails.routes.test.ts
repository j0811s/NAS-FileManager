import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError } from "@nas-fm/shared";
import sharp from "sharp";
import { createApp, type ThumbnailOptions } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";

let root: string;
let cacheDir: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-routes-"));
  cacheDir = await mkdtemp(path.join(tmpdir(), "nasfm-thumb-routes-cache-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(cacheDir, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

function thumbOptions(): ThumbnailOptions {
  return {
    cacheDir,
    runFfmpeg: async (_absIn, absOut) => {
      await writeFile(absOut, "jpeg-data");
    },
  };
}

describe("GET /api/thumbnail", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=mov.mp4");
    expect(res.status).toBe(401);
  });

  it("成功時は 200 + image/jpeg + キャッシュヘッダ", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=mov.mp4", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(await res.text()).toBe("jpeg-data");
  });

  it("path 未指定は 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("動画以外は 400 + INVALID_REQUEST", async () => {
    await writeFile(path.join(root, "a.txt"), "text");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=a.txt", withAuth());
    expect(res.status).toBe(400);
  });

  it("存在しないファイルは 404 + NOT_FOUND", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=missing.mp4", withAuth());
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("パストラバーサルは 400 + PATH_TRAVERSAL", async () => {
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=..%2Fevil.mp4", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("PATH_TRAVERSAL");
  });

  it("thumbnails オプション省略時(ffmpeg 無し)は 501 + UNSUPPORTED", async () => {
    await writeFile(path.join(root, "mov.mp4"), "data");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/thumbnail?path=mov.mp4", withAuth());
    expect(res.status).toBe(501);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("UNSUPPORTED");
  });

  it("size=preview は大きいサイズのサムネイルを返す", async () => {
    await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toFile(path.join(root, "big.jpg"));
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=big.jpg&size=preview", withAuth());
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBeGreaterThan(480);
  });

  it("size が不正な値だと 400 + INVALID_REQUEST", async () => {
    // 破損画像だとsize検証を実装する前から(生成失敗経由で)偶然400になってしまうため、
    // 有効な画像を使い「sizeバリデーションによって」400になることを検証する
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .jpeg()
      .toFile(path.join(root, "a.jpg"));
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=a.jpg&size=huge", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it(".heic は thumbnails.runHeifConvert 未指定(デフォルトnull)なら 501 + UNSUPPORTED", async () => {
    await writeFile(path.join(root, "photo.heic"), "heic-bytes");
    const app = createApp(root, authConfig, undefined, thumbOptions());
    const res = await app.request("/api/thumbnail?path=photo.heic", withAuth());
    expect(res.status).toBe(501);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("UNSUPPORTED");
  });

  it(".heic は runHeifConvert が設定されていれば変換結果を返す", async () => {
    await writeFile(path.join(root, "photo.heic"), "heic-bytes");
    const app = createApp(root, authConfig, undefined, {
      ...thumbOptions(),
      runHeifConvert: async (_absIn, absOut) => {
        await sharp({
          create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
        })
          .jpeg()
          .toFile(absOut);
      },
    });
    const res = await app.request("/api/thumbnail?path=photo.heic", withAuth());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });
});
