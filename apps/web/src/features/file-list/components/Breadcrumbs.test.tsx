import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("ルートと各階層を表示する", () => {
    render(<Breadcrumbs path="docs/2024" onNavigate={() => {}} />);
    expect(screen.getByText("ホーム")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("2024")).toBeInTheDocument();
  });

  it("階層クリックでそのパスへ遷移する", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path="docs/2024" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("docs"));
    expect(onNavigate).toHaveBeenCalledWith("docs");
  });

  it("ホームクリックで空パスへ", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path="docs" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("ホーム"));
    expect(onNavigate).toHaveBeenCalledWith("");
  });
});
