import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { FileBrowser } from "./FileBrowser";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("FileBrowser", () => {
  it("一覧を表示する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "docs", size: 0, mtime: 0, type: "dir" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
  });

  it("フォルダを開くとそのパスで再取得する", async () => {
    const list = vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [{ name: "docs", size: 0, mtime: 0, type: "dir" as const }]
          : [{ name: "inner.txt", size: 1, mtime: 0, type: "file" as const }],
    }));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("docs")).toBeInTheDocument());
    await userEvent.click(screen.getByText("docs"));
    await waitFor(() => expect(screen.getByText("inner.txt")).toBeInTheDocument());
    expect(list).toHaveBeenCalledWith("docs");
  });

  it("移動ダイアログでサブフォルダを選び確定すると rename を呼ぶ", async () => {
    vi.spyOn(api, "list").mockImplementation(async (path) => ({
      path,
      entries:
        path === ""
          ? [
              { name: "docs", size: 0, mtime: 0, type: "dir" as const },
              { name: "a.txt", size: 1, mtime: 0, type: "file" as const },
            ]
          : [],
    }));
    const rename = vi.spyOn(api, "rename").mockResolvedValue();
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

    await userEvent.click(screen.getAllByRole("button", { name: "操作メニュー" })[1]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /移動/ }));

    const dialog = await screen.findByRole("dialog");
    const moveHere = within(dialog).getByRole("button", { name: "ここに移動" });
    await userEvent.click(within(dialog).getByText("docs"));
    await waitFor(() => expect(moveHere).not.toBeDisabled());
    await userEvent.click(moveHere);

    await waitFor(() => expect(rename).toHaveBeenCalledWith("a.txt", "docs/a.txt"));
  });

  it("取得失敗時にエラーと再試行を表示する", async () => {
    vi.spyOn(api, "list").mockRejectedValue(new Error("boom"));
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText(/読み込みに失敗/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "再試行" })).toBeInTheDocument();
  });

  it("初期表示はグリッド(localStorage 未保存時)", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("localStorage に table が保存されていればテーブル表示で始まる", async () => {
    localStorage.setItem("nas-fm:view-mode", "table");
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("切替ボタンで表示が切り替わり localStorage に保存される", async () => {
    vi.spyOn(api, "list").mockResolvedValue({
      path: "",
      entries: [{ name: "a.txt", size: 1, mtime: 0, type: "file" }],
    });
    renderWithClient(<FileBrowser />);
    await waitFor(() => expect(screen.getByText("a.txt")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "テーブル表示" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(localStorage.getItem("nas-fm:view-mode")).toBe("table");

    await userEvent.click(screen.getByRole("button", { name: "グリッド表示" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(localStorage.getItem("nas-fm:view-mode")).toBe("grid");
  });
});
