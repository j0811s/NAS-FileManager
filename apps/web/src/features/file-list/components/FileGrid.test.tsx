import type { FileEntry } from "@nas-fm/shared";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileGrid } from "./FileGrid";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "cat.jpg", size: 100, mtime: 1700000000000, type: "file" },
  { name: "mov.mp4", size: 200, mtime: 1700000000000, type: "file" },
  { name: "doc.pdf", size: 300, mtime: 1700000000000, type: "file" },
];

function renderGrid(overrides: Partial<Parameters<typeof FileGrid>[0]> = {}) {
  return render(
    <FileGrid
      entries={entries}
      path=""
      onOpenDir={() => {}}
      onPreview={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onMove={() => {}}
      {...overrides}
    />,
  );
}

describe("FileGrid", () => {
  it("エントリ名を表示する", () => {
    renderGrid();
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  });

  it("フォルダカードのクリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    renderGrid({ onOpenDir });
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("ファイルカードのクリックで onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    renderGrid({ onPreview });
    await userEvent.click(screen.getByText("doc.pdf"));
    expect(onPreview).toHaveBeenCalledWith(entries[3]);
  });

  it("操作メニューのクリックでは onOpenDir/onPreview を呼ばない", async () => {
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    renderGrid({ onOpenDir, onPreview });
    await userEvent.click(screen.getAllByRole("button", { name: "操作メニュー" })[0]);
    expect(onOpenDir).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("画像は previewUrl を src に持つ遅延読み込み img を描画する", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=cat.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("サブフォルダ内では path を含めた previewUrl になる", () => {
    renderGrid({ path: "photos" });
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=photos%2Fcat.jpg");
  });

  it("動画は #t=1 付き previewUrl の video を描画する", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/api/preview?path=mov.mp4#t=1");
    expect(video?.getAttribute("preload")).toBe("metadata");
  });

  it("その他ファイルとフォルダはサムネイルを持たない", () => {
    const { container } = renderGrid({ entries: [entries[0], entries[3]] });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("画像の読み込み失敗でアイコンにフォールバックする", () => {
    renderGrid();
    fireEvent.error(screen.getByAltText("cat.jpg"));
    expect(screen.queryByAltText("cat.jpg")).not.toBeInTheDocument();
    expect(screen.getByText("cat.jpg")).toBeInTheDocument(); // 名前は残る
  });

  it("動画の読み込み失敗でアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    expect(container.querySelector("video")).toBeNull();
  });

  it("映像トラックの無い動画(videoWidth=0)はアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video") as HTMLVideoElement;
    // jsdom の videoWidth は常に 0
    fireEvent(video, new Event("loadedmetadata"));
    expect(container.querySelector("video")).toBeNull();
  });

  it("映像トラックがあれば動画を維持する", () => {
    const { container } = renderGrid();
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { value: 640 });
    fireEvent(video, new Event("loadedmetadata"));
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("動画はビューポートに入るまでvideo要素をマウントしない(遅延読み込み)", () => {
    let capturedCallback: IntersectionObserverCallback | undefined;
    class ManualIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        capturedCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", ManualIntersectionObserver);

    const { container } = renderGrid();
    expect(container.querySelector("video")).toBeNull();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(container.querySelector("video")).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it("ディレクトリ移動後は同名ファイルでもサムネイルの失敗状態を引き継がない", () => {
    const catA: FileEntry = { name: "cat.jpg", size: 100, mtime: 1700000000000, type: "file" };
    const catB: FileEntry = { name: "cat.jpg", size: 999, mtime: 1700000000000, type: "file" };
    const { rerender } = renderGrid({ path: "dirA", entries: [catA] });

    fireEvent.error(screen.getByAltText("cat.jpg"));
    expect(screen.queryByAltText("cat.jpg")).not.toBeInTheDocument();

    rerender(
      <FileGrid
        entries={[catB]}
        path="dirB"
        onOpenDir={() => {}}
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );

    expect(screen.getByAltText("cat.jpg")).toBeInTheDocument();
  });
});
