import { useState } from "react";
import type { TrashEntry } from "@nas-fm/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTrash } from "../hooks/useTrash";
import { useTrashMutations } from "../hooks/useTrashMutations";

function formatSize(entry: TrashEntry): string {
  if (entry.type === "dir") return "—";
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 * 1024) return `${(entry.size / 1024).toFixed(1)} KB`;
  if (entry.size < 1024 * 1024 * 1024) return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
  return `${(entry.size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function TrashDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data } = useTrash();
  const { restore, purge } = useTrashMutations();
  const [purgeTarget, setPurgeTarget] = useState<TrashEntry | null>(null);
  const entries = data?.entries ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>ゴミ箱</DialogTitle>
          </DialogHeader>
          {entries.length === 0 && <p className="text-sm text-muted-foreground">ゴミ箱は空です</p>}
          {entries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>元の場所</TableHead>
                  <TableHead>サイズ</TableHead>
                  <TableHead>削除日時</TableHead>
                  <TableHead className="w-48" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.name}</TableCell>
                    <TableCell>{entry.originalPath}</TableCell>
                    <TableCell>{formatSize(entry)}</TableCell>
                    <TableCell>{new Date(entry.deletedAt).toLocaleString("ja-JP")}</TableCell>
                    <TableCell className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => restore.mutate(entry.id)}>
                        復元
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setPurgeTarget(entry)}>
                        完全に削除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={purgeTarget !== null} onOpenChange={(v) => !v && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>完全に削除しますか</AlertDialogTitle>
            <AlertDialogDescription>
              「{purgeTarget?.name}」を完全に削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (purgeTarget) purge.mutate(purgeTarget.id);
                setPurgeTarget(null);
              }}
            >
              完全に削除する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
