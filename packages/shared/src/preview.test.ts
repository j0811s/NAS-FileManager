import { describe, expect, it } from "vitest";
import { classifyPreview } from "./preview";

describe("classifyPreview", () => {
  it.each(["a.jpg", "a.JPG", "a.jpeg", "a.png", "a.webp", "a.gif"])("%s は image", (name) => {
    expect(classifyPreview(name)).toBe("image");
  });

  it.each(["a.mp4", "a.webm", "a.ogv", "a.ogg", "a.mov"])("%s は video", (name) => {
    expect(classifyPreview(name)).toBe("video");
  });

  it.each(["a.txt", "a.md", "a.json", "a.svg", "a.html", "a.ts", "a.py", "a.log"])("%s は text", (name) => {
    expect(classifyPreview(name)).toBe("text");
  });

  it.each(["a.zip", "a.pdf", "a.heic", "a.mkv", "README", "Makefile"])("%s は非対応（null）", (name) => {
    expect(classifyPreview(name)).toBeNull();
  });
});
