import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { AppError } from "../../lib/errors";
import {
  createFolderZipStream,
  listDir,
  makeDir,
  removePath,
  renamePath,
  resolveDownloadEntry,
  statForDownload,
  uploadFile,
} from "./files.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-files-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
}

describe("listDir", () => {
  it("ファイルとディレクトリをメタデータ付きで列挙する", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await mkdir(path.join(root, "sub"));
    const entries = await listDir(root, "");
    expect(entries.map((e) => e.name).sort()).toEqual(["a.txt", "sub"]);
    const file = entries.find((e) => e.name === "a.txt");
    expect(file?.type).toBe("file");
    expect(file?.size).toBe(5);
    expect(file?.mtime).toBeGreaterThan(0);
    const dir = entries.find((e) => e.name === "sub");
    expect(dir?.type).toBe("dir");
    expect(dir?.size).toBe(0);
  });

  it("サブディレクトリを列挙できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    const entries = await listDir(root, "sub");
    expect(entries.map((e) => e.name)).toEqual(["b.txt"]);
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(listDir(root, "missing"), "NOT_FOUND");
  });

  it("ファイルを指定すると NOT_A_DIRECTORY", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await expectAppError(listDir(root, "a.txt"), "NOT_A_DIRECTORY");
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    await expectAppError(listDir(root, "../"), "PATH_TRAVERSAL");
  });
});

describe("removePath", () => {
  it("ファイルを削除できる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await removePath(root, "a.txt");
    expect(await readdir(root)).toEqual([]);
  });

  it("空でないディレクトリを再帰削除できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    await removePath(root, "sub");
    expect(await readdir(root)).toEqual([]);
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(removePath(root, "missing"), "NOT_FOUND");
  });

  it("root 自身の削除は INVALID_REQUEST", async () => {
    await expectAppError(removePath(root, ""), "INVALID_REQUEST");
  });
});

describe("makeDir", () => {
  it("ディレクトリを作成できる", async () => {
    await makeDir(root, "newdir");
    const entries = await listDir(root, "");
    expect(entries).toEqual([{ name: "newdir", size: 0, mtime: expect.any(Number), type: "dir" }]);
  });

  it("同名が存在すると CONFLICT", async () => {
    await makeDir(root, "newdir");
    await expectAppError(makeDir(root, "newdir"), "CONFLICT");
  });

  it("親ディレクトリが無いと NOT_FOUND", async () => {
    await expectAppError(makeDir(root, "no/child"), "NOT_FOUND");
  });
});

describe("renamePath", () => {
  it("ファイルをリネームできる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await renamePath(root, "a.txt", "b.txt");
    expect(await readdir(root)).toEqual(["b.txt"]);
  });

  it("サブディレクトリへ移動できる", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await mkdir(path.join(root, "sub"));
    await renamePath(root, "a.txt", "sub/a.txt");
    expect(await readdir(path.join(root, "sub"))).toEqual(["a.txt"]);
  });

  it("移動元が無いと NOT_FOUND", async () => {
    await expectAppError(renamePath(root, "missing", "b.txt"), "NOT_FOUND");
  });

  it("移動先が存在すると CONFLICT（上書きしない）", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await writeFile(path.join(root, "b.txt"), "y");
    await expectAppError(renamePath(root, "a.txt", "b.txt"), "CONFLICT");
  });
});

describe("uploadFile", () => {
  it("ボディストリームを新規ファイルに書き込む", async () => {
    await uploadFile(root, "up.txt", Readable.from("hello"), false);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("hello");
  });

  it("既存ファイルがあり overwrite=false なら CONFLICT（中身は保持）", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    await expectAppError(uploadFile(root, "up.txt", Readable.from("new"), false), "CONFLICT");
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("old");
  });

  it("overwrite=true なら上書きする", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    await uploadFile(root, "up.txt", Readable.from("new"), true);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("new");
  });

  it("パスがディレクトリなら IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "sub"));
    await expectAppError(uploadFile(root, "sub", Readable.from("x"), true), "IS_A_DIRECTORY");
  });

  it("親ディレクトリが無いと NOT_FOUND（自動作成しない）", async () => {
    await expectAppError(uploadFile(root, "no/up.txt", Readable.from("x"), false), "NOT_FOUND");
  });

  it("ストリーム途中失敗時は書きかけファイルを残さない", async () => {
    const failing = new Readable({
      read() {
        this.push("partial");
        this.destroy(new Error("stream broken"));
      },
    });
    await expectAppError(uploadFile(root, "up.txt", failing, false), "INTERNAL");
    expect(await readdir(root)).toEqual([]);
  });
});

