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

  it("失敗時も一覧を再取得し古い表示を修復する", async () => {
    vi.spyOn(api, "remove").mockRejectedValue(new ApiRequestError("NOT_FOUND", "x"));
    vi.spyOn(toast, "error").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations("docs"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    result.current.remove.mutate("docs/gone.txt");
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["list", "docs"] }),
    );
  });

  it("削除成功時に disk-usage も再取得する", async () => {
    vi.spyOn(api, "remove").mockResolvedValue();
    vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations("docs"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    result.current.remove.mutate("docs/gone.txt");
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["disk-usage"] }),
    );
  });

  it("bulkDelete: 全成功時は成功トーストを出しinvalidateする", async () => {
    vi.spyOn(api, "deleteBulk").mockResolvedValue({
      results: [
        { path: "docs/a.txt", ok: true },
        { path: "docs/b.txt", ok: true },
      ],
    });
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useFileMutations("docs"), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    result.current.bulkDelete.mutate(["docs/a.txt", "docs/b.txt"]);
    await waitFor(() => expect(success).toHaveBeenCalledWith("2件削除しました"));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["list", "docs"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["disk-usage"] });
  });

  it("bulkDelete: 一部失敗時は失敗件数を含むエラートーストを出す", async () => {
    vi.spyOn(api, "deleteBulk").mockResolvedValue({
      results: [
        { path: "docs/a.txt", ok: true },
        { path: "docs/b.txt", ok: false, errorCode: "NOT_FOUND" },
      ],
    });
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useFileMutations("docs"), { wrapper });
    result.current.bulkDelete.mutate(["docs/a.txt", "docs/b.txt"]);
    await waitFor(() => expect(error).toHaveBeenCalledWith("1件削除しました（1件失敗）"));
  });
});
