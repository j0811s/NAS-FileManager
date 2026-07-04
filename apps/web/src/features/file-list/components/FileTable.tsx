import type { FileEntry } from "@nas-fm/shared";
import { File, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SortDir, SortKey } from "../sort";
import { RowActions } from "./RowActions";

function formatSize(entry: FileEntry): string {
  if (entry.type === "dir") return "—";
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 * 1024) return `${(entry.size / 1024).toFixed(1)} KB`;
  return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
}

export function FileTable({
  entries,
  sortKey,
  sortDir,
  onSortChange,
  onOpenDir,
  onPreview,
  path,
  onRename,
  onDelete,
}: {
  entries: FileEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (key: SortKey) => void;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  path: string;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
}) {
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("name")}>
              名前{arrow("name")}
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("size")}>
              サイズ{arrow("size")}
            </Button>
          </TableHead>
          <TableHead>
            <Button variant="ghost" size="sm" onClick={() => onSortChange("mtime")}>
              更新日時{arrow("mtime")}
            </Button>
          </TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.name}>
            <TableCell>
              <span className="flex items-center gap-2">
                {entry.type === "dir" ? <Folder size={16} /> : <File size={16} />}
                {entry.type === "dir" ? (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onOpenDir(entry.name)}
                  >
                    {entry.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => onPreview(entry)}
                  >
                    {entry.name}
                  </button>
                )}
              </span>
            </TableCell>
            <TableCell>{formatSize(entry)}</TableCell>
            <TableCell>{new Date(entry.mtime).toLocaleString("ja-JP")}</TableCell>
            <TableCell>
              <RowActions
                entry={entry}
                path={path}
                onPreview={onPreview}
                onRename={onRename}
                onDelete={onDelete}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
