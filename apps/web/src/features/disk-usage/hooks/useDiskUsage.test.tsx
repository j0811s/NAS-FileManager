import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useDiskUsage } from "./useDiskUsage";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useDiskUsage", () => {
  it("ディスク使用量を取得する", async () => {
    vi.spyOn(api, "diskUsage").mockResolvedValue({ total: 100, used: 40, free: 60 });
    const { result } = renderHook(() => useDiskUsage(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ total: 100, used: 40, free: 60 }));
  });
});
