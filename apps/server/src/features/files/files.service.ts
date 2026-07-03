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
