import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { useUpload } from "./useUpload";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function wrapperWithClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
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

  it("アップロード中はタブを閉じようとすると確認を出し、完了後は解除する", async () => {
    let resolveUpload!: () => void;
    vi.spyOn(api, "upload").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { result } = renderHook(() => useUpload("docs"), { wrapper });

    let uploadPromise!: Promise<void>;
    act(() => {
      uploadPromise = result.current.upload(new File(["x"], "a.txt"));
    });
    expect(result.current.isUploading).toBe(true);
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    await act(async () => {
      resolveUpload();
      await uploadPromise;
    });
    expect(result.current.isUploading).toBe(false);
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("401 エラーでは ['me'] を無効化しつつエラートーストも出す", async () => {
    vi.spyOn(api, "upload").mockRejectedValue(
      new ApiRequestError("UNAUTHORIZED", "認証が必要です"),
    );
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpload("docs"), { wrapper: wrapperWithClient(client) });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me"] });
    expect(error).toHaveBeenCalled();
  });

  it("アップロード成功で disk-usage も再取得する", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpload("docs"), { wrapper: wrapperWithClient(client) });
    await act(async () => {
      await result.current.upload(new File(["x"], "a.txt"));
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["disk-usage"] });
  });
});
