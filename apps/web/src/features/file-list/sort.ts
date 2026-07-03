import type { FileEntry } from "@nas-fm/shared";

export type SortKey = "name" | "size" | "mtime";
export type SortDir = "asc" | "desc";

export function sortEntries(entries: FileEntry[], key: SortKey, dir: SortDir): FileEntry[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    let cmp: number;
    if (key === "name") cmp = a.name.localeCompare(b.name, "ja");
    else if (key === "size") cmp = a.size - b.size;
    else cmp = a.mtime - b.mtime;
    return cmp * factor;
  });
}
