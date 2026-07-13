import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, TrashListResponse } from "@nas-fm/shared";
import { createApp } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken } from "../auth/auth.service";
import { moveToTrash } from "./trash.service";

let root: string;
const authConfig: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let authCookie: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-trash-routes-"));
  authCookie = `nasfm_token=${await issueToken(authConfig)}`;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function withAuth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers ?? {}), Cookie: authCookie } };
}

const jsonHeaders = { "content-type": "application/json" };

describe("GET /api/trash", () => {
  it("未認証は 401", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/trash");
    expect(res.status).toBe(401);
  });

  it("移動済みの項目を返す", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const app = createApp(root, authConfig);
    const res = await app.request("/api/trash", withAuth());
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrashListResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe("a.txt");
  });
});

describe("POST /api/trash/restore", () => {
  it("復元できる", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const app = createApp(root, authConfig);
    const listRes = await app.request("/api/trash", withAuth());
    const { entries } = (await listRes.json()) as TrashListResponse;

    const res = await app.request(
      "/api/trash/restore",
      withAuth({ method: "POST", headers: jsonHeaders, body: JSON.stringify({ id: entries[0].id }) }),
    );
    expect(res.status).toBe(200);
  });

  it("id が無いボディは 400", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/trash/restore",
      withAuth({ method: "POST", headers: jsonHeaders, body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });

  it("存在しない id は 404", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request(
      "/api/trash/restore",
      withAuth({
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ id: "missing" }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/trash", () => {
  it("完全削除できる", async () => {
    await writeFile(path.join(root, "a.txt"), "hello");
    await moveToTrash(root, "a.txt");
    const app = createApp(root, authConfig);
    const listRes = await app.request("/api/trash", withAuth());
    const { entries } = (await listRes.json()) as TrashListResponse;

    const res = await app.request(`/api/trash?id=${entries[0].id}`, withAuth({ method: "DELETE" }));
    expect(res.status).toBe(200);

    const afterRes = await app.request("/api/trash", withAuth());
    const after = (await afterRes.json()) as TrashListResponse;
    expect(after.entries).toEqual([]);
  });

  it("id 未指定は 400", async () => {
    const app = createApp(root, authConfig);
    const res = await app.request("/api/trash", withAuth({ method: "DELETE" }));
    expect(res.status).toBe(400);
  });
});
