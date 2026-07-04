import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MkdirDialog } from "./MkdirDialog";

describe("MkdirDialog", () => {
  it("入力して作成すると onSubmit に名前を渡す", async () => {
    const onSubmit = vi.fn();
    render(<MkdirDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("フォルダ名"), "photos");
    await userEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(onSubmit).toHaveBeenCalledWith("photos");
  });

  it("空名では onSubmit を呼ばない", async () => {
    const onSubmit = vi.fn();
    render(<MkdirDialog open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "作成" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("キャンセルで閉じて再度開くと入力がリセットされている", async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <MkdirDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />,
    );
    await userEvent.type(screen.getByLabelText("フォルダ名"), "photos");
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(<MkdirDialog open={false} onOpenChange={onOpenChange} onSubmit={onSubmit} />);
    rerender(<MkdirDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("フォルダ名")).toHaveValue("");
  });
});
