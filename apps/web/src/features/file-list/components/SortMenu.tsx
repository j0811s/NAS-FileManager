import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SortDir, SortKey } from "../sort";

const SORT_KEY_LABELS: Record<SortKey, string> = {
  name: "名前",
  size: "サイズ",
  mtime: "更新日時",
};

export function SortMenu({
  sortKey,
  sortDir,
  onSortKeyChange,
  onSortDirChange,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSortKeyChange: (key: SortKey) => void;
  onSortDirChange: (dir: SortDir) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown size={16} className="mr-2" />
          {SORT_KEY_LABELS[sortKey]} {sortDir === "asc" ? "▲" : "▼"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sortKey}
          onValueChange={(v) => onSortKeyChange(v as SortKey)}
        >
          <DropdownMenuRadioItem value="name">名前</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="size">サイズ</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="mtime">更新日時</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={sortDir}
          onValueChange={(v) => onSortDirChange(v as SortDir)}
        >
          <DropdownMenuRadioItem value="asc">昇順</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">降順</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
