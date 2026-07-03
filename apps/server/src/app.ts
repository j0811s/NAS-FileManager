import { Hono } from "hono";
import type { ApiError } from "@nas-fm/shared";
import { createFilesRoutes } from "./features/files/files.routes";
import { AppError, statusOf } from "./lib/errors";

export function createApp(root: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api", createFilesRoutes(root));

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
