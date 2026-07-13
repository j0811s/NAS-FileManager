import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { DiskUsageBadge } from "./DiskUsageBadge";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("DiskUsageBadge", () => {
  it("データ取得前は何も描画しない", () => {
    vi.spyOn(api, "diskUsage").mockImplementation(() => new Promise(() => {}));
    const { container } = render(<DiskUsageBadge />, { wrapper });
    expect(container).toBeEmptyDOMElement();
  });

  it("使用率90%未満は通常色で GB 表示する", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 50 * 1024 ** 3,
      free: 50 * 1024 ** 3,
    });
    render(<DiskUsageBadge />, { wrapper });
    const el = await screen.findByText("50.0GB / 100.0GB");
    expect(el.className).toContain("text-muted-foreground");
    expect(el.className).not.toContain("text-destructive");
  });

  it("使用率90%以上は警告色になる", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({
      total: 100 * 1024 ** 3,
      used: 95 * 1024 ** 3,
      free: 5 * 1024 ** 3,
    });
    render(<DiskUsageBadge />, { wrapper });
    const el = await screen.findByText("95.0GB / 100.0GB");
    expect(el.className).toContain("text-destructive");
  });
});
