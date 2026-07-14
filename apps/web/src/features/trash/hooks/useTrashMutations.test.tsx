import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useTrashMutations } from "./useTrashMutations";

function wrapperWithClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useTrashMutations", () => {
  it("restore 成功時に trash と list を再取得し成功トーストを出す", async () => {
    vi.spyOn(api, "restoreFromTrash").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useTrashMutations(), {
      wrapper: wrapperWithClient(client),
    });

    result.current.restore.mutate("id-1");

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] }));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["list"] });
    expect(success).toHaveBeenCalled();
  });

  it("purge 成功時に trash と disk-usage を再取得し成功トーストを出す", async () => {
    vi.spyOn(api, "purgeTrashEntry").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useTrashMutations(), {
      wrapper: wrapperWithClient(client),
    });

    result.current.purge.mutate("id-1");

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["trash"] }));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["disk-usage"] });
    expect(success).toHaveBeenCalled();
  });
});
