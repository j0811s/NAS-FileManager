import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";

const config: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-auth-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const jsonHeaders = { "content-type": "application/json" };

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0]; // "nasfm_token=<token>"
}

describe("POST /api/auth/login", () => {
  it("正しいパスワードで Cookie を発行し 200", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "pw" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("nasfm_token=");
    expect(res.headers.get("set-cookie") ?? "").toContain("HttpOnly");
  });

  it("誤ったパスワードは 401 UNAUTHORIZED", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("password 欠落は 400", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  it("Cookie 無しは authenticated:false（200）", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: false });
  });

  it("ログイン後の Cookie で authenticated:true", async () => {
    const app = createApp(root, config);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "pw" }),
    });
    const res = await app.request("/api/auth/me", { headers: { Cookie: cookieFrom(login) } });
    expect(await res.json()).toEqual({ authenticated: true });
  });
});

describe("POST /api/auth/logout", () => {
  it("Cookie を失効させる", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("nasfm_token=");
    // 失効は Max-Age=0 もしくは過去日で表現される
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0|Expires=/);
  });
});

describe("保護されたファイルルート", () => {
  it("Cookie 無しの /api/list は 401", async () => {
    const app = createApp(root, config);
    const res = await app.request("/api/list?path=");
    expect(res.status).toBe(401);
  });

  it("有効な Cookie の /api/list は 200", async () => {
    const app = createApp(root, config);
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "pw" }),
    });
    const res = await app.request("/api/list?path=", { headers: { Cookie: cookieFrom(login) } });
    expect(res.status).toBe(200);
  });

  it("/health は認証なしで 200", async () => {
    const app = createApp(root, config);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
