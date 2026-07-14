import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipArchive, type Archiver } from "archiver";
import type { FileEntry } from "@nas-fm/shared";
import { AppError, fromFsError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";
import { TRASH_DIR_NAME } from "../trash/trash.service";

export async function listDir(root: string, relPath: string): Promise<FileEntry[]> {
  const abs = safeResolve(root, relPath);
  let names: string[];
  try {
    names = await fs.readdir(abs);
  } catch (err) {
    throw fromFsError(err, relPath);
  }
  const entries: FileEntry[] = [];
  for (const name of names) {
    if (name === TRASH_DIR_NAME) continue;
    const st = await fs.stat(path.join(abs, name)).catch(() => null);
    if (!st) continue; // 列挙後に消えたエントリはスキップ
    const isDir = st.isDirectory();
    entries.push({
      name,
      size: isDir ? 0 : st.size,
      mtime: Math.trunc(st.mtimeMs),
      type: isDir ? "dir" : "file",
    });
  }
  return entries;
}

export async function makeDir(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("CONFLICT", "root directory already exists");
  }
  try {
    await fs.mkdir(abs);
  } catch (err) {
    throw fromFsError(err, relPath);
  }
}

export async function renamePath(root: string, from: string, to: string): Promise<void> {
  const absFrom = safeResolve(root, from);
  const absTo = safeResolve(root, to);
  if (absFrom === root || absTo === root) {
    throw new AppError("INVALID_REQUEST", "cannot rename the root directory");
  }
  const src = await fs.lstat(absFrom).catch(() => null);
  if (!src) {
    throw new AppError("NOT_FOUND", `not found: ${from}`);
  }
  const dst = await fs.lstat(absTo).catch(() => null);
  if (dst) {
    throw new AppError("CONFLICT", `already exists: ${to}`);
  }
  try {
    await fs.rename(absFrom, absTo);
  } catch (err) {
    throw fromFsError(err, to);
  }
}

export async function uploadFile(
  root: string,
  relPath: string,
  body: Readable,
  overwrite: boolean,
): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "upload path must be a file path");
  }
  const existing = await fs.stat(abs).catch(() => null);
  if (existing?.isDirectory()) {
    throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
  }
  if (existing && !overwrite) {
    throw new AppError("CONFLICT", `already exists: ${relPath}`);
  }
  const parent = path.dirname(abs);
  const parentSt = await fs.stat(parent).catch(() => null);
  if (!parentSt?.isDirectory()) {
    throw new AppError("NOT_FOUND", `parent directory not found: ${relPath}`);
  }
  try {
    // 大容量ファイルをメモリに載せないため、必ず pipeline + createWriteStream で書く
    await pipeline(body, createWriteStream(abs));
  } catch (err) {
    await fs.rm(abs, { force: true }).catch(() => undefined);
    throw fromFsError(err, relPath);
  }
}

export async function statForDownload(
  root: string,
  relPath: string,
): Promise<{ abs: string; size: number; name: string }> {
  const abs = safeResolve(root, relPath);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  if (st.isDirectory()) {
    throw new AppError("IS_A_DIRECTORY", `is a directory: ${relPath}`);
  }
  return { abs, size: st.size, name: path.basename(abs) };
}

export async function resolveDownloadEntry(
  root: string,
  relPath: string,
): Promise<
  | { abs: string; name: string; kind: "file"; size: number }
  | { abs: string; name: string; kind: "dir" }
> {
  const abs = safeResolve(root, relPath);
  const st = await fs.stat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  if (st.isDirectory()) {
    return { abs, name: path.basename(abs), kind: "dir" };
  }
  return { abs, name: path.basename(abs), kind: "file", size: st.size };
}

async function walkAndAppend(archive: Archiver, absDir: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === TRASH_DIR_NAME) continue;
    const absPath = path.join(absDir, entry.name);
    const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkAndAppend(archive, absPath, zipPath);
    } else if (entry.isFile()) {
      archive.file(absPath, { name: zipPath });
    }
  }
}

/** フォルダ配下を無圧縮zipとしてストリーミング生成する。走査は非同期でバックグラウンド実行し、Readable を即座に返す。 */
export function createFolderZipStream(absDir: string): Archiver {
  const archive = new ZipArchive({ store: true });
  const handleError = (err: unknown) => {
    // 走査後に消えたファイル等（ENOENT）は無視して続行。それ以外は fatal として扱う。
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      archive.destroy(err as Error);
    }
  };
  archive.on("warning", handleError);
  archive.on("error", handleError);
  void walkAndAppend(archive, absDir, "").then(
    () => archive.finalize(),
    (err) => archive.destroy(err as Error),
  );
  return archive;
}
