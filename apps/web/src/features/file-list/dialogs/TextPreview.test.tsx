import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextPreview } from "./TextPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: string, headers?: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers })),
  );
}

describe("TextPreview", () => {
  it("200 応答ではテキストを表示し切り詰めバナーを出さない", async () => {
    mockFetch(200, "const x = 1;");
    render(<TextPreview url="/api/preview?path=a.ts" />);
    await waitFor(() => expect(screen.getByText(/const x/)).toBeInTheDocument());
    expect(screen.queryByText(/256KB/)).toBeNull();
  });

  it("206 応答でも総サイズが上限以下なら切り詰めバナーを出さない（小さいファイルは常に206になりうるため）", async () => {
    mockFetch(206, "small file content", { "content-range": "bytes 0-17/18" });
    const { container } = render(<TextPreview url="/api/preview?path=a.log" />);
    // highlight.js の自動言語判定がこの文字列を AppleScript と誤認識し "file" を
    // <span> で分割するため、getByText の単一テキストノード一致では拾えない。
    // 描画結果の全文（子要素をまたいだテキスト）を直接検証する。
    await waitFor(() =>
      expect(container.querySelector("code")?.textContent).toBe("small file content"),
    );
    expect(screen.queryByText(/256KB/)).toBeNull();
  });

  it("206 応答で総サイズが上限を超える場合は切り詰めバナーを表示する", async () => {
    mockFetch(206, "partial content", { "content-range": "bytes 0-262143/300000" });
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
