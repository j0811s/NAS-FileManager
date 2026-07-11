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

describe("api.previewUrl", () => {
  it("パスをエンコードした preview URL を返す", () => {
    expect(api.previewUrl("docs/レポート.txt")).toBe(`/api/preview?path=${encodeURIComponent("docs/レポート.txt")}`);
  });
});

describe("api.thumbnailUrl", () => {
  it("variant省略時はsizeパラメータを付けない", () => {
    expect(api.thumbnailUrl("docs/a.mp4")).toBe(`/api/thumbnail?path=${encodeURIComponent("docs/a.mp4")}`);
  });

  it("variant='preview'指定時はsize=previewを付ける", () => {
    expect(api.thumbnailUrl("docs/a.heic", "preview")).toBe(
      `/api/thumbnail?path=${encodeURIComponent("docs/a.heic")}&size=preview`,
    );
  });
});

describe("api.login / logout / me", () => {
  it("login は password を JSON で POST する", async () => {
    mockFetch(200, { ok: true });
    await api.login("secret");
    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
  });

  it("login 失敗は ApiRequestError", async () => {
    mockFetch(401, { error: { code: "UNAUTHORIZED", message: "invalid" } });
    await expect(api.login("bad")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("logout は POST する", async () => {
    mockFetch(200, { ok: true });
    await api.logout();
    expect(fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("me は AuthStatus を返す", async () => {
    mockFetch(200, { authenticated: true });
    expect(await api.me()).toEqual({ authenticated: true });
  });
});
