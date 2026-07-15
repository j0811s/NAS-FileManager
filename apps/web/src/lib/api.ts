import type {
  AuthStatus,
  DiskUsageResponse,
  ListResponse,
  SearchResponse,
  TrashListResponse,
} from "@nas-fm/shared";

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  const res = await (init ? fetch(url, init) : fetch(url));
  if (!res.ok) {
    let code = "INTERNAL";
    let message = "エラーが発生しました";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // JSON でないレスポンスは汎用エラーのままにする
    }
    throw new ApiRequestError(code, message);
  }
  return res;
}

const JSON_HEADERS = { "content-type": "application/json" };

export const api = {
  async list(path: string): Promise<ListResponse> {
    const res = await request(`/api/list?path=${encodeURIComponent(path)}`);
    return (await res.json()) as ListResponse;
  },

  async mkdir(path: string): Promise<void> {
    await request("/api/mkdir", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ path }),
    });
  },

  async rename(from: string, to: string): Promise<void> {
    await request("/api/rename", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ from, to }),
    });
  },

  async remove(path: string): Promise<void> {
    await request(`/api/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  },

  async listTrash(): Promise<TrashListResponse> {
    const res = await request("/api/trash");
    return (await res.json()) as TrashListResponse;
  },

  async restoreFromTrash(id: string): Promise<void> {
    await request("/api/trash/restore", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ id }),
    });
  },

  async purgeTrashEntry(id: string): Promise<void> {
    await request(`/api/trash?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async search(query: string): Promise<SearchResponse> {
    const res = await request(`/api/search?q=${encodeURIComponent(query)}`);
    return (await res.json()) as SearchResponse;
  },

  downloadUrl(path: string): string {
    return `/api/download?path=${encodeURIComponent(path)}`;
  },

  previewUrl(path: string): string {
    return `/api/preview?path=${encodeURIComponent(path)}`;
  },

  thumbnailUrl(path: string, variant?: "preview"): string {
    const size = variant ? `&size=${variant}` : "";
    return `/api/thumbnail?path=${encodeURIComponent(path)}${size}`;
  },

  async login(password: string): Promise<void> {
    await request("/api/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ password }),
    });
  },

  async logout(): Promise<void> {
    await request("/api/auth/logout", { method: "POST" });
  },

  async me(): Promise<AuthStatus> {
    const res = await request("/api/auth/me");
    return (await res.json()) as AuthStatus;
  },

  async diskUsage(): Promise<DiskUsageResponse> {
    const res = await request("/api/disk-usage");
    return (await res.json()) as DiskUsageResponse;
  },

  upload(
    dirPath: string,
    file: File,
    opts: { onProgress?: (pct: number) => void } = {},
  ): Promise<void> {
    const rel = dirPath ? `${dirPath}/${file.name}` : file.name;
    const url = `/api/upload?path=${encodeURIComponent(rel)}`;
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && opts.onProgress) {
          opts.onProgress((e.loaded / e.total) * 100);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let code = "INTERNAL";
        let message = "アップロードに失敗しました";
        try {
          const body = JSON.parse(xhr.responseText) as {
            error?: { code?: string; message?: string };
          };
          code = body.error?.code ?? code;
          message = body.error?.message ?? message;
        } catch {
          // 非 JSON は汎用エラー
        }
        reject(new ApiRequestError(code, message));
      });
      xhr.addEventListener("error", () =>
        reject(new ApiRequestError("INTERNAL", "ネットワークエラー")),
      );
      xhr.send(file);
    });
  },
};
