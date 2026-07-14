import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { TrashButton } from "./TrashButton";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("TrashButton", () => {
  it("クリックするとゴミ箱ダイアログを開く", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({ entries: [] });
    renderWithClient(<TrashButton />);
    expect(screen.queryByText("ゴミ箱は空です")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "ゴミ箱" }));
    expect(await screen.findByText("ゴミ箱は空です")).toBeInTheDocument();
  });
});
