import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDiskUsage } from "./disk-usage.service";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-disk-usage-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("getDiskUsage", () => {
  it("total/used/free が整合する値を返す", async () => {
    const result = await getDiskUsage(root);
    expect(result.total).toBeGreaterThan(0);
    expect(result.free).toBeGreaterThanOrEqual(0);
    expect(result.used).toBeGreaterThanOrEqual(0);
    expect(result.used + result.free).toBe(result.total);
  });
});
