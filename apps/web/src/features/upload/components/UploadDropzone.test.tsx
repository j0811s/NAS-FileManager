import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { UploadDropzone } from "./UploadDropzone";

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("UploadDropzone", () => {
  it("ファイル選択で api.upload を現在パスで呼ぶ", async () => {
    const upload = vi.spyOn(api, "upload").mockResolvedValue();
    renderWithClient(<UploadDropzone path="docs" />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.txt"));
    expect(upload).toHaveBeenCalledWith("docs", expect.any(File), expect.any(Object));
  });
});
