import { Hono } from "hono";
import type { OkResponse, TrashListResponse, TrashRestoreRequest } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { listTrash, purgeTrashEntry, restoreFromTrash } from "./trash.service";

function parseRestoreBody(value: unknown): TrashRestoreRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { id?: unknown }).id !== "string" ||
    (value as { id: string }).id === ""
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { id: string }");
  }
  return { id: (value as { id: string }).id };
}

export function createTrashRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/trash", async (c) => {
    const entries = await listTrash(root);
    const res: TrashListResponse = { entries };
    return c.json(res);
  });

  app.post("/trash/restore", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new AppError("INVALID_REQUEST", "invalid JSON body");
    }
    const { id } = parseRestoreBody(body);
    await restoreFromTrash(root, id);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.delete("/trash", async (c) => {
    const id = c.req.query("id");
    if (!id) {
      throw new AppError("INVALID_REQUEST", "id is required");
    }
    await purgeTrashEntry(root, id);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  return app;
}
