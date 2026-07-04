import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useUpload } from "./useUpload";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useUpload", () => {
  it("アップロード成功で成功トーストを出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const { result } = renderHook(() => useUpload("docs"), { wrapper });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(api.upload).toHaveBeenCalledWith("docs", expect.any(File), expect.any(Object));
    expect(success).toHaveBeenCalled();
  });

  it("失敗でエラートーストを出す", async () => {
    vi.spyOn(api, "upload").mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const { result } = renderHook(() => useUpload(""), { wrapper });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(error).toHaveBeenCalled();
  });
});
