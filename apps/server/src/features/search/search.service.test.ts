import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { searchFiles } from "./search.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-search-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("searchFiles", () => {
  it("部分一致するファイルを見つける(大文字小文字を区別しない)", async () => {
    await writeFile(path.join(root, "Report.txt"), "x");
    await writeFile(path.join(root, "other.txt"), "x");
    const { entries } = await searchFiles(root, "report");
    expect(entries.map((e) => e.name)).toEqual(["Report.txt"]);
    expect(entries[0].path).toBe("Report.txt");
    expect(entries[0].type).toBe("file");
  });

  it("フォルダ名も検索対象になる", async () => {
    await mkdir(path.join(root, "Photos"));
    const { entries } = await searchFiles(root, "photo");
    expect(entries.map((e) => e.name)).toEqual(["Photos"]);
    expect(entries[0].type).toBe("dir");
    expect(entries[0].size).toBe(0);
  });

  it("ネストしたフォルダの中身も見つかり、相対パスを含む", async () => {
    await mkdir(path.join(root, "docs", "2024"), { recursive: true });
    await writeFile(path.join(root, "docs", "2024", "report.txt"), "x");
    const { entries } = await searchFiles(root, "report");
    expect(entries[0].path).toBe("docs/2024/report.txt");
  });

  it(".trash 配下は検索対象外", async () => {
    await mkdir(path.join(root, ".trash", "some-id"), { recursive: true });
    await writeFile(path.join(root, ".trash", "some-id", "report.txt"), "x");
    const { entries } = await searchFiles(root, "report");
    expect(entries).toEqual([]);
  });

  it("シンボリックリンクは検索対象外", async () => {
    await writeFile(path.join(root, "real-report.txt"), "x");
    await symlink(path.join(root, "real-report.txt"), path.join(root, "link-report.txt"));
    const { entries } = await searchFiles(root, "report");
    expect(entries.map((e) => e.name)).toEqual(["real-report.txt"]);
  });

  it("200件を超えると truncated: true になり201件目以降は含まれない", async () => {
    for (let i = 0; i < 205; i++) {
      await writeFile(path.join(root, `match-${String(i).padStart(3, "0")}.txt`), "x");
    }
    const { entries, truncated } = await searchFiles(root, "match");
    expect(entries).toHaveLength(200);
    expect(truncated).toBe(true);
  });

  it("一致しなければ空配列、truncatedはfalse", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const { entries, truncated } = await searchFiles(root, "nomatch");
    expect(entries).toEqual([]);
    expect(truncated).toBe(false);
  });
});
