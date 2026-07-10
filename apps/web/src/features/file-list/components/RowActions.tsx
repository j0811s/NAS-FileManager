import type { FileEntry } from "@nas-fm/shared";
import { Download, Eye, FolderInput, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";

export function RowActions({
  entry,
  path,
  onPreview,
  onRename,
  onDelete,
  onMove,
}: {
  entry: FileEntry;
  path: string;
  onPreview: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
}) {
  const rel = path ? `${path}/${entry.name}` : entry.name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="操作メニュー">
          <MoreVertical size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entry.type === "file" && (
          <DropdownMenuItem onClick={() => onPreview(entry)}>
            <Eye size={16} className="mr-2" />
            プレビュー
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <a href={api.downloadUrl(rel)} download>
            <Download size={16} className="mr-2" />
            ダウンロード
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(entry)}>
          <Pencil size={16} className="mr-2" />
          名前を変更
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMove(entry)}>
          <FolderInput size={16} className="mr-2" />
          移動
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(entry)}>
          <Trash2 size={16} className="mr-2" />
          削除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
