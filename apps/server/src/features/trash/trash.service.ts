import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError, fromFsError } from "../../lib/errors";
import { safeResolve } from "../../lib/safe-resolve";

export const TRASH_DIR_NAME = ".trash";

function trashRoot(root: string): string {
  return path.join(root, TRASH_DIR_NAME);
}

interface TrashMeta {
  originalPath: string;
  deletedAt: number;
}

export async function moveToTrash(root: string, relPath: string): Promise<void> {
  const abs = safeResolve(root, relPath);
  if (abs === root) {
    throw new AppError("INVALID_REQUEST", "cannot delete the root directory");
  }
  const st = await fs.lstat(abs).catch(() => null);
  if (!st) {
    throw new AppError("NOT_FOUND", `not found: ${relPath}`);
  }

  const id = randomUUID();
  const itemDir = path.join(trashRoot(root), id);
  await fs.mkdir(itemDir, { recursive: true });
  const basename = path.basename(abs);
  try {
    await fs.rename(abs, path.join(itemDir, basename));
  } catch (err) {
    await fs.rm(itemDir, { recursive: true, force: true }).catch(() => undefined);
    throw fromFsError(err, relPath);
  }
  const meta: TrashMeta = { originalPath: relPath, deletedAt: Date.now() };
  await fs.writeFile(path.join(trashRoot(root), `${id}.json`), JSON.stringify(meta));
}
