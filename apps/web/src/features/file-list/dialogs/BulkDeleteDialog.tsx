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

export function BulkDeleteDialog({
  open,
  onOpenChange,
  targetCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  targetCount: number;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>削除の確認</AlertDialogTitle>
          <AlertDialogDescription>
            選択した{targetCount}
            件をゴミ箱に移動します。フォルダの場合は中身ごと移動されます。ゴミ箱の項目は30日後に自動的に完全削除されます。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>削除する</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
