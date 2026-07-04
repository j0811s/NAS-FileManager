import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RowActions } from "./RowActions";

const file: FileEntry = { name: "a.txt", size: 1, mtime: 0, type: "file" };

describe("RowActions", () => {
  it("ファイルにダウンロードリンク（正しい href）を出す", async () => {
    render(<RowActions entry={file} path="docs" onRename={() => {}} onDelete={() => {}} />);
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    // DropdownMenuItem asChild は Radix が role="menuitem" を上書きするため、
    // アクセシブルロールは "link" ではなく "menuitem" になる（<a href> 自体は保持される）。
    const link = await screen.findByRole("menuitem", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.txt")}`);
    expect(link).toHaveAttribute("download");
  });

  it("ディレクトリにはダウンロードリンクを出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(<RowActions entry={dir} path="" onRename={() => {}} onDelete={() => {}} />);
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(await screen.findByRole("menuitem", { name: /名前を変更/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /ダウンロード/ })).toBeNull();
  });
});
