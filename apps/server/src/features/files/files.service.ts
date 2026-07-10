import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FileEntry } from "@nas-fm/shared";
import { AppError, fromFsError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

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

export async function removePath(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "cannot delete the root directory");
  }
  const st = await fs.lstat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }
  await fs.rm(abs, { recursive: true });
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
