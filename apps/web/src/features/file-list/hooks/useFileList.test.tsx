import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useFileList } from "./useFileList";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useFileList", () => {
  it("指定パスの一覧を取得する", async () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "docs", entries: [] });
    const { result } = renderHook(() => useFileList("docs"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.list).toHaveBeenCalledWith("docs");
    expect(result.current.data).toEqual({ path: "docs", entries: [] });
  });
});
