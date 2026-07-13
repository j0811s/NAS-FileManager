import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TrashEntry } from "@nas-fm/shared";
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

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function readMeta(metaPath: string): Promise<TrashMeta | null> {
  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<TrashMeta>;
    if (typeof parsed.originalPath !== "string" || typeof parsed.deletedAt !== "number") {
      return null;
    }
    return { originalPath: parsed.originalPath, deletedAt: parsed.deletedAt };
  } catch {
    return null;
  }
}

async function removeTrashFiles(root: string, id: string): Promise<void> {
  const dir = trashRoot(root);
  await fs.rm(path.join(dir, id), { recursive: true, force: true });
  await fs.rm(path.join(dir, `${id}.json`), { force: true });
}

export async function listTrash(root: string): Promise<TrashEntry[]> {
  const dir = trashRoot(root);
  const names = await fs.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw fromFsError(err, TRASH_DIR_NAME);
  });
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));

  const entries: TrashEntry[] = [];
  for (const id of ids) {
    const meta = await readMeta(path.join(dir, `${id}.json`));
    if (!meta) continue;

    if (Date.now() - meta.deletedAt > RETENTION_MS) {
      await removeTrashFiles(root, id);
      continue;
    }

    const itemDir = path.join(dir, id);
    const itemNames = await fs.readdir(itemDir).catch(() => []);
    const name = itemNames[0];
    if (!name) continue;

    const st = await fs.stat(path.join(itemDir, name)).catch(() => null);
    if (!st) continue;

    entries.push({
      id,
      name,
      originalPath: meta.originalPath,
      type: st.isDirectory() ? "dir" : "file",
      size: st.isDirectory() ? 0 : st.size,
      deletedAt: meta.deletedAt,
    });
  }
  entries.sort((a, b) => b.deletedAt - a.deletedAt);
  return entries;
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
