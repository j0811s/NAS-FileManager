import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("HEICはHeicPreview経由でプレビュー用サムネイルを表示する", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.heic" path="docs/a.heic" />);
    const img = screen.getByRole("img", { name: "a.heic" });
    expect(img).toHaveAttribute(
      "src",
      `/api/thumbnail?path=${encodeURIComponent("docs/a.heic")}&size=preview`,
    );
  });

  it("open が false のときは中身を描画しない", () => {
    render(<PreviewDialog open={false} onOpenChange={() => {}} name="a.jpg" path="a.jpg" />);
    expect(screen.queryByRole("img", { name: "a.jpg" })).toBeNull();
  });
});

describe("PreviewDialog nav", () => {
  it("nav未指定時は矢印ボタン・カウンタが描画されない", () => {
    render(<PreviewDialog open onOpenChange={() => {}} name="a.jpg" path="a.jpg" />);
    expect(screen.queryByRole("button", { name: "前のファイル" })).toBeNull();
    expect(screen.queryByRole("button", { name: "次のファイル" })).toBeNull();
  });

  it("nav指定時、矢印ボタンとカウンタが表示される", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{
          hasPrev: true,
          hasNext: true,
          onPrev: () => {},
          onNext: () => {},
          position: { index: 3, total: 12 },
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "前のファイル" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "次のファイル" })).toBeInTheDocument();
    expect(screen.getByText("3 / 12")).toBeInTheDocument();
  });

  it("次のファイルボタンをクリックするとonNextが呼ばれる", async () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev: () => {}, onNext, position: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "次のファイル" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("前のファイルボタンをクリックするとonPrevが呼ばれる", async () => {
    const onPrev = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev, onNext: () => {}, position: null }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "前のファイル" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("hasPrev: false のとき前のファイルボタンがdisabled", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: false, hasNext: true, onPrev: () => {}, onNext: () => {}, position: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "前のファイル" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "次のファイル" })).not.toBeDisabled();
  });

  it("hasNext: false のとき次のファイルボタンがdisabled", () => {
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: false, onPrev: () => {}, onNext: () => {}, position: null }}
      />,
    );
    expect(screen.getByRole("button", { name: "次のファイル" })).toBeDisabled();
  });

  it("ArrowRightキーでonNextが呼ばれる", () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev: () => {}, onNext, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("ArrowLeftキーでonPrevが呼ばれる", () => {
    const onPrev = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: true, onPrev, onNext: () => {}, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("hasNext: false のときArrowRightキーを送ってもonNextは呼ばれない", () => {
    const onNext = vi.fn();
    render(
      <PreviewDialog
        open
        onOpenChange={() => {}}
        name="a.jpg"
        path="a.jpg"
        nav={{ hasPrev: true, hasNext: false, onPrev: () => {}, onNext, position: null }}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onNext).not.toHaveBeenCalled();
  });
});
