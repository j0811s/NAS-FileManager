import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useTrash } from "./useTrash";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useTrash", () => {
  it("ゴミ箱の一覧を取得する", async () => {
    vi.spyOn(api, "listTrash").mockResolvedValue({
      entries: [
        { id: "1", name: "a.txt", originalPath: "a.txt", type: "file", size: 5, deletedAt: 1 },
      ],
    });
    const { result } = renderHook(() => useTrash(), { wrapper });
    await waitFor(() => expect(result.current.data?.entries).toHaveLength(1));
  });
});
