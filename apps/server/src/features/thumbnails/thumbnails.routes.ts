import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { parseVariant, requirePath } from "./thumbnails.schema";
import type { ThumbnailService } from "./thumbnails.service";

export function createThumbnailsRoutes(service: ThumbnailService): Hono {
  const app = new Hono();

  app.get("/thumbnail", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const variant = parseVariant(c.req.query("size"));
    const absJpeg = await service.getThumbnail(rel, variant);
    const st = await stat(absJpeg);
    c.header("Content-Type", "image/jpeg");
    c.header("Content-Length", String(st.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    // mtime 込みのキャッシュキーで URL は不変のため、ブラウザ側キャッシュを1日効かせる
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(
      Readable.toWeb(createReadStream(absJpeg)) as unknown as ReadableStream<Uint8Array>,
    );
  });

  return app;
}
