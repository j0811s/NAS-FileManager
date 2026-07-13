import { Hono } from "hono";
import type { DiskUsageResponse } from "@nas-fm/shared";
import { getDiskUsage } from "./disk-usage.service";

export function createDiskUsageRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/disk-usage", async (c) => {
    const res: DiskUsageResponse = await getDiskUsage(root);
    return c.json(res);
  });

  return app;
}
