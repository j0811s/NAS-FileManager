import { useEffect } from "react";
import { classifyPreview } from "@nas-fm/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { HeicPreview } from "./HeicPreview";
import { TextPreview } from "./TextPreview";

export interface PreviewNav {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: { index: number; total: number } | null;
}

export function PreviewDialog({
  open,
  onOpenChange,
  name,
  path,
  nav,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  path: string;
  nav?: PreviewNav;
}) {
  const kind = classifyPreview(name);
  const isHeic = name.toLowerCase().endsWith(".heic");
  const url = api.previewUrl(path);
  const downloadHref = api.downloadUrl(path);

  useEffect(() => {
    if (!open || !nav) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // <video controls> にフォーカスがある場合、ブラウザ標準のシーク操作(←/→)と衝突するため
      // ナビゲーションをスキップする
      if (document.activeElement instanceof HTMLVideoElement) return;
      if (e.key === "ArrowLeft" && nav.hasPrev) nav.onPrev();
      if (e.key === "ArrowRight" && nav.hasNext) nav.onNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, nav]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <DialogTitle className="truncate">{name}</DialogTitle>
            {nav?.position && (
              <span className="shrink-0 text-sm text-muted-foreground">
                {nav.position.index} / {nav.position.total}
              </span>
            )}
          </div>
        </DialogHeader>
        {open && (
          <div className="relative">
            {kind === "image" && !isHeic && (
              <img src={url} alt={name} className="max-h-[70vh] w-full object-contain" />
            )}
            {kind === "image" && isHeic && (
              <HeicPreview
                key={path}
                name={name}
                url={api.thumbnailUrl(path, "preview")}
                downloadHref={downloadHref}
              />
            )}
            {kind === "video" && <video controls src={url} className="max-h-[70vh] w-full" />}
            {kind === "text" && <TextPreview url={url} />}
            {kind === null && (
              <div className="space-y-3 py-6 text-center">
                <p className="text-muted-foreground">プレビューできません</p>
                <Button asChild>
                  <a href={downloadHref} download>
                    ダウンロード
                  </a>
                </Button>
              </div>
            )}
            {nav && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="前のファイル"
                  disabled={!nav.hasPrev}
                  onClick={nav.onPrev}
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="次のファイル"
                  disabled={!nav.hasNext}
                  onClick={nav.onNext}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-background/70 hover:bg-background/90"
                >
                  <ChevronRight />
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
