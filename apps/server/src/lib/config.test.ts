import { statSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNasRoot, resolveThumbCacheDir } from "./config";

let dir: string;
let savedEnv: string | undefined;
let savedThumbEnv: string | undefined;
let savedCwd: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nasfm-config-"));
  savedEnv = process.env.NAS_ROOT;
  savedThumbEnv = process.env.THUMB_CACHE_DIR;
  savedCwd = process.cwd();
});

afterEach(async () => {
  if (savedEnv === undefined) {
    delete process.env.NAS_ROOT;
  } else {
    process.env.NAS_ROOT = savedEnv;
  }
  if (savedThumbEnv === undefined) {
    delete process.env.THUMB_CACHE_DIR;
  } else {
    process.env.THUMB_CACHE_DIR = savedThumbEnv;
  }
  process.chdir(savedCwd);
  await rm(dir, { recursive: true, force: true });
});

describe("resolveNasRoot", () => {
  it("NAS_ROOT が既存ディレクトリならそれを返す", () => {
    process.env.NAS_ROOT = dir;
    expect(resolveNasRoot()).toBe(dir);
  });

  it("NAS_ROOT が存在しなければ throw する", () => {
    process.env.NAS_ROOT = path.join(dir, "missing");
    expect(() => resolveNasRoot()).toThrow(/NAS_ROOT/);
  });

  it("NAS_ROOT 未設定なら <cwd>/.dev-share を作成して返す", async () => {
    delete process.env.NAS_ROOT;
    process.chdir(dir);
    const root = resolveNasRoot();
    // macOS では tmpdir がシンボリックリンクのため realpath で比較する
    expect(root).toBe(path.join(await realpath(dir), ".dev-share"));
    expect(statSync(root).isDirectory()).toBe(true);
  });
});

describe("resolveThumbCacheDir", () => {
  it("THUMB_CACHE_DIR が設定されていればそこを作成して返す", () => {
    const target = path.join(dir, "thumbs", "cache");
    process.env.THUMB_CACHE_DIR = target;
    expect(resolveThumbCacheDir()).toBe(target);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("未設定なら <cwd>/.thumb-cache を作成して返す", async () => {
    delete process.env.THUMB_CACHE_DIR;
    process.chdir(dir);
    const result = resolveThumbCacheDir();
    // macOS では tmpdir がシンボリックリンクのため realpath で比較する
    expect(result).toBe(path.join(await realpath(dir), ".thumb-cache"));
    expect(statSync(result).isDirectory()).toBe(true);
  });
});
