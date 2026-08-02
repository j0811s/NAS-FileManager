import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useUploadQueue } from "../hooks/useUploadQueue";
import { UploadTraySheetContent } from "./UploadTraySheet";

export function UploadTray() {
  const items = useUploadQueue();
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const activeCount = items.filter(
    (it) => it.status === "pending" || it.status === "uploading",
  ).length;
  const doneCount = items.filter((it) => it.status === "done").length;
  const errorCount = items.filter((it) => it.status === "error").length;
  const percent = Math.round((doneCount / items.length) * 100);

  const label =
    activeCount > 0
      ? `アップロード中 ${doneCount}/${items.length}件 (${percent}%)`
      : doneCount === 0
        ? `アップロード失敗 ${errorCount}件`
        : errorCount > 0
          ? `アップロード完了 ${doneCount}件（${errorCount}件失敗）`
          : `アップロード完了 ${doneCount}件`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed right-4 bottom-4 z-40 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
        >
          {label}
        </button>
      </SheetTrigger>
      <SheetContent>
        <UploadTraySheetContent items={items} />
      </SheetContent>
    </Sheet>
  );
}
