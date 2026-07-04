import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
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
});
