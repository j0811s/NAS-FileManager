import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiError, ListResponse } from "@nas-fm/shared";
import { createApp } from "../../app";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nasfm-routes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const jsonHeaders = { "content-type": "application/json" };

describe("GET /api/list", () => {
  it("root 直下を列挙する", async () => {
    await writeFile(path.join(root, "a.txt"), "abc");
    const app = createApp(root);
    const res = await app.request("/api/list?path=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListResponse;
    expect(body.path).toBe("");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].name).toBe("a.txt");
  });

  it("存在しないディレクトリは 404 + NOT_FOUND", async () => {
    const app = createApp(root);
    const res = await app.request("/api/list?path=missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("パストラバーサルは 400 + PATH_TRAVERSAL", async () => {
    const app = createApp(root);
    const res = await app.request("/api/list?path=..%2F..%2Fetc");
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe("PATH_TRAVERSAL");
  });

  it("想定外の fs エラー（EACCES）は内部情報を漏らさず 500 + INTERNAL を返し console.error に記録する", async () => {
    const restricted = path.join(root, "restricted");
    await mkdir(restricted);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // 読み取り権限を剥奪し、readdir が EACCES を投げるようにする
      await chmod(restricted, 0o000);
      const app = createApp(root);
      const res = await app.request("/api/list?path=restricted");
      expect(res.status).toBe(500);
      const body = (await res.json()) as ApiError;
      expect(body.error.code).toBe("INTERNAL");
      expect(body.error.message).toBe("internal server error");
      expect(body.error.message).not.toContain(root);
      expect(body.error.message).not.toContain("EACCES");
      expect(body.error.message).not.toContain("unexpected error:");
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      // afterEach の rm({ recursive: true }) が読めるように権限を戻す
      await chmod(restricted, 0o755);
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("POST /api/upload", () => {
  it("新規ファイルを書き込み 201 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt", { method: "POST", body: "hello" });
    expect(res.status).toBe(201);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("hello");
  });

  it("既存ファイルは 409", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt", { method: "POST", body: "new" });
    expect(res.status).toBe(409);
  });

  it("overwrite=true で上書きできる", async () => {
    await writeFile(path.join(root, "up.txt"), "old");
    const app = createApp(root);
    const res = await app.request("/api/upload?path=up.txt&overwrite=true", {
      method: "POST",
      body: "new",
    });
    expect(res.status).toBe(201);
    expect(await readFile(path.join(root, "up.txt"), "utf8")).toBe("new");
  });

  it("path が無いと 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/upload", { method: "POST", body: "x" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/download", () => {
  it("ヘッダ付きでファイル内容をストリーム返却する（日本語名は RFC 5987）", async () => {
    await writeFile(path.join(root, "レポート.txt"), "hello");
    const app = createApp(root);
    const res = await app.request(`/api/download?path=${encodeURIComponent("レポート.txt")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("レポート.txt")}`,
    );
    expect(await res.text()).toBe("hello");
  });

  it("ディレクトリ指定は 400", async () => {
    await mkdir(path.join(root, "sub"));
    const app = createApp(root);
    const res = await app.request("/api/download?path=sub");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/mkdir", () => {
  it("ディレクトリを作成し 201 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(201);
  });

  it("同名ありは 409", async () => {
    await mkdir(path.join(root, "newdir"));
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ path: "newdir" }),
    });
    expect(res.status).toBe(409);
  });

  it("不正な JSON ボディは 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/mkdir", {
      method: "POST",
      headers: jsonHeaders,
      body: "not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/rename", () => {
  it("ファイルをリネームする", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const app = createApp(root);
    const res = await app.request("/api/rename", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ from: "a.txt", to: "b.txt" }),
    });
    expect(res.status).toBe(200);
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("x");
  });

  it("移動先ありは 409", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    await writeFile(path.join(root, "b.txt"), "y");
    const app = createApp(root);
    const res = await app.request("/api/rename", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ from: "a.txt", to: "b.txt" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/delete", () => {
  it("ファイルを削除する", async () => {
    await writeFile(path.join(root, "a.txt"), "x");
    const app = createApp(root);
    const res = await app.request("/api/delete?path=a.txt", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  it("存在しないパスは 404", async () => {
    const app = createApp(root);
    const res = await app.request("/api/delete?path=missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("root の削除（path 空）は 400", async () => {
    const app = createApp(root);
    const res = await app.request("/api/delete?path=", { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

describe("GET /health", () => {
  it("200 を返す", async () => {
    const app = createApp(root);
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
