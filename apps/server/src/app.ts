import { Hono } from "hono";
import type { ApiError } from "@nas-fm/shared";
import { createFilesRoutes } from "./features/files/files.routes";
import { AppError, statusOf } from "./lib/errors";

export function createApp(root: string): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api", createFilesRoutes(root));

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return c.json(body, statusOf(err.code));
    }
    console.error(err);
    const body: ApiError = { error: { code: "INTERNAL", message: "internal server error" } };
    return c.json(body, 500);
  });

  return app;
}
