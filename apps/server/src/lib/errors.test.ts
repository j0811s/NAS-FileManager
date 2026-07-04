import { describe, expect, it } from "vitest";
import { AppError, fromFsError, statusOf } from "./errors";

describe("AppError", () => {
  it("code と message を保持する", () => {
    const err = new AppError("CONFLICT", "already exists: a.txt");
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toBe("already exists: a.txt");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("statusOf", () => {
  it.each([
    ["PATH_TRAVERSAL", 400],
    ["INVALID_REQUEST", 400],
    ["NOT_A_DIRECTORY", 400],
    ["IS_A_DIRECTORY", 400],
    ["UNAUTHORIZED", 401],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["INTERNAL", 500],
  ] as const)("%s は %d", (code, status) => {
    expect(statusOf(code)).toBe(status);
  });
});

describe("fromFsError", () => {
  function fsError(code: string): NodeJS.ErrnoException {
    const err: NodeJS.ErrnoException = new Error(code);
    err.code = code;
    return err;
  }

  it("ENOENT は NOT_FOUND", () => {
    expect(fromFsError(fsError("ENOENT"), "a.txt").code).toBe("NOT_FOUND");
  });

  it("EEXIST は CONFLICT", () => {
    expect(fromFsError(fsError("EEXIST"), "a.txt").code).toBe("CONFLICT");
  });

  it("ENOTDIR は NOT_A_DIRECTORY", () => {
    expect(fromFsError(fsError("ENOTDIR"), "a").code).toBe("NOT_A_DIRECTORY");
  });

  it("EISDIR は IS_A_DIRECTORY", () => {
    expect(fromFsError(fsError("EISDIR"), "a").code).toBe("IS_A_DIRECTORY");
  });

  it("AppError はそのまま返す", () => {
    const orig = new AppError("CONFLICT", "x");
    expect(fromFsError(orig, "a")).toBe(orig);
  });

  it("未知のエラーは INTERNAL", () => {
    expect(fromFsError(new Error("boom"), "a").code).toBe("INTERNAL");
  });
});
