import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { __resetForTests, type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadTraySheetContent } from "./UploadTraySheet";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

function makeItem(overrides: Partial<UploadItem>): UploadItem {
  return {
    id: "1",
    file: new File(["x"], "a.txt"),
    path: "docs",
    status: "pending",
    progress: 0,
    ...overrides,
  };
}

describe("UploadTraySheetContent", () => {
  it("ファイル名を一覧表示する", () => {
    render(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ file: new File(["x"], "photo.jpg") })]} />
      </Sheet>,
    );
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
  });

  it("待機中の項目は「待機中」を表示する", () => {
    render(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ status: "pending" })]} />
      </Sheet>,
    );
    expect(screen.getByText("待機中")).toBeInTheDocument();
  });

  it("失敗した項目にエラーメッセージと再試行ボタンを表示し、押すと retry を呼ぶ", async () => {
    const retry = vi.spyOn(uploadQueueStore, "retry").mockImplementation(() => {});
    render(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ status: "error", errorCode: "CONFLICT" })]} />
      </Sheet>,
    );
    expect(screen.getByText("同名の項目が既に存在します")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(retry).toHaveBeenCalledWith("1");
  });

  it("完了項目がある場合のみ「完了済みをクリア」ボタンを表示する", () => {
    const { rerender } = render(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ status: "pending" })]} />
      </Sheet>,
    );
    expect(screen.queryByText("完了済みをクリア")).not.toBeInTheDocument();
    rerender(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ status: "done" })]} />
      </Sheet>,
    );
    expect(screen.getByText("完了済みをクリア")).toBeInTheDocument();
  });

  it("「完了済みをクリア」クリックで clearCompleted を呼ぶ", async () => {
    const clearCompleted = vi
      .spyOn(uploadQueueStore, "clearCompleted")
      .mockImplementation(() => {});
    render(
      <Sheet open>
        <UploadTraySheetContent items={[makeItem({ status: "done" })]} />
      </Sheet>,
    );
    await userEvent.click(screen.getByText("完了済みをクリア"));
    expect(clearCompleted).toHaveBeenCalled();
  });
});
