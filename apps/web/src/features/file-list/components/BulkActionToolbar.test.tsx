import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkActionToolbar } from "./BulkActionToolbar";

function baseProps(overrides: Partial<Parameters<typeof BulkActionToolbar>[0]> = {}) {
  return {
    selectedCount: 2,
    totalCount: 5,
    onSelectAll: () => {},
    onExit: () => {},
    onDelete: () => {},
    onDownload: () => {},
    pending: false,
    ...overrides,
  };
}

describe("BulkActionToolbar", () => {
  it("選択件数を表示する", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 3 })} />);
    expect(screen.getByText("3件選択中")).toBeInTheDocument();
  });

  it("未選択(0件)では全選択チェックボックスは unchecked", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 0, totalCount: 5 })} />);
    expect(screen.getByRole("checkbox", { name: "全選択" })).not.toBeChecked();
  });

  it("全件選択済みでは全選択チェックボックスは checked", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 5, totalCount: 5 })} />);
    expect(screen.getByRole("checkbox", { name: "全選択" })).toBeChecked();
  });

  it("全選択チェックボックスクリックで onSelectAll を呼ぶ", async () => {
    const onSelectAll = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onSelectAll })} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "全選択" }));
    expect(onSelectAll).toHaveBeenCalled();
  });

  it("選択解除ボタンで onExit を呼ぶ", async () => {
    const onExit = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onExit })} />);
    await userEvent.click(screen.getByRole("button", { name: "選択解除" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("ダウンロード/削除ボタンでそれぞれ onDownload/onDelete を呼ぶ", async () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    render(<BulkActionToolbar {...baseProps({ onDownload, onDelete })} />);
    await userEvent.click(screen.getByRole("button", { name: "ダウンロード" }));
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onDownload).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it("selectedCount が 0 のときダウンロード/削除ボタンは disabled", () => {
    render(<BulkActionToolbar {...baseProps({ selectedCount: 0 })} />);
    expect(screen.getByRole("button", { name: "ダウンロード" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });

  it("pending時はダウンロード/削除ボタンは disabled", () => {
    render(<BulkActionToolbar {...baseProps({ pending: true })} />);
    expect(screen.getByRole("button", { name: "ダウンロード" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "削除" })).toBeDisabled();
  });
});
