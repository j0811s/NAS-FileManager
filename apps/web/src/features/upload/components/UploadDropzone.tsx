import { type DragEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { uploadQueueStore } from "../store/uploadQueueStore";

export function UploadDropzone({ path }: { path: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    uploadQueueStore.enqueue(path, Array.from(files));
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
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
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="upload-input"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </Card>
  );
}
