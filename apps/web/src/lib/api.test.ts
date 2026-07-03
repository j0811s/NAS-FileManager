import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./api";

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.list", () => {
  it("list を GET し JSON を返す", async () => {
    mockFetch(200, { path: "docs", entries: [] });
    const res = await api.list("docs");
    expect(res).toEqual({ path: "docs", entries: [] });
    expect(fetch).toHaveBeenCalledWith("/api/list?path=docs");
  });

  it("非 2xx は ApiRequestError（code 付き）を throw", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "not found" } });
    await expect(api.list("x")).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.list("x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("api.mkdir / rename / remove", () => {
  it("mkdir は JSON body で POST", async () => {
    mockFetch(201, { ok: true });
    await api.mkdir("docs/new");
    expect(fetch).toHaveBeenCalledWith("/api/mkdir", expect.objectContaining({ method: "POST" }));
  });

  it("remove は DELETE", async () => {
    mockFetch(200, { ok: true });
    await api.remove("docs/a.txt");
    expect(fetch).toHaveBeenCalledWith("/api/delete?path=docs%2Fa.txt", expect.objectContaining({ method: "DELETE" }));
  });
});

describe("api.downloadUrl", () => {
  it("パスをエンコードした download URL を返す", () => {
    expect(api.downloadUrl("docs/レポート.txt")).toBe(`/api/download?path=${encodeURIComponent("docs/レポート.txt")}`);
  });
});
