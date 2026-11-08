import { type DragEvent, useRef, useState } from "react";
import { FolderUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type CollectedFile, collectFromDataTransfer, collectFromFileList } from "../collect-files";
import { uploadQueueStore } from "../store/uploadQueueStore";

// React の型定義に無い属性のため spread で渡す（Chrome / Safari / Firefox が対応）
const directoryInputProps = { webkitdirectory: "" } as Record<string, string>;

export function UploadDropzone({ path }: { path: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    uploadQueueStore.enqueue(path, Array.from(files));
  }

  function enqueueOrNotify(collected: CollectedFile[]) {
    if (collected.length === 0) {
      toast.info("アップロードするファイルがありません");
      return;
    }
    uploadQueueStore.enqueueCollected(path, collected);
  }

  function handleFolder(files: FileList | null) {
    if (!files || files.length === 0) return;
    enqueueOrNotify(collectFromFileList(Array.from(files)));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    // DataTransfer はイベント処理後に読めなくなるため、collectFromDataTransfer 内で同期的に取り出す
    collectFromDataTransfer(e.dataTransfer)
      .then(({ files, failed }) => {
        if (failed.length > 0) {
          console.error("ドロップされたファイルの一部を読み込めませんでした", failed);
          toast.error(
            `${failed.length}件のファイルを読み込めませんでした（例: ${failed[0]!.path}）`,
          );
        }
        if (files.length > 0 || failed.length === 0) enqueueOrNotify(files);
      })
      .catch((err: unknown) => {
        console.error("collectFromDataTransfer failed", err);
        toast.error("読み込みに失敗しました");
      });
  }

  return (
    <Card
      className={`flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed p-8 text-center transition-colors ${
        dragOver
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/30 bg-muted hover:bg-accent"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Upload size={32} className={dragOver ? "text-primary" : "text-muted-foreground"} />
      <p className="text-sm font-medium">
        ここにドラッグ＆ドロップ、またはクリックしてアップロード
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation(); // Card のクリック（ファイル選択）を開かない
          folderInputRef.current?.click();
        }}
      >
        <FolderUp size={16} className="mr-2" />
        フォルダを選択
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="upload-input"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...directoryInputProps}
        className="hidden"
        data-testid="upload-folder-input"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handleFolder(e.target.files);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
