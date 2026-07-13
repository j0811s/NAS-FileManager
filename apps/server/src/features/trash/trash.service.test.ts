import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../lib/errors";
import { listTrash, moveToTrash, purgeTrashEntry, restoreFromTrash, TRASH_DIR_NAME } from "./trash.service";

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

describe("listTrash", () => {
  it("移動した項目が一覧に出る", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");

    const entries = await listTrash(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "a.txt",
      originalPath: "a.txt",
      type: "file",
      size: 5,
    });
    expect(entries[0].deletedAt).toBeGreaterThan(0);
    expect(typeof entries[0].id).toBe("string");
  });

  it("フォルダを移動した場合は type が dir、size は 0", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/b.txt"), "x");
    await moveToTrash(root, "sub");

    const entries = await listTrash(root);
    expect(entries[0]).toMatchObject({ name: "sub", type: "dir", size: 0 });
  });

  it("30日を超えたエントリは自動的に完全削除され、一覧に出ない", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const [before] = await listTrash(root);

    const metaPath = path.join(root, TRASH_DIR_NAME, `${before.id}.json`);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await writeFile(metaPath, JSON.stringify({ originalPath: "a.txt", deletedAt: old }));

    const entries = await listTrash(root);
    expect(entries).toEqual([]);
    const remainingIds = await readdir(path.join(root, TRASH_DIR_NAME));
    expect(remainingIds).toEqual([]);
  });

  it("壊れたメタデータ(不正JSON)は無視してクラッシュしない", async () => {
    await mkdir(path.join(root, TRASH_DIR_NAME), { recursive: true });
    await writeFile(path.join(root, TRASH_DIR_NAME, "broken.json"), "{not json");

    const entries = await listTrash(root);
    expect(entries).toEqual([]);
  });

  it(".trash ディレクトリが無ければ空配列を返す", async () => {
    const entries = await listTrash(root);
    expect(entries).toEqual([]);
  });
});

describe("restoreFromTrash", () => {
  it("元の場所に戻す", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const [entry] = await listTrash(root);

    await restoreFromTrash(root, entry.id);

    expect(await readFile(path.join(root, "a.txt"), "utf8")).toBe("hello");
    expect(await listTrash(root)).toEqual([]);
  });

  it("元の親フォルダが削除済みでも自動再作成して復元できる", async () => {
    await mkdir(path.join(root, "sub"));
    await writeFile(path.join(root, "sub/a.txt"), "hello");
    await moveToTrash(root, "sub/a.txt");
    await rm(path.join(root, "sub"), { recursive: true });
    const [entry] = await listTrash(root);

    await restoreFromTrash(root, entry.id);

    expect(await readFile(path.join(root, "sub/a.txt"), "utf8")).toBe("hello");
  });

  it("存在しない id は NOT_FOUND", async () => {
    await expectAppError(restoreFromTrash(root, "missing-id"), "NOT_FOUND");
  });

  it("元の場所に同名の項目が既にあれば CONFLICT", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const [entry] = await listTrash(root);
    await writeFile(path.join(root, "a.txt"), "new file at same path");

    await expectAppError(restoreFromTrash(root, entry.id), "CONFLICT");
  });

  it("パストラバーサルを試みる id は NOT_FOUND（.trash外へは一切アクセスしない）", async () => {
    await expectAppError(restoreFromTrash(root, "../../../../etc/passwd"), "NOT_FOUND");
  });
});

describe("purgeTrashEntry", () => {
  it(".trash/<id>/ と <id>.json の両方を削除する", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const [entry] = await listTrash(root);

    await purgeTrashEntry(root, entry.id);

    const remaining = await readdir(path.join(root, TRASH_DIR_NAME));
    expect(remaining).toEqual([]);
  });

  it("存在しない id は NOT_FOUND", async () => {
    await expectAppError(purgeTrashEntry(root, "missing-id"), "NOT_FOUND");
  });

  it("パストラバーサルを試みる id は NOT_FOUND（.trash外へは一切アクセスしない）", async () => {
    await expectAppError(purgeTrashEntry(root, "../../../../etc/passwd"), "NOT_FOUND");
  });
});
