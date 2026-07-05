import { useEffect, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFileList } from "../hooks/useFileList";
import { Breadcrumbs } from "../components/Breadcrumbs";

export function MoveDialog({
  open,
  onOpenChange,
  entry,
  currentPath,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: FileEntry | null;
  currentPath: string;
  onSubmit: (destPath: string) => void;
}) {
  const [browsePath, setBrowsePath] = useState(currentPath);
  useEffect(() => {
    if (open) setBrowsePath(currentPath);
  }, [open, currentPath]);

  const { data, isLoading } = useFileList(browsePath);
  const dirs = (data?.entries ?? []).filter(
    (e) => e.type === "dir" && !(browsePath === currentPath && entry?.name === e.name),
  );
  const canMoveHere = browsePath !== currentPath;

  function openDir(name: string) {
    setBrowsePath(browsePath ? `${browsePath}/${name}` : name);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>「{entry?.name ?? ""}」を移動</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Breadcrumbs path={browsePath} onNavigate={setBrowsePath} />
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
            {isLoading && <p className="text-sm text-muted-foreground">読み込み中…</p>}
            {!isLoading && dirs.length === 0 && (
              <p className="text-sm text-muted-foreground">フォルダはありません</p>
            )}
            {dirs.map((dir) => (
              <button
                key={dir.name}
                type="button"
                className="flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-accent"
                onClick={() => openDir(dir.name)}
              >
                <Folder size={16} />
                {dir.name}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button disabled={!canMoveHere} onClick={() => onSubmit(browsePath)}>
            ここに移動
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
