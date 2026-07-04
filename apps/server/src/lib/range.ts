export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "invalid" };

const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;

/**
 * HTTP Range ヘッダを解析する。単一の bytes=start-end / bytes=start- 形式のみ対応し、
 * 複数レンジ（カンマ区切り）や接尾辞形式（bytes=-N）など非対応の形式は "full" として
 * ファイル全体を返す挙動にフォールバックする（HTTP 仕様上、サーバが Range を無視して
 * 全体を返すことは許容されている）。
 */
export function parseRange(rangeHeader: string | null | undefined, size: number): RangeResult {
  if (!rangeHeader) return { kind: "full" };
  const match = RANGE_PATTERN.exec(rangeHeader.trim());
  if (!match) return { kind: "full" };
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Number(match[2]);
  if (start >= size || start > end) {
    return { kind: "invalid" };
  }
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
