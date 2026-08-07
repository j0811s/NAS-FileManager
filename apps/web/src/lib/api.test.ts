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
  vi.restoreAllMocks();
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

describe("api.deleteBulk", () => {
  it("paths を JSON body で POST し結果を返す", async () => {
    mockFetch(200, { results: [{ path: "a.txt", ok: true }] });
    const res = await api.deleteBulk(["a.txt"]);
    expect(res).toEqual({ results: [{ path: "a.txt", ok: true }] });
    expect(fetch).toHaveBeenCalledWith(
      "/api/delete-bulk",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ paths: ["a.txt"] }) }),
    );
  });

  it("失敗時は ApiRequestError", async () => {
    mockFetch(400, { error: { code: "INVALID_REQUEST", message: "x" } });
    await expect(api.deleteBulk([])).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("api.downloadBulk", () => {
  it("paths ごとの hidden input を持つ form を組み立てて POST 送信する", () => {
    let capturedForm: HTMLFormElement | undefined;
    const submitSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "form") {
        capturedForm = el as HTMLFormElement;
        (el as HTMLFormElement).submit = submitSpy;
      }
      return el;
    });

    api.downloadBulk(["a.txt", "sub/b.txt"]);

    expect(capturedForm?.method).toBe("post");
    expect(capturedForm?.action).toContain("/api/download-bulk");
    expect(capturedForm?.target).toBe("_blank");
    const values = Array.from(capturedForm?.querySelectorAll('input[name="paths"]') ?? []).map(
      (el) => (el as HTMLInputElement).value,
    );
    expect(values).toEqual(["a.txt", "sub/b.txt"]);
    const formEntries = [...new FormData(capturedForm!)].map(([k, v]) => [k, String(v)]);
    expect(new URLSearchParams(formEntries).toString()).toBe("paths=a.txt&paths=sub%2Fb.txt");
    expect(submitSpy).toHaveBeenCalledTimes(1);
    createElementSpy.mockRestore();
  });
});
