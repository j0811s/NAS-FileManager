import fs from "node:fs/promises";
import path from "node:path";
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
