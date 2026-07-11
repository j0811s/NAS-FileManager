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
  { name: "logo.svg", size: 50, mtime: 1700000000000, type: "file" },
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

  it("画像は thumbnailUrl を src に持つ遅延読み込み img を描画する", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=cat.jpg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("サブフォルダ内では path を含めた thumbnailUrl になる", () => {
    renderGrid({ path: "photos" });
    const img = screen.getByAltText("cat.jpg");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=photos%2Fcat.jpg");
  });

  it("SVGはサムネイル生成せず previewUrl を直接使う", () => {
    renderGrid();
    const img = screen.getByAltText("logo.svg");
    expect(img.getAttribute("src")).toBe("/api/preview?path=logo.svg");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("画像サムネイルには再生アイコンを重ねない", () => {
    renderGrid();
    const img = screen.getByAltText("cat.jpg");
    expect(img.parentElement?.querySelector(".lucide-play")).toBeNull();
  });

  it("画像はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)", () => {
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

    renderGrid({ entries: [entries[1]] });
    expect(screen.queryByAltText("cat.jpg")).not.toBeInTheDocument();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByAltText("cat.jpg")).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("動画は thumbnailUrl を src に持つ img を描画し、video 要素を使わない", () => {
    const { container } = renderGrid();
    const img = screen.getByAltText("mov.mp4");
    expect(img.getAttribute("src")).toBe("/api/thumbnail?path=mov.mp4");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(container.querySelector("video")).toBeNull();
  });

  it("動画サムネイルには再生アイコンを重ねる", () => {
    const { container } = renderGrid();
    expect(container.querySelector(".lucide-play")).not.toBeNull();
  });

  it("動画サムネイルの読み込み失敗でアイコンにフォールバックする", () => {
    const { container } = renderGrid();
    fireEvent.error(screen.getByAltText("mov.mp4"));
    expect(screen.queryByAltText("mov.mp4")).not.toBeInTheDocument();
    expect(container.querySelector(".lucide-play")).toBeNull();
    expect(screen.getByText("mov.mp4")).toBeInTheDocument(); // 名前は残る
  });

  it("動画はビューポートに入るまでサムネイル画像をマウントしない(遅延読み込み)", () => {
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

    renderGrid({ entries: [entries[2]] });
    expect(screen.queryByAltText("mov.mp4")).not.toBeInTheDocument();

    act(() => {
      capturedCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByAltText("mov.mp4")).toBeInTheDocument();

    vi.unstubAllGlobals();
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
