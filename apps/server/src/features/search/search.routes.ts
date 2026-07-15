import { Hono } from "hono";
import type { SearchResponse } from "@nas-fm/shared";
import { requireQuery } from "./search.schema";
import { searchFiles } from "./search.service";

export function createSearchRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/search", async (c) => {
    const q = requireQuery(c.req.query("q"));
    const res: SearchResponse = await searchFiles(root, q);
    return c.json(res);
  });

  return app;
}
