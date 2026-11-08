import { describe, expect, it } from "vitest";
import { collectFromDataTransfer, collectFromEntries, collectFromFileList } from "./collect-files";

// FileSystemEntry API（webkitGetAsEntry の戻り値）のテストダブル。jsdom には実装が無いため最小限を再現する。
function fileEntry(name: string, content = name): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(new File([content], name)),
  } as unknown as FileSystemFileEntry;
}

/** readEntries は 1 回で全件を返すとは限らない（Chrome は最大 100 件ずつ）。batchSize ごとに分けて返す */
function dirEntry(name: string, children: FileSystemEntry[], batchSize = 100): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (ok: (entries: FileSystemEntry[]) => void) => {
          const batch = children.slice(offset, offset + batchSize);
          offset += batch.length;
          queueMicrotask(() => ok(batch));
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function summarize(collected: { file: File; relDir: string }[]) {
  return collected.map((c) => `${c.relDir}|${c.file.name}`).sort();
}

function unreadableFile(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (_ok: unknown, ng: (e: Error) => void) => ng(new Error("NotReadableError")),
  } as unknown as FileSystemFileEntry;
}

function unreadableDir(name: string): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (_ok: unknown, ng: (e: Error) => void) => ng(new Error("SecurityError")),
    }),
  } as unknown as FileSystemDirectoryEntry;
}

describe("collectFromEntries", () => {
  it('ファイルはそのまま relDir="" で返す', async () => {
    const result = await collectFromEntries([fileEntry("a.txt")]);
    expect(summarize(result.files)).toEqual(["|a.txt"]);
  });

  it("フォルダは中身を再帰的にたどり、ドロップしたフォルダ名から始まる relDir を付ける", async () => {
    const tree = dirEntry("photos", [
      fileEntry("1.jpg"),
      dirEntry("2026", [fileEntry("2.jpg"), dirEntry("summer", [fileEntry("3.jpg")])]),
    ]);
    const result = await collectFromEntries([tree, fileEntry("note.txt")]);
    expect(summarize(result.files)).toEqual([
      "photos/2026/summer|3.jpg",
      "photos/2026|2.jpg",
      "photos|1.jpg",
      "|note.txt",
    ]);
  });

  it("readEntries が複数回に分けて返しても、空になるまで読み切る", async () => {
    const many = Array.from({ length: 250 }, (_, i) => fileEntry(`f${i}.txt`));
    const result = await collectFromEntries([dirEntry("big", many, 100)]);
    expect(result.files).toHaveLength(250);
  });

  it("OS が作るファイル（.DS_Store / Thumbs.db / desktop.ini）は除外し、他のドットファイルは残す", async () => {
    const tree = dirEntry("d", [
      fileEntry(".DS_Store"),
      fileEntry("Thumbs.db"),
      fileEntry("desktop.ini"),
      fileEntry(".env.example"),
      fileEntry("a.txt"),
    ]);
    const result = await collectFromEntries([tree]);
    expect(summarize(result.files)).toEqual(["d|.env.example", "d|a.txt"]);
  });

  it("読めないファイル・フォルダがあっても残りは集め、読めなかったパスを failed に返す", async () => {
    const tree = dirEntry("d", [fileEntry("ok.txt"), unreadableFile("broken.txt"), unreadableDir("locked")]);
    const result = await collectFromEntries([tree]);
    expect(summarize(result.files)).toEqual(["d|ok.txt"]);
    expect(result.failed.map((f) => f.path).sort()).toEqual(["d/broken.txt", "d/locked"]);
  });

  it("空フォルダは何も返さない", async () => {
    const result = await collectFromEntries([dirEntry("empty", [])]);
    expect(result).toEqual({ files: [], failed: [] });
  });
});

describe("collectFromFileList", () => {
  function withRelativePath(name: string, relativePath: string): File {
    const f = new File(["x"], name);
    Object.defineProperty(f, "webkitRelativePath", { value: relativePath });
    return f;
  }

  it("webkitRelativePath からフォルダ部分を relDir にする（フォルダ選択）", () => {
    const result = collectFromFileList([
      withRelativePath("1.jpg", "photos/1.jpg"),
      withRelativePath("2.jpg", "photos/2026/2.jpg"),
    ]);
    expect(summarize(result)).toEqual(["photos/2026|2.jpg", "photos|1.jpg"]);
  });

  it('webkitRelativePath が空（通常のファイル選択）なら relDir=""', () => {
    const result = collectFromFileList([new File(["x"], "a.txt")]);
    expect(summarize(result)).toEqual(["|a.txt"]);
  });

  it("OS が作るファイルは除外する", () => {
    const result = collectFromFileList([
      withRelativePath(".DS_Store", "photos/.DS_Store"),
      withRelativePath("1.jpg", "photos/1.jpg"),
    ]);
    expect(summarize(result)).toEqual(["photos|1.jpg"]);
  });
});

describe("collectFromDataTransfer", () => {
  it("webkitGetAsEntry が使えればエントリからたどる", async () => {
    const dt = {
      items: [{ kind: "file", webkitGetAsEntry: () => dirEntry("d", [fileEntry("a.txt")]) }],
      files: [],
    } as unknown as DataTransfer;
    expect(summarize((await collectFromDataTransfer(dt)).files)).toEqual(["d|a.txt"]);
  });

  it('webkitGetAsEntry が無い環境では files を relDir="" で返す', async () => {
    const dt = {
      items: [{ kind: "file", getAsFile: () => new File(["x"], "a.txt") }],
      files: [new File(["x"], "a.txt")],
    } as unknown as DataTransfer;
    expect(summarize((await collectFromDataTransfer(dt)).files)).toEqual(["|a.txt"]);
  });

  it("エントリが取れない項目だけをファイルとして扱い、他のフォルダは構造を保つ", async () => {
    const dt = {
      items: [
        { kind: "file", webkitGetAsEntry: () => dirEntry("d", [fileEntry("a.txt")]) },
        { kind: "file", webkitGetAsEntry: () => null, getAsFile: () => new File(["x"], "loose.txt") },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(summarize((await collectFromDataTransfer(dt)).files)).toEqual(["d|a.txt", "|loose.txt"]);
  });

  it("文字列など file 以外の項目は無視する", async () => {
    const dt = {
      items: [{ kind: "string" }, { kind: "file", webkitGetAsEntry: () => fileEntry("a.txt") }],
      files: [],
    } as unknown as DataTransfer;
    expect(summarize((await collectFromDataTransfer(dt)).files)).toEqual(["|a.txt"]);
  });
});
