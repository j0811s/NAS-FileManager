import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useSearch } from "./useSearch";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useSearch", () => {
  it("空文字では api.search を呼ばない", () => {
    const searchSpy = vi.spyOn(api, "search").mockResolvedValue({ entries: [], truncated: false });
    renderHook(() => useSearch(""), { wrapper });
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("非空文字では api.search を呼び結果を返す", async () => {
    vi.spyOn(api, "search").mockResolvedValue({
      entries: [{ name: "a.txt", path: "a.txt", type: "file", size: 1, mtime: 0 }],
      truncated: false,
    });
    const { result } = renderHook(() => useSearch("a"), { wrapper });
    await waitFor(() => expect(result.current.data?.entries).toHaveLength(1));
  });

  it("前後の空白はtrimしてからqueryKey/呼び出しに使う", async () => {
    const searchSpy = vi.spyOn(api, "search").mockResolvedValue({ entries: [], truncated: false });
    renderHook(() => useSearch("  a  "), { wrapper });
    await waitFor(() => expect(searchSpy).toHaveBeenCalledWith("a"));
  });
});
