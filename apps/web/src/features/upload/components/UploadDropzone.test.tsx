import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadDropzone } from "./UploadDropzone";

beforeEach(() => {
  __resetForTests();
  vi.spyOn(uploadQueueStore, "enqueue").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("UploadDropzone", () => {
  it("ファイル選択でキューに現在パスで積む", async () => {
    render(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(uploadQueueStore.enqueue).toHaveBeenCalledWith("docs", [expect.any(File)]);
  });

  it("選択後に input の値をリセットし同じファイルを再選択できるようにする", async () => {
    render(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(input.value).toBe("");
  });
});
