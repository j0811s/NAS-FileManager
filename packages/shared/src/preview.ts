export type PreviewKind = "image" | "video" | "text";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".heic"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".ogv", ".ogg", ".mov"]);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".log",
  ".csv",
  ".xml",
  ".html",
  ".htm",
  ".svg",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".sh",
  ".sql",
]);

/** ファイル拡張子からプレビュー種別を判定する。拡張子が無い・未対応の場合は null。 */
export function classifyPreview(filename: string): PreviewKind | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return null;
}