describe("statForDownload", () => {
  it("絶対パス・サイズ・ファイル名を返す", async () => {
    await writeFile(path.join(root, "dl.txt"), "hello");
    const info = await statForDownload(root, "dl.txt");
    expect(info.abs).toBe(path.join(root, "dl.txt"));
    expect(info.size).toBe(5);
    expect(info.name).toBe("dl.txt");
  });

  it("存在しないと NOT_FOUND", async () => {
    await expectAppError(statForDownload(root, "missing"), "NOT_FOUND");
  });

  it("ディレクトリは IS_A_DIRECTORY", async () => {
    await mkdir(path.join(root, "sub"));
    await expectAppError(statForDownload(root, "sub"), "IS_A_DIRECTORY");
  });
});

describe("resolveDownloadEntry", () => {
  it("ファイルは kind: file とサイズを返す", async () => {
    await writeFile(path.join(root, "dl.txt"), "hello");
    const info = await resolveDownloadEntry(root, "dl.txt");
    expect(info).toEqual({
      abs: path.join(root, "dl.txt"),
      name: "dl.txt",
      kind: "file",
      size: 5,
    });
  });

  it("ディレクトリは kind: dir を返す（size は含まない）", async () => {
    await mkdir(path.join(root, "sub"));
    const info = await resolveDownloadEntry(root, "sub");
    expect(info).toEqual({ abs: path.join(root, "sub"), name: "sub", kind: "dir" });
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(resolveDownloadEntry(root, "missing"), "NOT_FOUND");
  });

  it("パストラバーサルは PATH_TRAVERSAL", async () => {
    await expectAppError(resolveDownloadEntry(root, "../evil"), "PATH_TRAVERSAL");
  });
});

async function zipToEntries(archive: NodeJS.ReadableStream, outPath: string): Promise<string[]> {
  await pipeline(archive, createWriteStream(outPath));
  const zip = new AdmZip(outPath);
  return zip.getEntries().map((e) => e.entryName);
}

describe("createFolderZipStream", () => {
  it("フラットなフォルダの中身をzipエントリとして含む", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "a.txt"), "a");
    await writeFile(path.join(dir, "b.txt"), "b");
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out1.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("ネストしたフォルダ構造をzip内のパス階層に反映する", async () => {
    const dir = path.join(root, "folder");
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(path.join(dir, "top.txt"), "top");
    await writeFile(path.join(dir, "sub", "nested.txt"), "nested");
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out2.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names.sort()).toEqual(["sub/nested.txt", "top.txt"]);
  });

  it("空フォルダは有効な空zipになる", async () => {
    const dir = path.join(root, "empty");
    await mkdir(dir);
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out3.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual([]);
  });

  it("シンボリックリンクはzipに含まれない", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "real.txt"), "real");
    await symlink(path.join(dir, "real.txt"), path.join(dir, "link.txt"));
    const archive = createFolderZipStream(dir);
    const zipPath = path.join(root, "out4.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["real.txt"]);
  });

  it("archiver の ENOENT 警告は無視して継続し、他のファイルは正常に含まれる", async () => {
    const dir = path.join(root, "folder");
    await mkdir(dir);
    await writeFile(path.join(dir, "keep.txt"), "keep");
    const archive = createFolderZipStream(dir);
    // 実際のファイル削除タイミングに依存するテストは archiver 内部の stat キューの
    // 処理タイミング（Node の I/O スレッドプールのスケジューリング）に左右され本質的に
    // 決定的にできないため、存在しないパスを直接 archive.file() に渡すことで
    // ENOENT 警告の発生を確定的に再現する。この呼び出しは同期的に実行されるため、
    // walkAndAppend 内部の fs.readdir（実 I/O）が解決するより確実に先に完了し、
    // finalize() との競合は起きない。
    archive.file(path.join(dir, "definitely-missing.txt"), { name: "definitely-missing.txt" });
    const zipPath = path.join(root, "out5.zip");
    const names = await zipToEntries(archive, zipPath);
    expect(names).toEqual(["keep.txt"]);
  });
});
