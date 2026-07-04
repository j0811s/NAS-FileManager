import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthStatus, OkResponse } from "@nas-fm/shared";
import type { AuthConfig } from "../../lib/auth-config";
import { AppError } from "../../lib/errors";
import { COOKIE_NAME } from "./auth.middleware";
import { TOKEN_TTL_SECONDS, issueToken, verifyLogin, verifyToken } from "./auth.service";

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

export function createAuthRoutes(config: AuthConfig): Hono {
  const app = new Hono();

  app.post("/login", async (c) => {
    const password = await readPassword(() => c.req.json());
    if (!verifyLogin(config, password)) {
      throw new AppError("UNAUTHORIZED", "invalid password");
    }
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
