import { type DragEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useUpload } from "../hooks/useUpload";

export function UploadDropzone({ path }: { path: string }) {
  const { upload, progress, isUploading } = useUpload(path);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      await upload(file);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  return (
    <Card
      className={`flex cursor-pointer flex-col items-center gap-2 border-dashed p-6 text-center ${dragOver ? "bg-accent" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <Upload size={20} />
      <p className="text-sm text-muted-foreground">
        ここにドラッグ＆ドロップ、またはクリックしてアップロード
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="upload-input"
        onChange={(e) => {
          const el = e.target;
          void handleFiles(el.files).then(() => {
            el.value = "";
          });
        }}
      />
      {isUploading && progress !== null && <Progress value={progress} className="w-full" />}
    </Card>
  );
}
