import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors";
import { listDir, makeDir, removePath, renamePath } from "./files.service";

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
