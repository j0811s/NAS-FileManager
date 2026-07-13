import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiskUsageResponse } from "@nas-fm/shared";
import { createApp } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";

let root: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-disk-usage-routes-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

describe("GET /api/disk-usage", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/disk-usage");
    expect(res.status).toBe(401);
  });

  it("認証済みは 200 + total/used/free", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/disk-usage", withAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiskUsageResponse;
    expect(body.total).toBeGreaterThan(0);
    expect(body.used + body.free).toBe(body.total);
  });
});
