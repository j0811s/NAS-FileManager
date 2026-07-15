import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { SearchDialog } from "./SearchDialog";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("SearchDialog", () => {
  it("未入力では案内文を表示する", () => {
    renderWithClient(<SearchDialog open onOpenChange={() => {}} />);
    expect(screen.getByText("検索キーワードを入力してください")).toBeInTheDocument();
  });

  it("入力すると(デバウンス後に)結果を表示する", async () => {
    vi.spyOn(api, "search").mockResolvedValue({
      entries: [
        { name: "report.txt", path: "docs/report.txt", type: "file", size: 1024, mtime: 0 },
      ],
      truncated: false,
    });
    renderWithClient(<SearchDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText("ファイル名・フォルダ名で検索"), "report");
    await waitFor(() => expect(screen.getByText("report.txt")).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.getByText("docs/report.txt")).toBeInTheDocument();
  });

  it("0件のときは見つからなかった旨を表示する", async () => {
    vi.spyOn(api, "search").mockResolvedValue({ entries: [], truncated: false });
    renderWithClient(<SearchDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText("ファイル名・フォルダ名で検索"), "nomatch");
    await waitFor(() => expect(screen.getByText("見つかりませんでした")).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it("truncatedのときは一部のみ表示している旨を出す", async () => {
    vi.spyOn(api, "search").mockResolvedValue({
      entries: [{ name: "a.txt", path: "a.txt", type: "file", size: 1, mtime: 0 }],
      truncated: true,
    });
    renderWithClient(<SearchDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText("ファイル名・フォルダ名で検索"), "a");
    await waitFor(
      () => expect(screen.getByText("結果が多いため一部のみ表示しています")).toBeInTheDocument(),
      { timeout: 2000 },
    );
  });

  it("結果をクリックすると親フォルダへ移動しダイアログを閉じる", async () => {
    vi.spyOn(api, "search").mockResolvedValue({
      entries: [
        { name: "report.txt", path: "docs/2024/report.txt", type: "file", size: 1, mtime: 0 },
      ],
      truncated: false,
    });
    const onOpenChange = vi.fn();
    renderWithClient(<SearchDialog open onOpenChange={onOpenChange} />);
    await userEvent.type(screen.getByPlaceholderText("ファイル名・フォルダ名で検索"), "report");
    await waitFor(() => expect(screen.getByText("report.txt")).toBeInTheDocument(), {
      timeout: 2000,
    });
    await userEvent.click(screen.getByText("report.txt"));
    expect(window.location.hash).toBe("#/docs/2024");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
