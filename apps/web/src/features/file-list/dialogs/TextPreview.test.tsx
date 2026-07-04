import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPreview } from "./TextPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

describe("TextPreview", () => {
  it("200 応答ではテキストを表示し切り詰めバナーを出さない", async () => {
    mockFetch(200, "const x = 1;");
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(screen.getByText(/const x/)).toBeInTheDocument());
    expect(screen.queryByText(/256KB/)).toBeNull();
  });

  it("206 応答では切り詰めバナーを表示する", async () => {
    mockFetch(206, "partial content");
    render(<TextPreview url="/api/preview?path=a.log" />);
    await waitFor(() => expect(screen.getByText(/256KB/)).toBeInTheDocument());
  });

  it("fetch が Range: bytes=0-262143 ヘッダを送る", async () => {
    const fetchMock = vi.fn(async () => new Response("x", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-262143");
  });

  it("エラー応答では失敗メッセージを表示する", async () => {
    mockFetch(500, "");
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(screen.getByText(/失敗/)).toBeInTheDocument());
  });
});
