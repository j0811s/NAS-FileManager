import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

describe("App", () => {
  it("ヘッダにアプリ名を表示する", () => {
    vi.spyOn(api, "list").mockResolvedValue({ path: "", entries: [] });
    render(<App />);
    expect(screen.getByRole("heading", { name: "NAS-FileManager" })).toBeInTheDocument();
  });
});
