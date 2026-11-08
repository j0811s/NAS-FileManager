import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { createAuthRoutes } from "./auth.routes";
import { createLoginLimiter } from "./login-limiter";
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
// app.request の第3引数は @hono/node-server の Bindings 相当。getConnInfo が socket.remoteAddress を読む。
const from = (ip: string) => ({ incoming: { socket: { remoteAddress: ip } } });
const LAN = from("192.168.1.10");

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0]; // "nasfm_token=<token>"
}

describe("POST /api/auth/login", () => {
  it("正しいパスワードで Cookie を発行し 200", async () => {
    const app = createApp(root, config);
    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ password: "pw" }),
      },
      LAN,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("nasfm_token=");
    expect(res.headers.get("set-cookie") ?? "").toContain("HttpOnly");
  });

  it("誤ったパスワードは 401 UNAUTHORIZED", async () => {
    const app = createApp(root, config);
    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ password: "wrong" }),
      },
      LAN,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("password 欠落は 400", async () => {
    const app = createApp(root, config);
    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({}),
      },
      LAN,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login の試行回数制限", () => {
  function login(app: Hono, password: string, ip = "192.168.1.10") {
    return app.request(
      "/api/auth/login",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ password }) },
      from(ip),
    );
  }

  it("5 回失敗すると、次の試行は正しいパスワードでも 429 TOO_MANY_REQUESTS", async () => {
    const app = createApp(root, config);
    for (let i = 0; i < 5; i++) {
      expect((await login(app, "wrong")).status).toBe(401);
    }
    const res = await login(app, "pw");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("別の IP からのログインは影響を受けない", async () => {
    const app = createApp(root, config);
    for (let i = 0; i < 5; i++) await login(app, "wrong", "192.168.1.10");
    expect((await login(app, "pw", "192.168.1.20")).status).toBe(200);
  });

  it("成功すると失敗回数がリセットされる", async () => {
    const app = createApp(root, config);
    for (let i = 0; i < 4; i++) await login(app, "wrong");
    expect((await login(app, "pw")).status).toBe(200);
    for (let i = 0; i < 4; i++) await login(app, "wrong");
    expect((await login(app, "pw")).status).toBe(200);
  });

  it("同時に送られても、パスワード照合は上限回数までしか行われない", async () => {
    const app = createApp(root, config);
    const results = await Promise.all(Array.from({ length: 10 }, () => login(app, "wrong")));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it("ロック時間が過ぎると、ルート経由でも再びログインできる", async () => {
    let t = 0;
    const limiter = createLoginLimiter({
      maxFailures: 5,
      windowMs: 15 * 60_000,
      lockMs: 15 * 60_000,
      now: () => t,
    });
    const app = new Hono().route("/api/auth", createAuthRoutes(config, limiter));
    for (let i = 0; i < 5; i++) await login(app, "wrong");
    expect((await login(app, "pw")).status).toBe(429);
    t += 15 * 60_000;
    const res = await login(app, "pw");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("nasfm_token=");
  });

  it("接続元 IP が取得できない場合は共有キーで数えず 500 にする", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createApp(root, config);
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "pw" }),
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
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
    const login = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ password: "pw" }),
      },
      LAN,
    );
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
    const login = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ password: "pw" }),
      },
      LAN,
    );
    const res = await app.request("/api/list?path=", { headers: { Cookie: cookieFrom(login) } });
    expect(res.status).toBe(200);
  });

  it("/health は認証なしで 200", async () => {
    const app = createApp(root, config);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
