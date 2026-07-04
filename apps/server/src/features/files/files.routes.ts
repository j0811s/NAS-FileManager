import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Hono } from "hono";
import type { ListResponse, OkResponse } from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { previewContentType } from "../../lib/preview-mime";
import { parseRange } from "../../lib/range";
import {
  listDir,
  makeDir,
  removePath,
  renamePath,
  statForDownload,
  uploadFile,
} from "./files.service";
import { optionalPath, parseMkdirBody, parseRenameBody, requirePath } from "./files.schema";

function contentDisposition(filename: string): string {
  // 日本語等の非 ASCII ファイル名は RFC 5987 の filename* でエンコードする
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function readJsonBody(readJson: () => Promise<unknown>): Promise<unknown> {
  try {
    return await readJson();
  } catch {
    throw new AppError("INVALID_REQUEST", "invalid JSON body");
  }
}

export function createFilesRoutes(root: string): Hono {
  const app = new Hono();

  app.get("/list", async (c) => {
    const rel = optionalPath(c.req.query("path"));
    const entries = await listDir(root, rel);
    const res: ListResponse = { path: rel, entries };
    return c.json(res);
  });

  app.post("/upload", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const overwrite = c.req.query("overwrite") === "true";
    const body = c.req.raw.body;
    if (!body) {
      throw new AppError("INVALID_REQUEST", "request body is required");
    }
    await uploadFile(
      root,
      rel,
      Readable.fromWeb(body as unknown as NodeWebReadableStream),
      overwrite,
    );
    const res: OkResponse = { ok: true };
    return c.json(res, 201);
  });

  app.get("/download", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const { abs, size, name } = await statForDownload(root, rel);
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Content-Disposition", contentDisposition(name));
    return c.body(Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream);
  });

  app.get("/preview", async (c) => {
    const rel = requirePath(c.req.query("path"));
    const { abs, size, name } = await statForDownload(root, rel);
    const kind = classifyPreview(name);
    if (!kind) {
      throw new AppError("INVALID_REQUEST", "unsupported preview type");
    }
    const contentType = previewContentType(kind, name);
    const range = parseRange(c.req.header("range"), size);

    c.header("Content-Type", contentType);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Disposition", "inline");
    c.header("Accept-Ranges", "bytes");

    if (size === 0) {
      c.header("Content-Length", "0");
      return c.body(null, 200);
    }

    if (range.kind === "invalid") {
      c.header("Content-Range", `bytes */${size}`);
      return c.body(null, 416);
    }

    if (range.kind === "partial") {
      c.header("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      c.header("Content-Length", String(range.end - range.start + 1));
      return c.body(
        Readable.toWeb(
          createReadStream(abs, { start: range.start, end: range.end }),
        ) as unknown as ReadableStream,
        206,
      );
    }

    c.header("Content-Length", String(size));
    return c.body(Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream);
  });

  app.post("/mkdir", async (c) => {
    const body = parseMkdirBody(await readJsonBody(() => c.req.json()));
    await makeDir(root, body.path);
    const res: OkResponse = { ok: true };
    return c.json(res, 201);
  });

  app.post("/rename", async (c) => {
    const body = parseRenameBody(await readJsonBody(() => c.req.json()));
    await renamePath(root, body.from, body.to);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.delete("/delete", async (c) => {
    const rel = requirePath(c.req.query("path"));
    await removePath(root, rel);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  return app;
}
