import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RenameDialog } from "./RenameDialog";

describe("RenameDialog", () => {
  it("名前が currentName で事前入力される", () => {
    const onOpenChange = vi.fn();
    render(
      <RenameDialog open onOpenChange={onOpenChange} currentName="a.txt" onSubmit={() => {}} />,
    );
    const input = screen.getByLabelText("新しい名前") as HTMLInputElement;
    expect(input.value).toBe("a.txt");
  });

  it("名前を変更して送信すると onSubmit に新しい名前を渡す", async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RenameDialog open onOpenChange={onOpenChange} currentName="a.txt" onSubmit={onSubmit} />,
    );
    const input = screen.getByLabelText("新しい名前");
    await userEvent.clear(input);
    await userEvent.type(input, "b.txt");
    await userEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(onSubmit).toHaveBeenCalledWith("b.txt");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("名前を変更しないで送信すると onSubmit を呼ばない", async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RenameDialog open onOpenChange={onOpenChange} currentName="a.txt" onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("空名では onSubmit を呼ばない", async () => {
    const onSubmit = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RenameDialog open onOpenChange={onOpenChange} currentName="a.txt" onSubmit={onSubmit} />,
    );
    const input = screen.getByLabelText("新しい名前");
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "変更" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
