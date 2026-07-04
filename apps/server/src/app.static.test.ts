import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { AuthConfig } from "./lib/auth-config";
import { hashPassword } from "./lib/password";

const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };

let root: string;
let staticDir: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-root-"));
  staticDir = await mkdtemp(path.join(tmpdir(), "nasfm-static-"));
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>NAS-FileManager</title>");
  await mkdir(path.join(staticDir, "assets"));
  await writeFile(path.join(staticDir, "assets", "app.js"), "console.log('app');");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(staticDir, { recursive: true, force: true });
});

describe("静的配信（staticDir 指定時）", () => {
  it("/ で index.html を返す", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("NAS-FileManager");
  });

  it("/assets/app.js で JS ファイルを返す", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  it("static マウント後も /health は影響を受けない", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("static マウント後も /api/list は認証ガードのまま（Cookie 無しで 401）", async () => {
    const app = createApp(root, authConfig, staticDir);
    const res = await app.request("/api/list?path=");
    expect(res.status).toBe(401);
  });
});

describe("静的配信（staticDir 未指定時）", () => {
  it("/ は 404（static 未マウント、既存の開発時挙動）", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});
