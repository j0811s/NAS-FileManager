import { useEffect, useState } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";

const TEXT_PREVIEW_LIMIT = 262144; // 256KiB。先頭のみ取得しブラウザに全読み込みさせないための上限

type TextPreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; text: string; truncated: boolean };

export function TextPreview({ url }: { url: string }) {
  const [state, setState] = useState<TextPreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(url, { headers: { Range: `bytes=0-${TEXT_PREVIEW_LIMIT - 1}` } })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok && res.status !== 206) {
          setState({ status: "error" });
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        setState({ status: "loaded", text, truncated: res.status === 206 });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (state.status === "loading") {
    return <p className="text-muted-foreground">読み込み中…</p>;
  }
  if (state.status === "error") {
    return <p className="text-destructive">テキストの読み込みに失敗しました。</p>;
  }

  // highlight.js は入力の HTML 特殊文字を自身でエスケープしてから span でラップするため、
  // dangerouslySetInnerHTML への注入は安全（highlight.js の標準的な利用方法）。
  const highlighted = hljs.highlightAuto(state.text).value;

  return (
    <div className="max-h-[70vh] overflow-auto">
      {state.truncated && (
        <p className="mb-2 text-sm text-muted-foreground">先頭256KBのみ表示しています。</p>
      )}
      <pre className="text-sm">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}
