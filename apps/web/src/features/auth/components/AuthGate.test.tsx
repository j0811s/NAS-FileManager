import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { AuthGate } from "./AuthGate";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("AuthGate", () => {
  it("認証済みなら children を表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: true });
    renderWithClient(
      <AuthGate>
        <p>protected</p>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByText("protected")).toBeInTheDocument());
  });

  it("未認証ならログインフォームを表示する", async () => {
    vi.spyOn(api, "me").mockResolvedValue({ authenticated: false });
    renderWithClient(
      <AuthGate>
        <p>protected</p>
      </AuthGate>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ログイン" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("protected")).toBeNull();
  });
});
