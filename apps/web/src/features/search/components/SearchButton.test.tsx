import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { SearchButton } from "./SearchButton";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("SearchButton", () => {
  it("クリックすると検索ダイアログを開く", async () => {
    renderWithClient(<SearchButton />);
    expect(screen.queryByText("検索キーワードを入力してください")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "検索" }));
    expect(await screen.findByText("検索キーワードを入力してください")).toBeInTheDocument();
  });
});
