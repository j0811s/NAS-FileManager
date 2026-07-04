import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../lib/auth-config";
import { hashPassword } from "../../lib/password";
import { issueToken, verifyLogin, verifyToken } from "./auth.service";

const config: AuthConfig = { secret: "test-secret", passwordHash: hashPassword("pw") };

describe("verifyLogin", () => {
  it("正しいパスワードで true", () => {
    expect(verifyLogin(config, "pw")).toBe(true);
  });
  it("誤ったパスワードで false", () => {
    expect(verifyLogin(config, "nope")).toBe(false);
  });
});

describe("issueToken / verifyToken", () => {
  it("発行したトークンを検証できる", async () => {
    const token = await issueToken(config);
    expect(await verifyToken(config, token)).toBe(true);
  });

  it("別の secret で署名されたトークンは拒否", async () => {
    const token = await sign({ sub: "admin", exp: Math.floor(Date.now() / 1000) + 60 }, "other-secret");
    expect(await verifyToken(config, token)).toBe(false);
  });

  it("期限切れトークンは拒否", async () => {
    const token = await sign({ sub: "admin", exp: Math.floor(Date.now() / 1000) - 10 }, config.secret);
    expect(await verifyToken(config, token)).toBe(false);
  });

  it("壊れたトークンは拒否", async () => {
    expect(await verifyToken(config, "not-a-jwt")).toBe(false);
  });
});
