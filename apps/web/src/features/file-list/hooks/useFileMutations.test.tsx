import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ApiRequestError } from "@/lib/api";
import { useFileMutations } from "./useFileMutations";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useFileMutations", () => {
  it("mkdir は現在パス配下に作成し成功トーストを出す", async () => {
    const mkdir = vi.spyOn(api, "mkdir").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.mkdir.mutate("new");
    await waitFor(() => expect(mkdir).toHaveBeenCalledWith("docs/new"));
    await waitFor(() => expect(success).toHaveBeenCalled());
  });

  it("失敗時は code に応じたエラートーストを出す", async () => {
    vi.spyOn(api, "mkdir").mockRejectedValue(new ApiRequestError("CONFLICT", "x"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations(""), { wrapper });
    result.current.mkdir.mutate("dup");
    await waitFor(() => expect(error).toHaveBeenCalledWith("同名の項目が既に存在します"));
  });
});
