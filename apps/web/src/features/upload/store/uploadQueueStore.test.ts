import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "./uploadQueueStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("uploadQueueStore", () => {
  it("enqueue でアイテムが pending として積まれる", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    expect(uploadQueueStore.getSnapshot()).toHaveLength(1);
  });

  it("同時実行数を3件に制限し、空きが出たら次を開始する", async () => {
    const deferreds = Array.from({ length: 5 }, () => deferred<void>());
    let callIndex = 0;
    vi.spyOn(api, "upload").mockImplementation(() => deferreds[callIndex++]!.promise);

    const files = Array.from({ length: 5 }, (_, i) => new File(["x"], `f${i}.txt`));
    uploadQueueStore.enqueue("docs", files);

    expect(api.upload).toHaveBeenCalledTimes(3);
    const snapshot1 = uploadQueueStore.getSnapshot();
    expect(snapshot1.filter((it) => it.status === "uploading")).toHaveLength(3);
    expect(snapshot1.filter((it) => it.status === "pending")).toHaveLength(2);

    deferreds[0]!.resolve();
    await vi.waitFor(() => expect(api.upload).toHaveBeenCalledTimes(4));
    const snapshot2 = uploadQueueStore.getSnapshot();
    expect(snapshot2.filter((it) => it.status === "uploading")).toHaveLength(3);
    expect(snapshot2.filter((it) => it.status === "done")).toHaveLength(1);
  });

  it("失敗した項目は error になり、retry で pending に戻って再送される", async () => {
    vi.spyOn(api, "upload").mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce();
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => {
      expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("error");
    });
    const id = uploadQueueStore.getSnapshot()[0]!.id;

    uploadQueueStore.retry(id);
    expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("pending");
    await vi.waitFor(() => {
      expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("done");
    });
    expect(api.upload).toHaveBeenCalledTimes(2);
  });

  it("dismiss で該当アイテムのみ除去する", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    const [first, second] = uploadQueueStore.getSnapshot();
    uploadQueueStore.dismiss(first!.id);
    expect(uploadQueueStore.getSnapshot()).toEqual([second]);
  });

  it("clearCompleted で done のみ除去し pending/uploading/error は残す", async () => {
    vi.spyOn(api, "upload").mockResolvedValueOnce().mockRejectedValueOnce(new Error("boom"));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => {
      const statuses = uploadQueueStore.getSnapshot().map((it) => it.status);
      expect(statuses.sort()).toEqual(["done", "error"]);
    });
    uploadQueueStore.clearCompleted();
    expect(uploadQueueStore.getSnapshot()).toHaveLength(1);
    expect(uploadQueueStore.getSnapshot()[0]?.status).toBe("error");
  });

  it("subscribe したリスナーが state 変化のたびに呼ばれる", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    const listener = vi.fn();
    const unsubscribe = uploadQueueStore.subscribe(listener);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe("uploadQueueStore のサマリートースト", () => {
  it("全件成功でサマリー成功トーストを1回出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));
    expect(success).toHaveBeenCalledWith("2件アップロードしました");
  });

  it("一部失敗ありでサマリー失敗トーストを出す", async () => {
    vi.spyOn(api, "upload").mockResolvedValueOnce().mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt"), new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith("1件成功、1件失敗しました");
  });

  it("全件失敗でサマリー失敗トーストを出す", async () => {
    vi.spyOn(api, "upload").mockRejectedValue(new Error("boom"));
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    expect(error).toHaveBeenCalledWith("1件のアップロードに失敗しました");
  });

  it("未クリアの既存 done 項目は次のサマリーに含めない", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    const success = vi.spyOn(toast, "success").mockReturnValue("" as never);
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(1));

    uploadQueueStore.enqueue("docs", [new File(["y"], "b.txt")]);
    await vi.waitFor(() => expect(success).toHaveBeenCalledTimes(2));
    expect(success).toHaveBeenLastCalledWith("1件アップロードしました");
  });
});

describe("uploadQueueStore の beforeunload 連携", () => {
  it("未完了アイテムがある間はタブを閉じる操作をブロックする", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("未完了アイテムがなければタブを閉じる操作をブロックしない", () => {
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
