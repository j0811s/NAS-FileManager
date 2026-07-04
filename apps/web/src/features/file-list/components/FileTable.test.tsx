import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTable } from "./FileTable";

const entries: FileEntry[] = [
  { name: "sub", size: 0, mtime: 1700000000000, type: "dir" },
  { name: "a.txt", size: 12, mtime: 1700000000000, type: "file" },
];

describe("FileTable", () => {
  it("エントリ名を表示する", () => {
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={() => {}}
      />,
    );
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("a.txt")).toBeInTheDocument();
  });

  it("ディレクトリ名クリックで onOpenDir を呼ぶ", async () => {
    const onOpenDir = vi.fn();
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={() => {}}
        onOpenDir={onOpenDir}
      />,
    );
    await userEvent.click(screen.getByText("sub"));
    expect(onOpenDir).toHaveBeenCalledWith("sub");
  });

  it("名前ヘッダクリックで onSortChange('name')", async () => {
    const onSortChange = vi.fn();
    render(
      <FileTable
        entries={entries}
        sortKey="name"
        sortDir="asc"
        onSortChange={onSortChange}
        onOpenDir={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前/ }));
    expect(onSortChange).toHaveBeenCalledWith("name");
  });
});
