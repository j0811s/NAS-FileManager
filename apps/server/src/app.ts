import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ApiError } from "@nas-fm/shared";
import type { AuthConfig } from "./lib/auth-config";
import { AppError, statusOf } from "./lib/errors";
import { createAuthRoutes } from "./features/auth/auth.routes";
import { requireAuth } from "./features/auth/auth.middleware";
import { createFilesRoutes } from "./features/files/files.routes";
import { createDiskUsageRoutes } from "./features/disk-usage/disk-usage.routes";
import { createThumbnailsRoutes } from "./features/thumbnails/thumbnails.routes";
import {
  createThumbnailService,
  type FfmpegRunner,
  type HeifRunner,
} from "./features/thumbnails/thumbnails.service";

export interface ThumbnailOptions {
  cacheDir: string;
  runFfmpeg: FfmpegRunner | null;
  runHeifConvert?: HeifRunner | null;
}

export function createApp(
  root: string,
  authConfig: AuthConfig,
  staticDir?: string,
  thumbnails?: ThumbnailOptions,
): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  // 認証ルート（login は公開）。files のガードより先に登録する。
  app.route("/api/auth", createAuthRoutes(authConfig));

  // /api/auth/* を除いた /api/* を JWT で保護する。
  // （files を /api にマウントすると /api/auth と接頭辞が重なるため、ここで明示的に除外する）
  const guard = requireAuth(authConfig);
  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) {
      return next();
    }
    return guard(c, next);
  });

  app.route("/api", createFilesRoutes(root));
  app.route("/api", createDiskUsageRoutes(root));

  // thumbnails 未指定（テスト等）は「ffmpeg 無し」として動かす。
  // runFfmpeg が null の間はキャッシュへの書き込みが発生しないため、cacheDir のデフォルト値が使われることはない。
  const thumbnailService = createThumbnailService({
    root,
    cacheDir: thumbnails?.cacheDir ?? path.join(root, ".thumb-cache"),
    runFfmpeg: thumbnails?.runFfmpeg ?? null,
    runHeifConvert: thumbnails?.runHeifConvert ?? null,
  });
  app.route("/api", createThumbnailsRoutes(thumbnailService));

  // web のビルド成果物を配信する（本番のみ。staticDir が無ければ静的配信自体を行わない）。
  // /health・/api/* はここより前に登録済みのハンドラで終端するため、この後段には落ちてこない。
  if (staticDir) {
    app.use("/*", serveStatic({ root: staticDir }));
  }

  app.onError((err, c) => {
    if (err instanceof AppError && err.code !== "INTERNAL") {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return c.json(body, statusOf(err.code));
    }
    // 想定外の fs エラー（fromFsError の INTERNAL 分岐）や AppError 以外の例外はここに来る。
    // 内部詳細（パス・errno 等）をレスポンスに含めず、サーバ側ログにのみ残す。
    console.error(err);
    const body: ApiError = { error: { code: "INTERNAL", message: "internal server error" } };
    return c.json(body, 500);
  });

  return app;
}
