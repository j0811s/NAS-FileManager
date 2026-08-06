import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTable } from "./FileTable";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "a.txt", size: 12, mtime: 1700000000000, type: "file" },
];

function baseProps(overrides: Partial<Parameters<typeof FileTable>[0]> = {}) {
  return {
    entries,
    sortKey: "name" as const,
    sortDir: "asc" as const,
    onSortChange: () => {},
    onOpenDir: () => {},
    onPreview: () => {},
    path: "",
    onRename: () => {},
    onDelete: () => {},
    onMove: () => {},
    selectMode: false,
    selectedNames: new Set<string>(),
    onToggleSelect: () => {},
    ...overrides,
  };
}

describe("FileTable", () => {
  it("1GB以上のファイルはGB単位で表示する", () => {
    render(
      <FileTable
        {...baseProps({
          entries: [
            { name: "big.zip", size: 2 * 1024 * 1024 * 1024, mtime: 1700000000000, type: "file" },
          ],
        })}
      />,
    );
    expect(screen.getByText("2.0 GB")).toBeInTheDocument();
  });

  it("エントリ名を表示する", () => {
    render(<FileTable {...baseProps()} />);
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("ディレクトリ名クリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    render(<FileTable {...baseProps({ onOpenDir })} />);
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("ファイル名クリックで onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    render(<FileTable {...baseProps({ onPreview })} />);
    await userEvent.click(screen.getByText("a.txt"));
    expect(onPreview).toHaveBeenCalledWith(entries[1]);
  });

  it("行内の名前以外(サイズ列など)のクリックでも onPreview/onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    render(<FileTable {...baseProps({ onOpenDir, onPreview })} />);
    await userEvent.click(screen.getByText("12 B"));
    expect(onPreview).toHaveBeenCalledWith(entries[1]);
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("操作メニューのクリックでは onPreview/onOpenDir を呼ばない", async () => {
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    render(<FileTable {...baseProps({ onOpenDir, onPreview })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "操作メニュー" })[0]);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("操作メニューの移動から onMove を呼ぶ", async () => {
    const onMove = vi.fn();
    render(<FileTable {...baseProps({ onMove })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "操作メニュー" })[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /移動/ }));
    expect(onMove).toHaveBeenCalledWith(entries[0]);
  });

  it("名前ヘッダクリックで onSortChange('name')", async () => {
    const onSortChange = vi.fn();
    render(<FileTable {...baseProps({ onSortChange })} />);
    await userEvent.click(screen.getByRole("button", { name: /名前/ }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });

  it("selectMode時はチェックボックス列を表示する", () => {
    render(<FileTable {...baseProps({ selectMode: true })} />);
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "a.txt を選択" })).toBeInTheDocument();
  });

  it("selectMode時でなければチェックボックスを表示しない", () => {
    render(<FileTable {...baseProps({ selectMode: false })} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("チェックボックスクリックで onToggleSelect のみ呼ぶ(開く/プレビューは呼ばれない)", async () => {
    const onToggleSelect = vi.fn();
    const onOpenDir = vi.fn();
    const onPreview = vi.fn();
    render(
      <FileTable {...baseProps({ selectMode: true, onToggleSelect, onOpenDir, onPreview })} />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "sub を選択" }));
    expect(onToggleSelect).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).toHaveBeenCalledWith("sub");
    expect(onOpenDir).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("selectMode時は行クリックでも onToggleSelect を呼ぶ(開く/プレビューは呼ばれない)", async () => {
    const onToggleSelect = vi.fn();
    const onOpenDir = vi.fn();
    render(<FileTable {...baseProps({ selectMode: true, onToggleSelect, onOpenDir })} />);
    await userEvent.click(screen.getByText("sub"));
    expect(onToggleSelect).toHaveBeenCalledWith("sub");
    expect(onOpenDir).not.toHaveBeenCalled();
  });

  it("選択済みの行はチェックボックスがチェックされる", () => {
    render(<FileTable {...baseProps({ selectMode: true, selectedNames: new Set(["a.txt"]) })} />);
    expect(screen.getByRole("checkbox", { name: "a.txt を選択" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "sub を選択" })).not.toBeChecked();
  });

  it("selectMode時は操作メニューを表示しない", () => {
    render(<FileTable {...baseProps({ selectMode: true })} />);
    expect(screen.queryByRole("button", { name: "操作メニュー" })).not.toBeInTheDocument();
  });
});
