import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetForTests, uploadQueueStore } from "../store/uploadQueueStore";
import { UploadDropzone } from "./UploadDropzone";

beforeEach(() => {
  __resetForTests();
  vi.spyOn(uploadQueueStore, "enqueue").mockImplementation(() => {});
  vi.spyOn(uploadQueueStore, "enqueueCollected").mockImplementation(() => {});
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
  it("「フォルダを選択」の input は webkitdirectory 付きで、選んだフォルダ構造のまま積む", async () => {
    render(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-folder-input") as HTMLInputElement;
    expect(input).toHaveAttribute("webkitdirectory");
    const file = new File(["x"], "1.jpg");
    Object.defineProperty(file, "webkitRelativePath", { value: "photos/2026/1.jpg" });
    await userEvent.upload(input, file);
    expect(uploadQueueStore.enqueueCollected).toHaveBeenCalledWith("docs", [
      { file: expect.any(File), relDir: "photos/2026" },
    ]);
    expect(input.value).toBe("");
  });

  it("「フォルダを選択」ボタンはドロップ領域のファイル選択を開かない", async () => {
    render(<UploadDropzone path="docs" />);
    const fileInput = screen.getByTestId("upload-input") as HTMLInputElement;
    const folderInput = screen.getByTestId("upload-folder-input") as HTMLInputElement;
    const fileClick = vi.spyOn(fileInput, "click");
    const folderClick = vi.spyOn(folderInput, "click");
    await userEvent.click(screen.getByRole("button", { name: "フォルダを選択" }));
    expect(folderClick).toHaveBeenCalled();
    expect(fileClick).not.toHaveBeenCalled();
  });

  it("フォルダをドロップすると中身をたどってフォルダ構造のまま積む", async () => {
    render(<UploadDropzone path="docs" />);
    const folder = {
      isFile: false,
      isDirectory: true,
      name: "photos",
      createReader: () => {
        let done = false;
        return {
          readEntries: (ok: (e: unknown[]) => void) => {
            const batch = done
              ? []
              : [
                  {
                    isFile: true,
                    isDirectory: false,
                    name: "1.jpg",
                    file: (cb: (f: File) => void) => cb(new File(["x"], "1.jpg")),
                  },
                ];
            done = true;
            ok(batch);
          },
        };
      },
    };
    fireEvent.drop(screen.getByText(/ドラッグ＆ドロップ/), {
      dataTransfer: { items: [{ kind: "file", webkitGetAsEntry: () => folder }], files: [] },
    });
    await waitFor(() =>
      expect(uploadQueueStore.enqueueCollected).toHaveBeenCalledWith("docs", [
        { file: expect.any(File), relDir: "photos" },
      ]),
    );
  });

  function fileEntryOf(name: string) {
    return {
      isFile: true,
      isDirectory: false,
      name,
      file: (cb: (f: File) => void) => cb(new File(["x"], name)),
    };
  }

  it("ファイル単体のドロップは従来どおり現在パス直下に積む（relDir は空）", async () => {
    render(<UploadDropzone path="docs" />);
    fireEvent.drop(screen.getByText(/ドラッグ＆ドロップ/), {
      dataTransfer: {
        items: [{ kind: "file", webkitGetAsEntry: () => fileEntryOf("a.txt") }],
        files: [],
      },
    });
    await waitFor(() =>
      expect(uploadQueueStore.enqueueCollected).toHaveBeenCalledWith("docs", [
        { file: expect.any(File), relDir: "" },
      ]),
    );
  });

  it("読めないファイルがあれば、読めた分は積み、読めなかった件数とパスを通知する", async () => {
    const error = vi.spyOn(toast, "error").mockReturnValue("" as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<UploadDropzone path="docs" />);
    const broken = {
      isFile: true,
      isDirectory: false,
      name: "broken.txt",
      file: (_ok: unknown, ng: (e: Error) => void) => ng(new Error("NotReadableError")),
    };
    fireEvent.drop(screen.getByText(/ドラッグ＆ドロップ/), {
      dataTransfer: {
        items: [
          { kind: "file", webkitGetAsEntry: () => fileEntryOf("ok.txt") },
          { kind: "file", webkitGetAsEntry: () => broken },
        ],
        files: [],
      },
    });
    await waitFor(() =>
      expect(uploadQueueStore.enqueueCollected).toHaveBeenCalledWith("docs", [
        { file: expect.any(File), relDir: "" },
      ]),
    );
    expect(error).toHaveBeenCalledWith("1件のファイルを読み込めませんでした（例: broken.txt）");
  });

  it("アップロードできるファイルが無ければ、その旨を通知して何も積まない", async () => {
    const info = vi.spyOn(toast, "info").mockReturnValue("" as never);
    render(<UploadDropzone path="docs" />);
    const empty = {
      isFile: false,
      isDirectory: true,
      name: "empty",
      createReader: () => ({ readEntries: (ok: (e: unknown[]) => void) => ok([]) }),
    };
    fireEvent.drop(screen.getByText(/ドラッグ＆ドロップ/), {
      dataTransfer: { items: [{ kind: "file", webkitGetAsEntry: () => empty }], files: [] },
    });
    await waitFor(() => expect(info).toHaveBeenCalledWith("アップロードするファイルがありません"));
    expect(uploadQueueStore.enqueueCollected).not.toHaveBeenCalled();
  });
});
