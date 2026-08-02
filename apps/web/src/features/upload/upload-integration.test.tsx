import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { UploadDropzone } from "./components/UploadDropzone";
import { UploadTray } from "./components/UploadTray";
import { __resetForTests } from "./store/uploadQueueStore";

beforeEach(() => __resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("UploadDropzone + UploadTray 統合", () => {
  it("ドロップゾーンで選択したファイルがトレイに反映され、完了まで追跡できる", async () => {
    let resolveUpload!: () => void;
    vi.spyOn(api, "upload").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    render(
      <>
        <UploadDropzone path="docs" />
        <UploadTray />
      </>,
    );

    const input = screen.getByTestId("upload-input");
    await userEvent.upload(input, new File(["x"], "a.txt"));

    expect(screen.getByText("アップロード中 0/1件 (0%)")).toBeInTheDocument();

    resolveUpload();
    expect(await screen.findByText("アップロード完了 1件")).toBeInTheDocument();
  });
});
