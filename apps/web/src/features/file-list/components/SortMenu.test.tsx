import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SortMenu } from "./SortMenu";

describe("SortMenu", () => {
  it("現在のソートキーと方向をトリガーに表示する", () => {
    render(
      <SortMenu
        sortKey="mtime"
        sortDir="desc"
        onSortKeyChange={() => {}}
        onSortDirChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /更新日時 ▼/ })).toBeInTheDocument();
  });

  it("キー選択で onSortKeyChange を呼ぶ", async () => {
    const onSortKeyChange = vi.fn();
    render(
      <SortMenu
        sortKey="name"
        sortDir="asc"
        onSortKeyChange={onSortKeyChange}
        onSortDirChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前 ▲/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "サイズ" }));
    expect(onSortKeyChange).toHaveBeenCalledWith("size");
  });

  it("方向選択で onSortDirChange を呼ぶ", async () => {
    const onSortDirChange = vi.fn();
    render(
      <SortMenu
        sortKey="name"
        sortDir="asc"
        onSortKeyChange={() => {}}
        onSortDirChange={onSortDirChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /名前 ▲/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "降順" }));
    expect(onSortDirChange).toHaveBeenCalledWith("desc");
  });
});
