import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeicPreview } from "./HeicPreview";

describe("HeicPreview", () => {
  it("画像を表示する", () => {
    render(
      <HeicPreview
        name="a.heic"
        url="/api/thumbnail?path=a.heic&size=preview"
        downloadHref="/api/download?path=a.heic"
      />,
    );
    const img = screen.getByRole("img", { name: "a.heic" });
    expect(img).toHaveAttribute("src", "/api/thumbnail?path=a.heic&size=preview");
  });

  it("画像の読み込みに失敗するとダウンロードへのフォールバックを表示する", () => {
    render(
      <HeicPreview
        name="a.heic"
        url="/api/thumbnail?path=a.heic&size=preview"
        downloadHref="/api/download?path=a.heic"
      />,
    );
    const img = screen.getByRole("img", { name: "a.heic" });
    fireEvent.error(img);
    expect(screen.getByText("プレビューできません")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ダウンロード/ })).toHaveAttribute(
      "href",
      "/api/download?path=a.heic",
    );
  });
});
