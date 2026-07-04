import { describe, expect, it } from "vitest";
import { parseRange } from "./range";

describe("parseRange", () => {
  it("Range ヘッダが無ければ full", () => {
    expect(parseRange(undefined, 1000)).toEqual({ kind: "full" });
    expect(parseRange(null, 1000)).toEqual({ kind: "full" });
  });

  it("bytes=start-end を解析する", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ kind: "partial", start: 100, end: 199 });
  });

  it("bytes=start- （終端省略）はファイル末尾までにする", () => {
    expect(parseRange("bytes=900-", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("end がサイズを超えたら末尾にクランプする", () => {
    expect(parseRange("bytes=0-99999", 1000)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("start がサイズ以上は invalid", () => {
    expect(parseRange("bytes=1000-1001", 1000)).toEqual({ kind: "invalid" });
  });

  it("start > end は invalid", () => {
    expect(parseRange("bytes=100-50", 1000)).toEqual({ kind: "invalid" });
  });

  it("複数レンジ指定は非対応として full にフォールバックする", () => {
    expect(parseRange("bytes=0-99,200-299", 1000)).toEqual({ kind: "full" });
  });

  it("不正な形式は full にフォールバックする", () => {
    expect(parseRange("potato", 1000)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-500", 1000)).toEqual({ kind: "full" });
  });
});
