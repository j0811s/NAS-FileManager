import { useState } from "react";
import { Button } from "@/components/ui/button";

export function HeicPreview({
  name,
  url,
  downloadHref,
}: {
  name: string;
  url: string;
  downloadHref: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="space-y-3 py-6 text-center">
        <p className="text-muted-foreground">プレビューできません</p>
        <Button asChild>
          <a href={downloadHref} download>
            ダウンロード
          </a>
        </Button>
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      className="max-h-[70vh] w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}
