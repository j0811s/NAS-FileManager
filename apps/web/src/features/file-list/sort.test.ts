import type { FileEntry } from "@nas-fm/shared";
import { describe, expect, it } from "vitest";
import { sortEntries } from "./sort";

const entries: FileEntry[] = [
  { name: "b.txt", size: 30, mtime: 200, type: "file" },
  { name: "sub", size: 0, mtime: 100, type: "dir" },
  { name: "a.txt", size: 10, mtime: 300, type: "file" },
];

describe("sortEntries", () => {
  it("ディレクトリを常に先頭にする", () => {
    const r = sortEntries(entries, "name", "asc");
    expect(r[0].type).toBe("dir");
  });

  it("名前昇順（ディレクトリ優先）", () => {
    expect(sortEntries(entries, "name", "asc").map((e) => e.name)).toEqual(["sub", "a.txt", "b.txt"]);
  });

  it("サイズ降順でもディレクトリは先頭", () => {
    const r = sortEntries(entries, "size", "desc");
    expect(r[0].name).toBe("sub");
    expect(r.slice(1).map((e) => e.name)).toEqual(["b.txt", "a.txt"]);
  });

  it("元配列を破壊しない", () => {
    const copy = [...entries];
    sortEntries(entries, "name", "asc");
    expect(entries).toEqual(copy);
  });
});
