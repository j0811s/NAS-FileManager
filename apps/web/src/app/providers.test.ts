import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { createAuthAwareQueryClient } from "./providers";

describe("createAuthAwareQueryClient", () => {
  it("UNAUTHORIZED エラーで ['me'] を無効化する", async () => {
    const client = createAuthAwareQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    client.getMutationCache().config.onError?.(
      new ApiRequestError("UNAUTHORIZED", "x"),
      undefined,
      undefined,
      // biome/oxlint 対策で any を避けるためのダミー mutation / context
      { options: {} } as never,
      {} as never,
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["me"] });
  });

  it("他のエラーでは無効化しない", async () => {
    const client = createAuthAwareQueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    client
      .getMutationCache()
      .config.onError?.(
        new ApiRequestError("CONFLICT", "x"),
        undefined,
        undefined,
        { options: {} } as never,
        {} as never,
      );
    expect(spy).not.toHaveBeenCalled();
  });
});
