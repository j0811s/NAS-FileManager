import { Check, File, RotateCcw, X } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { errorMessage } from "@/lib/error-messages";
import { type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";

function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!url || broken) {
    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded bg-muted">
        <File size={18} className="text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className="size-10 shrink-0 rounded object-cover"
      onError={() => setBroken(true)}
    />
  );
}

const UploadTrayItemRow = memo(function UploadTrayItemRow({ item }: { item: UploadItem }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Thumbnail file={item.file} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{item.file.name}</p>
        {item.status === "pending" && <p className="text-xs text-muted-foreground">待機中</p>}
        {item.status === "uploading" && <Progress value={item.progress} className="mt-1 h-1.5" />}
        {item.status === "error" && (
          <p className="text-xs text-destructive">{errorMessage(item.errorCode ?? "INTERNAL")}</p>
        )}
      </div>
      {item.status === "done" && <Check size={18} className="shrink-0 text-primary" />}
      {item.status === "error" && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => uploadQueueStore.retry(item.id)}
          aria-label="再試行"
        >
          <RotateCcw size={16} />
        </Button>
      )}
      {(item.status === "done" || item.status === "error") && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => uploadQueueStore.dismiss(item.id)}
          aria-label="削除"
        >
          <X size={16} />
        </Button>
      )}
    </li>
  );
});

export function UploadTraySheetContent({ items }: { items: UploadItem[] }) {
  const hasCompleted = items.some((it) => it.status === "done");
  return (
    <>
      <SheetHeader>
        <SheetTitle>アップロード状況</SheetTitle>
        <SheetDescription>
          アップロード中はタブを閉じたり他のアプリに切り替えないでください
        </SheetDescription>
      </SheetHeader>
      <ul className="max-h-96 overflow-y-auto px-4">
        {items.map((item) => (
          <UploadTrayItemRow key={item.id} item={item} />
        ))}
      </ul>
      {hasCompleted && (
        <div className="px-4 pb-4">
          <Button variant="outline" onClick={() => uploadQueueStore.clearCompleted()}>
            完了済みをクリア
          </Button>
        </div>
      )}
    </>
  );
}
