import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

describe("App", () => {
  it("ヘッダにアプリ名を表示する", () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: false });
    render(<App />);
    expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeInTheDocument();
  });

  it("未認証ではログインフォームを表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: false });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument(),
    );
  });

  it("認証済みでは一覧（ログアウト）とディスク使用量とゴミ箱ボタンと検索ボタンを表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: true });
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 50 * 1024 ** 3,
      free: 50 * 1024 ** 3,
    });
    vi.spyOn(api, "listTrash").mockResolvedValue({ entries: [] });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("50.0GB / 100.0GB")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "ゴミ箱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "検索" })).toBeInTheDocument();
  });
});
