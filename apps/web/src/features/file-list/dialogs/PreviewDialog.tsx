import { classifyPreview } from "@nas-fm/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { HeicPreview } from "./HeicPreview";
import { TextPreview } from "./TextPreview";

export function PreviewDialog({
  open,
  onOpenChange,
  name,
  path,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
}) {
  const kind = classifyPreview(name);
  const isHeic = name.toLowerCase().endsWith(".heic");
  const url = api.previewUrl(path);
  const downloadHref = api.downloadUrl(path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>
        {open && kind === "image" && !isHeic && (
          <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
        )}
        {open && kind === "image" && isHeic && (
          <HeicPreview
            key={path}
            name={name}
            url={api.thumbnailUrl(path, "preview")}
            downloadHref={downloadHref}
          />
        )}
        {open && kind === "video" && <video controls src={url} className="max-h-[70vh] w-full" />}
        {open && kind === "text" && <TextPreview url={url} />}
        {open && kind === null && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-muted-foreground">プレビューできません</p>
            <Button asChild>
              <a href={downloadHref} download>
                ダウンロード
              </a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
