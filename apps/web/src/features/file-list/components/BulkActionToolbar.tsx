import { Download, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function BulkActionToolbar({
  selectedCount,
  totalCount,
  onSelectAll,
  onExit,
  onDelete,
  onDownload,
  pending,
}: {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onExit: () => void;
  onDelete: () => void;
  onDownload: () => void;
  pending: boolean;
}) {
  const disabled = pending || selectedCount === 0;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="sm" onClick={onExit}>
        <X size={16} className="mr-2" />
        選択解除
      </Button>
      <Checkbox
        aria-label="全選択"
        checked={
          selectedCount === 0 ? false : selectedCount === totalCount ? true : "indeterminate"
        }
        onCheckedChange={onSelectAll}
      />
      <span className="text-sm text-muted-foreground">{selectedCount}件選択中</span>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={onDownload} disabled={disabled}>
          <Download size={16} className="mr-2" />
          ダウンロード
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={disabled}>
          <Trash2 size={16} className="mr-2" />
          削除
        </Button>
      </div>
    </div>
  );
}
