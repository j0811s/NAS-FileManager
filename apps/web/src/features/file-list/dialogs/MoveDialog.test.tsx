import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { MoveDialog } from "./MoveDialog";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("MoveDialog", () => {
  it("移動対象の名前をタイトルに表示する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    renderWithClient(
      <MoveDialog
        open
        onOpenChange={() => {}}
        entry={{ name: "a.txt", size: 1, mtime: 0, type: "file" }}
        currentPath=""
        onSubmit={() => {}}
      />,
    );
    expect(await screen.findByText(/a\.txt/)).toBeInTheDocument();
  });

  it("現在フォルダ直下のサブフォルダのみ表示し、ファイルは含めない", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "docs", size: 0, mtime: 0, type: "dir" },
        { name: "a.txt", size: 1, mtime: 0, type: "file" },
      ],
    });
    renderWithClient(
      <MoveDialog
        open
        onOpenChange={() => {}}
        entry={{ name: "a.txt", size: 1, mtime: 0, type: "file" }}
        currentPath=""
        onSubmit={() => {}}
      />,
    );
    expect(await screen.findByText("docs")).toBeInTheDocument();
    expect(screen.queryByText("a.txt", { selector: "button" })).not.toBeInTheDocument();
  });

  it("移動対象自身(フォルダ)は一覧から除外する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [
        { name: "docs", size: 0, mtime: 0, type: "dir" },
        { name: "self", size: 0, mtime: 0, type: "dir" },
      ],
    });
    renderWithClient(
      <MoveDialog
        open
        onOpenChange={() => {}}
        entry={{ name: "self", size: 0, mtime: 0, type: "dir" }}
        currentPath=""
        onSubmit={() => {}}
      />,
    );
    expect(await screen.findByText("docs")).toBeInTheDocument();
    expect(screen.queryByText("self")).not.toBeInTheDocument();
  });

  it("現在地のままでは「ここに移動」が無効", async () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    renderWithClient(
      <MoveDialog
        open
        onOpenChange={() => {}}
        entry={{ name: "a.txt", size: 1, mtime: 0, type: "file" }}
        currentPath=""
        onSubmit={() => {}}
      />,
    );
    expect(await screen.findByRole("button", { name: "ここに移動" })).toBeDisabled();
  });

  it("サブフォルダに移動してから確定すると onSubmit に移動先パスを渡す", async () => {
    vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [{ name: "docs", size: 0, mtime: 0, type: "dir" as const }]
          : [{ name: "inner", size: 0, mtime: 0, type: "dir" as const }],
    }));
    const onSubmit = vi.fn();
    renderWithClient(
      <MoveDialog
        open
        onOpenChange={() => {}}
        entry={{ name: "a.txt", size: 1, mtime: 0, type: "file" }}
        currentPath=""
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(await screen.findByText("docs"));
    await waitFor(() => expect(screen.getByText("inner")).toBeInTheDocument());
    const moveHere = screen.getByRole("button", { name: "ここに移動" });
    await waitFor(() => expect(moveHere).not.toBeDisabled());
    await userEvent.click(moveHere);
    expect(onSubmit).toHaveBeenCalledWith("docs");
  });
});
