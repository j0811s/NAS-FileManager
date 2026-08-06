import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkDeleteDialog } from "./BulkDeleteDialog";

describe("BulkDeleteDialog", () => {
  it("件数を含む確認文言を表示し、確定で onConfirm を呼ぶ", async () => {
    const onConfirm = vi.fn();
    render(<BulkDeleteDialog open onOpenChange={() => {}} targetCount={8} onConfirm={onConfirm} />);
    expect(screen.getByText(/選択した8件/)).toBeInTheDocument();
    expect(screen.getByText(/ゴミ箱に移動します/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
