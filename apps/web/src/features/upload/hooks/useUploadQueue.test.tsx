import { renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { useUploadQueue } from "./useUploadQueue";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("useUploadQueue", () => {
  it("ストアの現在のアイテム一覧を返す", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useUploadQueue());
    expect(result.current).toEqual([]);

    act(() => {
      uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    });
    expect(result.current).toHaveLength(1);
  });
});
