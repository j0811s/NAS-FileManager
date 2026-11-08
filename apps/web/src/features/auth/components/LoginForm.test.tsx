import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "@/lib/api";
import { LoginForm } from "./LoginForm";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("LoginForm", () => {
  it("パスワードを入力してログインすると api.login を呼ぶ", async () => {
    const login = vi.spyOn(api, "login").mockResolvedValue();
    renderWithClient(<LoginForm />);
    await userEvent.type(screen.getByLabelText("パスワード"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    expect(login).toHaveBeenCalledWith("secret");
  });

  it("パスワード違い（UNAUTHORIZED）は「パスワードが違います」を表示する", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiRequestError("UNAUTHORIZED", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    renderWithClient(<LoginForm />);
    await userEvent.type(screen.getByLabelText("パスワード"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("パスワードが違います"));
  });

  it("サーバエラー（INTERNAL）はパスワード違いと表示しない", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiRequestError("INTERNAL", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    renderWithClient(<LoginForm />);
    await userEvent.type(screen.getByLabelText("パスワード"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("サーバでエラーが発生しました"));
  });

  it("ネットワークエラー（fetch の reject）は接続できない旨を表示する", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new TypeError("Failed to fetch"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    renderWithClient(<LoginForm />);
    await userEvent.type(screen.getByLabelText("パスワード"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("ネットワークに接続できませんでした"));
  });

  it("試行回数制限（TOO_MANY_REQUESTS）は待機を促すメッセージを表示する", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new ApiRequestError("TOO_MANY_REQUESTS", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    renderWithClient(<LoginForm />);
    await userEvent.type(screen.getByLabelText("パスワード"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "ログイン" }));
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        "試行回数が多すぎます。しばらく待ってから再試行してください",
      ),
    );
  });
});
