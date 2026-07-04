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

  it("認証済みでは一覧（ログアウト）を表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: true });
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument(),
    );
  });
});
