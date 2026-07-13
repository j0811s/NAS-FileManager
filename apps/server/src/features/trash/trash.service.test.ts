import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors";
import { moveToTrash, TRASH_DIR_NAME } from "./trash.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-trash-"));
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

describe("moveToTrash", () => {
  it("ファイルを .trash/<uuid>/ に移動し、元の場所から消す", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");

    const remaining = (await readdir(root)).filter((n) => n !== TRASH_DIR_NAME);
    expect(remaining).toEqual([]);

    const ids = await readdir(path.join(root, TRASH_DIR_NAME));
    const dirId = ids.find((n) => !n.endsWith(".json"));
    expect(dirId).toBeDefined();
    const movedName = await readdir(path.join(root, TRASH_DIR_NAME, dirId as string));
    expect(movedName).toEqual(["a.txt"]);

    const meta = JSON.parse(await readFile(path.join(root, TRASH_DIR_NAME, `${dirId}.json`), "utf8")) as {
      originalPath: string;
      deletedAt: number;
    };
    expect(meta.originalPath).toBe("a.txt");
    expect(meta.deletedAt).toBeGreaterThan(0);
  });

  it("空でないディレクトリを再帰的に移動できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    await moveToTrash(root, "sub");

    const remaining = (await readdir(root)).filter((n) => n !== TRASH_DIR_NAME);
    expect(remaining).toEqual([]);

    const ids = await readdir(path.join(root, TRASH_DIR_NAME));
    const dirId = ids.find((n) => !n.endsWith(".json")) as string;
    const inner = await readdir(path.join(root, TRASH_DIR_NAME, dirId, "sub"));
    expect(inner).toEqual(["b.txt"]);
  });

  it("存在しないパスは NOT_FOUND", async () => {
    await expectAppError(moveToTrash(root, "missing"), "NOT_FOUND");
  });

  it("root 自身の削除は INVALID_REQUEST", async () => {
    await expectAppError(moveToTrash(root, ""), "INVALID_REQUEST");
  });
});
