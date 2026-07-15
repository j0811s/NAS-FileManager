import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, SearchResponse } from "@nas-fm/shared";
import { createApp } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";

let root: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-search-routes-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

describe("GET /api/search", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/search?q=report");
    expect(res.status).toBe(401);
  });

  it("一致する項目を返す", async () => {
    await writeFile(path.join(root, "report.txt"), "hello");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/search?q=report", withAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as SearchResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe("report.txt");
    expect(body.truncated).toBe(false);
  });

  it("q が無いと 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/search", withAuth());
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("q が空文字だと 400 + INVALID_REQUEST", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/search?q=", withAuth());
    expect(res.status).toBe(400);
  });
});
