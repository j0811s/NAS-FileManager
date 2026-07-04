import { sign, verify } from "hono/jwt";
import type { AuthConfig } from "../../lib/auth-config";
import { verifyPassword } from "../../lib/password";

export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 日

export function verifyLogin(config: AuthConfig, password: string): boolean {
  return verifyPassword(password, config.passwordHash);
}

export function issueToken(config: AuthConfig): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return sign({ sub: "admin", exp }, config.secret);
}

export async function verifyToken(config: AuthConfig, token: string): Promise<boolean> {
  try {
    await verify(token, config.secret, "HS256");
    return true;
  } catch {
    return false;
  }
}
