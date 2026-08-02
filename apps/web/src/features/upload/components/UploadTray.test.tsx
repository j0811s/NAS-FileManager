import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadTray } from "./UploadTray";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("UploadTray", () => {
  it("キューが空のときは何も描画しない", () => {
    const { container } = render(<UploadTray />);
    expect(container).toBeEmptyDOMElement();
  });

  it("アップロード中は件数と%を表示する", () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    expect(screen.getByText("アップロード中 0/1件 (0%)")).toBeInTheDocument();
  });

  it("全件完了後は完了件数の表示に切り替わる", async () => {
    vi.spyOn(api, "upload").mockResolvedValue();
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    expect(await screen.findByText("アップロード完了 1件")).toBeInTheDocument();
  });

  it("クリックで詳細シートを開く", async () => {
    vi.spyOn(api, "upload").mockReturnValue(new Promise(() => {}));
    uploadQueueStore.enqueue("docs", [new File(["x"], "a.txt")]);
    render(<UploadTray />);
    await userEvent.click(screen.getByRole("button", { name: /アップロード中/ }));
    expect(screen.getByText("アップロード状況")).toBeInTheDocument();
  });
});
