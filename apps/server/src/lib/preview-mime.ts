import mime from "mime-types";
import type { PreviewKind } from "@nas-fm/shared";

/**
 * プレビュー配信時の Content-Type を決定する。
 * text 分類は本来の MIME（.html→text/html 等）を絶対に使わず、常に text/plain を強制する
 * （ブラウザに HTML/SVG を実行させないための XSS 対策。docs/spec.md §10.1 参照）。
 */
export function previewContentType(kind: PreviewKind, filename: string): string {
  if (kind === "text") return "text/plain; charset=utf-8";
  const type = mime.lookup(filename);
  return type || "application/octet-stream";
}
