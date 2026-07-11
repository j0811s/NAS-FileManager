import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { classifyPreview } from "@nas-fm/shared";
import { File, Film, Folder, Image as ImageIcon, Play } from "lucide-react";
import { api } from "@/lib/api";
import { RowActions } from "./RowActions";

function Thumbnail({ name, relPath }: { name: string; relPath: string }) {
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const kind = classifyPreview(name);
  const isSvg = name.toLowerCase().endsWith(".svg");
  const needsGeneratedThumbnail = (kind === "image" && !isSvg) || kind === "video";

  // 可視範囲に入るまでサムネイルのリクエストを遅延し、生成リクエストがサーバに殺到しないようにする
  useEffect(() => {
    if (!needsGeneratedThumbnail || visible) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [needsGeneratedThumbnail, visible]);

  if (kind === "image" && isSvg && !failed) {
    return (
      <img
        src={api.previewUrl(relPath)}
        alt={name}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    );
  }
  if (needsGeneratedThumbnail && !failed) {
    return (
      <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
        {visible ? (
          <>
            <img
              src={api.thumbnailUrl(relPath)}
              alt={name}
              loading="lazy"
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
            {kind === "video" && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-background/70 p-1.5">
                  <Play size={16} className="fill-current text-foreground" />
                </span>
              </span>
            )}
          </>
        ) : kind === "video" ? (
          <Film size={40} className="text-muted-foreground" />
        ) : (
          <ImageIcon size={40} className="text-muted-foreground" />
        )}
      </div>
    );
  }
  if (kind === "image") return <ImageIcon size={40} className="text-muted-foreground" />;
  if (kind === "video") return <Film size={40} className="text-muted-foreground" />;
  return <File size={40} className="text-muted-foreground" />;
}

export function FileGrid({
  entries,
  path,
  onOpenDir,
  onPreview,
  onRename,
  onDelete,
  onMove,
}: {
  entries: FileEntry[];
  path: string;
  onOpenDir: (name: string) => void;
  onPreview: (entry: FileEntry) => void;
  onRename: (entry: FileEntry) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (entry: FileEntry) => void;
}) {
  const rel = (name: string) => (path ? `${path}/${name}` : name);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {entries.map((entry) => (
        <div
          key={entry.name}
          className="relative cursor-pointer overflow-hidden rounded-lg border"
          onClick={() => (entry.type === "dir" ? onOpenDir(entry.name) : onPreview(entry))}
        >
          <div className="flex aspect-square items-center justify-center bg-muted">
            {entry.type === "dir" ? (
              <Folder size={40} className="text-muted-foreground" />
            ) : (
              <Thumbnail key={rel(entry.name)} name={entry.name} relPath={rel(entry.name)} />
            )}
          </div>
          <p className="truncate px-2 py-1.5 text-sm" title={entry.name}>
            {entry.name}
          </p>
          <div
            className="absolute top-1 right-1 rounded-md bg-background/80"
            onClick={(e) => e.stopPropagation()}
          >
            <RowActions
              entry={entry}
              path={path}
              onPreview={onPreview}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
