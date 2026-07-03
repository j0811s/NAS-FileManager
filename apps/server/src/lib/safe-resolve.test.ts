import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "./errors";
import { safeResolve } from "./safe-resolve";

const ROOT = "/srv/share";

describe("safeResolve", () => {
  it("空文字は root 自身に解決する", () => {
    expect(safeResolve(ROOT, "")).toBe(ROOT);
  });

  it("相対パスは root 配下に解決する", () => {
    expect(safeResolve(ROOT, "docs/a.txt")).toBe(path.join(ROOT, "docs/a.txt"));
  });

  it("root 内に収まる .. は正規化して許可する", () => {
    expect(safeResolve(ROOT, "docs/../a.txt")).toBe(path.join(ROOT, "a.txt"));
  });

  it("絶対パス風の入力は root からの相対として扱う", () => {
    expect(safeResolve(ROOT, "/etc/passwd")).toBe(path.join(ROOT, "etc/passwd"));
  });

  it("root より上への脱出は拒否する", () => {
    expect(() => safeResolve(ROOT, "../secret")).toThrow(AppError);
  });

  it("ネストした脱出も拒否する", () => {
    expect(() => safeResolve(ROOT, "docs/../../secret")).toThrow(AppError);
  });

  it("root 名を前方一致で偽装する兄弟ディレクトリを拒否する", () => {
    expect(() => safeResolve(ROOT, "../share-evil/a.txt")).toThrow(AppError);
  });

  it("エラー code は PATH_TRAVERSAL", () => {
    let caught: unknown;
    try {
      safeResolve(ROOT, "../x");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("PATH_TRAVERSAL");
  });
});
