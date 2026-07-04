import { describe, expect, it } from "vitest";
import { previewContentType } from "./preview-mime";

describe("previewContentType", () => {
  it("image は実際の MIME を返す", () => {
    expect(previewContentType("image", "a.jpg")).toBe("image/jpeg");
    expect(previewContentType("image", "a.png")).toBe("image/png");
  });

  it("video は実際の MIME を返す", () => {
    expect(previewContentType("video", "a.mp4")).toBe("video/mp4");
    expect(previewContentType("video", "a.webm")).toBe("video/webm");
  });

  it("text は常に text/plain（本来の MIME を使わない）", () => {
    expect(previewContentType("text", "a.html")).toBe("text/plain; charset=utf-8");
    expect(previewContentType("text", "a.svg")).toBe("text/plain; charset=utf-8");
    expect(previewContentType("text", "a.json")).toBe("text/plain; charset=utf-8");
  });
});
