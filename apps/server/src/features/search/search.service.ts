import fs from "node:fs/promises";
import path from "node:path";
import type { SearchResponse } from "@nas-fm/shared";
import { TRASH_DIR_NAME } from "../trash/trash.service";

const MAX_RESULTS = 200;

export async function searchFiles(root: string, query: string): Promise<SearchResponse> {
  const q = query.toLowerCase();
  const entries: SearchResponse["entries"] = [];
  let truncated = false;

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (truncated) return;
    const dirents = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (truncated) return;
      if (dirent.isSymbolicLink()) continue;
      if (relDir === "" && dirent.name === TRASH_DIR_NAME) continue;

      const relPath = relDir ? `${relDir}/${dirent.name}` : dirent.name;
      if (dirent.name.toLowerCase().includes(q)) {
        if (entries.length >= MAX_RESULTS) {
          truncated = true;
          return;
        }
        const absPath = path.join(absDir, dirent.name);
        const st = await fs.stat(absPath).catch(() => null);
        if (st) {
          entries.push({
            name: dirent.name,
            path: relPath,
            type: st.isDirectory() ? "dir" : "file",
            size: st.isDirectory() ? 0 : st.size,
            mtime: Math.trunc(st.mtimeMs),
          });
        }
      }

      if (dirent.isDirectory()) {
        await walk(path.join(absDir, dirent.name), relPath);
      }
    }
  }

  await walk(root, "");
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, truncated };
}
