import { ApiRequestError, api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export type UploadItemStatus = "pending" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  file: File;
  path: string;
  status: UploadItemStatus;
  progress: number;
  errorCode?: string;
};

const MAX_CONCURRENT = 3;

let items: UploadItem[] = [];
let activeCount = 0;
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function updateItem(id: string, patch: Partial<UploadItem>) {
  items = items.map((it) => (it.id === id ? { ...it, ...patch } : it));
  emit();
}

function runWorker() {
  while (activeCount < MAX_CONCURRENT) {
    const next = items.find((it) => it.status === "pending");
    if (!next) return;
    activeCount++;
    updateItem(next.id, { status: "uploading" });
    void runOne(next);
  }
}

async function runOne(item: UploadItem) {
  try {
    await api.upload(item.path, item.file, {
      onProgress: (progress) => updateItem(item.id, { progress }),
    });
    updateItem(item.id, { status: "done", progress: 100 });
    queryClient.invalidateQueries({ queryKey: ["list", item.path] });
    queryClient.invalidateQueries({ queryKey: ["disk-usage"] });
  } catch (err) {
    const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
    if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
    updateItem(item.id, { status: "error", errorCode: code });
  } finally {
    activeCount--;
    runWorker();
  }
}

export const uploadQueueStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): UploadItem[] {
    return items;
  },
  enqueue(path: string, files: File[]): void {
    const newItems: UploadItem[] = files.map((file) => ({
      id: String(nextId++),
      file,
      path,
      status: "pending",
      progress: 0,
    }));
    items = [...items, ...newItems];
    emit();
    runWorker();
  },
  retry(id: string): void {
    updateItem(id, { status: "pending", progress: 0, errorCode: undefined });
    queueMicrotask(runWorker);
  },
  dismiss(id: string): void {
    items = items.filter((it) => it.id !== id);
    emit();
  },
  clearCompleted(): void {
    items = items.filter((it) => it.status !== "done");
    emit();
  },
};

export function __resetForTests(): void {
  items = [];
  activeCount = 0;
  nextId = 0;
  listeners.clear();
}
