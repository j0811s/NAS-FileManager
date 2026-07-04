import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "./password";
import { resolveAuthConfig } from "./auth-config";

let savedSecret: string | undefined;
let savedHash: string | undefined;

beforeEach(() => {
  savedSecret = process.env.AUTH_SECRET;
  savedHash = process.env.AUTH_PASSWORD_HASH;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = savedSecret;
  if (savedHash === undefined) delete process.env.AUTH_PASSWORD_HASH;
  else process.env.AUTH_PASSWORD_HASH = savedHash;
  vi.restoreAllMocks();
});

describe("resolveAuthConfig", () => {
  it("env が設定済みならそれを使い警告しない", () => {
    process.env.AUTH_SECRET = "real-secret";
    process.env.AUTH_PASSWORD_HASH = "scrypt$abc$def";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveAuthConfig();
    expect(config.secret).toBe("real-secret");
    expect(config.passwordHash).toBe("scrypt$abc$def");
    expect(warn).not.toHaveBeenCalled();
  });

  it("env 未設定なら開発デフォルト（admin を検証可能）＋警告", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_PASSWORD_HASH;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = resolveAuthConfig();
    expect(config.secret).toBe("dev-insecure-secret-change-me");
    expect(verifyPassword("admin", config.passwordHash)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
