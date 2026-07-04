import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./DeleteDialog";

describe("DeleteDialog", () => {
  it("削除確認で onConfirm を呼ぶ", async () => {
    const onConfirm = vi.fn();
    render(<DeleteDialog open onOpenChange={() => {}} targetName="a.txt" onConfirm={onConfirm} />);
    expect(screen.getByText(/a\.txt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
