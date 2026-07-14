import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { TrashDialog } from "./TrashDialog";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("TrashDialog", () => {
  it("空のときは「ゴミ箱は空です」と表示する", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({ entries: [] });
    renderWithClient(<TrashDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText("ゴミ箱は空です")).toBeInTheDocument();
  });

  it("項目の名前・元の場所を一覧表示する", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({
      entries: [
        {
          id: "1",
          name: "a.txt",
          originalPath: "docs/a.txt",
          type: "file",
          size: 5,
          deletedAt: Date.now(),
        },
      ],
    });
    renderWithClient(<TrashDialog open onOpenChange={() => {}} />);
    expect(await screen.findByText("a.txt")).toBeInTheDocument();
    expect(screen.getByText("docs/a.txt")).toBeInTheDocument();
  });

  it("「復元」クリックで restore が呼ばれる", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({
      entries: [
        { id: "1", name: "a.txt", originalPath: "a.txt", type: "file", size: 5, deletedAt: 1 },
      ],
    });
    const restoreSpy = vi.spyOn(api, "restoreFromTrash").mockResolvedValue();
    renderWithClient(<TrashDialog open onOpenChange={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "復元" }));
    expect(restoreSpy).toHaveBeenCalledWith("1");
  });

  it("「完全に削除」は確認ダイアログを経てから purge を呼ぶ", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({
      entries: [
        { id: "1", name: "a.txt", originalPath: "a.txt", type: "file", size: 5, deletedAt: 1 },
      ],
    });
    const purgeSpy = vi.spyOn(api, "purgeTrashEntry").mockResolvedValue();
    renderWithClient(<TrashDialog open onOpenChange={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "完全に削除" }));
    expect(purgeSpy).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: "完全に削除する" }));
    expect(purgeSpy).toHaveBeenCalledWith("1");
  });
});
