import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewDialog } from "./PreviewDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PreviewDialog", () => {
  it("画像は img タグで表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.jpg" path="docs/a.jpg" />);
    const img = screen.getByRole("img", { name: "a.jpg" });
    expect(img).toHaveAttribute("src", `/api/preview?path=${encodeURIComponent("docs/a.jpg")}`);
  });

  it("動画は video タグで表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.mp4" path="a.mp4" />);
    const video = document.querySelector("video");
    expect(video).toHaveAttribute("src", "/api/preview?path=a.mp4");
  });

  it("テキストは TextPreview を表示する（fetch が呼ばれる）", async () => {
    const fetchMock = vi.fn(async () => new Response("code", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PreviewDialog open onOpenChange={() => {}} name="a.ts" path="a.ts" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("非対応の拡張子はダウンロードへのフォールバックを表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.zip" path="docs/a.zip" />);
    expect(screen.getByText("プレビューできません")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.zip")}`);
  });

  it("open が false のときは中身を描画しない", () => {
    render(<PreviewDialog open={false} onOpenChange={() => {}} name="a.jpg" path="a.jpg" />);
    expect(screen.queryByRole("img", { name: "a.jpg" })).toBeNull();
  });
});
