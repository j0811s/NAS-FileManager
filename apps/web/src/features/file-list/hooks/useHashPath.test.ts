import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHashPath } from "./useHashPath";

afterEach(() => {
  window.location.hash = "";
});

describe("useHashPath", () => {
  it("初期ハッシュ無しではpathは空文字", () => {
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("");
  });

  it("初期ハッシュ #/docs/2024 はpath 'docs/2024' になる", () => {
    window.location.hash = "#/docs/2024";
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("docs/2024");
  });

  it("日本語・スペースを含むセグメントを正しくデコードする", () => {
    window.location.hash = `#/${encodeURIComponent("2024 レポート")}`;
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("2024 レポート");
  });

  it("不正な%エンコードのハッシュは空文字にフォールバックする", () => {
    window.location.hash = "#/%zz";
    const { result } = renderHook(() => useHashPath());
    expect(result.current[0]).toBe("");
  });

  it("navigateを呼ぶとハッシュが更新される", () => {
    const { result } = renderHook(() => useHashPath());
    act(() => {
      result.current[1]("docs");
    });
    expect(window.location.hash).toBe("#/docs");
  });

  it("navigate('')を呼ぶとハッシュがクリアされる", () => {
    window.location.hash = "#/docs";
    const { result } = renderHook(() => useHashPath());
    act(() => {
      result.current[1]("");
    });
    expect(window.location.hash).toBe("");
  });

  it("hashchangeイベントでpathが追従する(戻る/進む相当)", () => {
    const { result } = renderHook(() => useHashPath());
    act(() => {
      window.location.hash = "#/docs/2024";
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(result.current[0]).toBe("docs/2024");
  });
});
