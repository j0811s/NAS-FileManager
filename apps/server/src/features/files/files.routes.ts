import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Hono } from "hono";
import type {
  BulkDeleteResponse,
  BulkDeleteResult,
  ListResponse,
  OkResponse,
} from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";
import { previewContentType } from "../../lib/preview-mime";
import { parseRange } from "../../lib/range";
import { safeResolve } from "../../lib/safe-resolve";
import {
  createFolderZipStream,
  createSelectionZipStream,
  listDir,
  makeDir,
  renamePath,
  resolveDownloadEntry,
  statForDownload,
  uploadFile,
} from "./files.service";
import {
  optionalPath,
  parseBulkPathsBody,
  parseBulkPathsForm,
  parseMkdirBody,
  parseRenameBody,
  requirePath,
} from "./files.schema";
import { moveToTrash } from "../trash/trash.service";

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
    const rel = optionalPath(c.req.query("path"));
    const target = await resolveDownloadEntry(root, rel);

    if (target.kind === "dir") {
      const archive = createFolderZipStream(target.abs);
      c.header("Content-Type", "application/zip");
      c.header("Content-Disposition", contentDisposition(`${target.name}.zip`));
      return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
    }

    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(target.size));
    c.header("Content-Disposition", contentDisposition(target.name));
    return c.body(Readable.toWeb(createReadStream(target.abs)) as unknown as ReadableStream);
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
    c.header("Cache-Control", "private, max-age=86400");

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
    await moveToTrash(root, rel);
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.post("/delete-bulk", async (c) => {
    const { paths } = parseBulkPathsBody(await readJsonBody(() => c.req.json()));
    const results: BulkDeleteResult[] = [];
    for (const p of paths) {
      try {
        await moveToTrash(root, p);
        results.push({ path: p, ok: true });
      } catch (err) {
        results.push({
          path: p,
          ok: false,
          errorCode: err instanceof AppError ? err.code : "INTERNAL",
        });
      }
    }
    const res: BulkDeleteResponse = { results };
    return c.json(res);
  });

  app.post("/download-bulk", async (c) => {
    const { paths } = parseBulkPathsForm(await c.req.parseBody({ all: true }));
    // zip ストリーミング開始前に全パスを検証し、トラバーサル等は 400 として返す
    // （ストリーム開始後は Content-Type / status 200 が確定済みで変更できないため）
    for (const p of paths) {
      safeResolve(root, p);
    }
    const archive = createSelectionZipStream(root, paths);
    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", contentDisposition("選択項目.zip"));
    return c.body(Readable.toWeb(archive) as unknown as ReadableStream);
  });

  return app;
}
