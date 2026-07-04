import { describe, expect, it } from "vitest";
import { errorMessage } from "./error-messages";

describe("errorMessage", () => {
  it.each([
    "PATH_TRAVERSAL",
    "INVALID_REQUEST",
    "NOT_A_DIRECTORY",
    "IS_A_DIRECTORY",
    "NOT_FOUND",
    "CONFLICT",
    "UNAUTHORIZED",
    "INTERNAL",
  ])("%s に日本語メッセージがある", (code) => {
    const msg = errorMessage(code);
    expect(msg).toBeTruthy();
    expect(msg).not.toBe(code);
  });

  it("未知コードは汎用メッセージ", () => {
    expect(errorMessage("SOMETHING_ELSE")).toBe("エラーが発生しました");
  });
});
