import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AuthConfig } from "../../lib/auth-config";
import { AppError } from "../../lib/errors";
import { verifyToken } from "./auth.service";

export const COOKIE_NAME = "nasfm_token";

export function requireAuth(config: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const token = getCookie(c, COOKIE_NAME);
    if (!token || !(await verifyToken(config, token))) {
      throw new AppError("UNAUTHORIZED", "authentication required");
    }
    await next();
  };
}
