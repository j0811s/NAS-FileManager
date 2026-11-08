import { getConnInfo } from "@hono/node-server/conninfo";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ApiError, AuthStatus, OkResponse } from "@nas-fm/shared";
import type { AuthConfig } from "../../lib/auth-config";
import { AppError } from "../../lib/errors";
import { COOKIE_NAME } from "./auth.middleware";
import { TOKEN_TTL_SECONDS, issueToken, verifyLogin, verifyToken } from "./auth.service";
import { type LoginLimiter, createLoginLimiter } from "./login-limiter";

async function readPassword(readJson: () => Promise<unknown>): Promise<string> {
  let body: unknown;
  try {
    body = await readJson();
  } catch {
    throw new AppError("INVALID_REQUEST", "invalid JSON body");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { password?: unknown }).password !== "string"
  ) {
    throw new AppError("INVALID_REQUEST", "password is required");
  }
  return (body as { password: string }).password;
}

/**
 * 接続元 IP を返す。X-Forwarded-For は信用しない（リバースプロキシを挟まない運用のため、偽装されるだけ）。
 * 取得できない場合に共有キーへ落とすと 1 人の失敗で全員がロックされるため、例外にして 500 で止める
 * （onError がサーバログに残す）。
 */
function clientKey(c: Context): string {
  const address = getConnInfo(c).remote.address;
  if (!address) throw new Error("client address is unavailable");
  return address;
}

function tooManyRequests(c: Context, retryAfterSec: number) {
  const body: ApiError = {
    error: { code: "TOO_MANY_REQUESTS", message: "too many login attempts" },
  };
  c.header("Retry-After", String(retryAfterSec));
  return c.json(body, 429);
}

export function createAuthRoutes(
  config: AuthConfig,
  limiter: LoginLimiter = createLoginLimiter(),
): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const key = clientKey(c);
    // ロック中なら本文を読まずに返す
    const before = limiter.check(key);
    if (!before.allowed) return tooManyRequests(c, before.retryAfterSec);

    const password = await readPassword(() => c.req.json());

    // 本文を読む await の間に同時リクエストが失敗を積んでいる可能性があるため再判定する。
    // ここから記録までは await を挟まない（verifyLogin は同期）ので、上限を超えて照合されない。
    const limit = limiter.check(key);
    if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSec);
    if (!verifyLogin(config, password)) {
      limiter.recordFailure(key);
      throw new AppError("UNAUTHORIZED", "invalid password");
    }
    limiter.recordSuccess(key);
    const token = await issueToken(config);
    setCookie(c, COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: TOKEN_TTL_SECONDS,
    });
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.post("/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    const res: OkResponse = { ok: true };
    return c.json(res);
  });

  app.get("/me", async (c) => {
    const token = getCookie(c, COOKIE_NAME);
    const authenticated = token ? await verifyToken(config, token) : false;
    const res: AuthStatus = { authenticated };
    return c.json(res);
  });

  return app;
}
