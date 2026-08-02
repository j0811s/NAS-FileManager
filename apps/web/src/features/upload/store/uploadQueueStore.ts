import { toast } from "sonner";
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

function hasActiveItems(): boolean {
  return items.some((it) => it.status === "pending" || it.status === "uploading");
}

let settledSinceToast = { done: 0, error: 0 };

function emitSummaryToast(doneCount: number, errorCount: number) {
  if (errorCount === 0) {
    toast.success(`${doneCount}件アップロードしました`);
    return;
  }
  if (doneCount === 0) {
    toast.error(`${errorCount}件のアップロードに失敗しました`);
    return;
  }
  toast.error(`${doneCount}件成功、${errorCount}件失敗しました`);
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
    settledSinceToast = { ...settledSinceToast, done: settledSinceToast.done + 1 };
    queryClient.invalidateQueries({ queryKey: ["list", item.path] });
    queryClient.invalidateQueries({ queryKey: ["disk-usage"] });
  } catch (err) {
    const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
    if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    }
    updateItem(item.id, { status: "error", errorCode: code });
    settledSinceToast = { ...settledSinceToast, error: settledSinceToast.error + 1 };
  } finally {
    activeCount--;
    if (!hasActiveItems() && (settledSinceToast.done > 0 || settledSinceToast.error > 0)) {
      emitSummaryToast(settledSinceToast.done, settledSinceToast.error);
      settledSinceToast = { done: 0, error: 0 };
    }
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
  settledSinceToast = { done: 0, error: 0 };
  listeners.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!hasActiveItems()) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
