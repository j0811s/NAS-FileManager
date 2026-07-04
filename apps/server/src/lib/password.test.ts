import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password", () => {
  it("ハッシュは scrypt$salt$hash 形式", () => {
    const h = hashPassword("secret");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h.split("$")).toHaveLength(3);
  });

  it("同じパスワードでも salt が異なるので毎回違うハッシュ", () => {
    expect(hashPassword("secret")).not.toBe(hashPassword("secret"));
  });

  it("正しいパスワードを検証できる", () => {
    const h = hashPassword("secret");
    expect(verifyPassword("secret", h)).toBe(true);
  });

  it("誤ったパスワードを拒否する", () => {
    const h = hashPassword("secret");
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("壊れた保存値は false", () => {
    expect(verifyPassword("secret", "garbage")).toBe(false);
    expect(verifyPassword("secret", "scrypt$only-two")).toBe(false);
    expect(verifyPassword("secret", "bcrypt$a$b")).toBe(false);
  });
});
