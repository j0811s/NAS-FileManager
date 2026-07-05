import type { FileEntry } from "@nas-fm/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RowActions } from "./RowActions";

const file: FileEntry = { name: "a.txt", size: 1, mtime: 0, type: "file" };

describe("RowActions", () => {
  it("ファイルにダウンロードリンク（正しい href）を出す", async () => {
    render(
      <RowActions
        entry={file}
        path="docs"
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    // DropdownMenuItem asChild は Radix が role="menuitem" を上書きするため、
    // アクセシブルロールは "link" ではなく "menuitem" になる（<a href> 自体は保持される）。
    const link = await screen.findByRole("menuitem", { name: /ダウンロード/ });
    expect(link).toHaveAttribute("href", `/api/download?path=${encodeURIComponent("docs/a.txt")}`);
    expect(link).toHaveAttribute("download");
  });

  it("ディレクトリにはダウンロードリンクを出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions
        entry={dir}
        path=""
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(await screen.findByRole("menuitem", { name: /名前を変更/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /ダウンロード/ })).toBeNull();
  });

  it("ファイルの操作メニューから onPreview を呼ぶ", async () => {
    const onPreview = vi.fn();
    render(
      <RowActions
        entry={file}
        path="docs"
        onPreview={onPreview}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    await userEvent.click(await screen.findByRole("menuitem", { name: /プレビュー/ }));
    expect(onPreview).toHaveBeenCalledWith(file);
  });

  it("操作メニューから onMove を呼ぶ", async () => {
    const onMove = vi.fn();
    render(
      <RowActions
        entry={file}
        path="docs"
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    await userEvent.click(await screen.findByRole("menuitem", { name: /移動/ }));
    expect(onMove).toHaveBeenCalledWith(file);
  });

  it("ディレクトリの操作メニューにはプレビュー項目を出さない", async () => {
    const dir: FileEntry = { name: "sub", size: 0, mtime: 0, type: "dir" };
    render(
      <RowActions
        entry={dir}
        path=""
        onPreview={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onMove={() => {}}
      />,
    );
    await userEvent.click(screen.getByLabelText("操作メニュー"));
    expect(screen.queryByRole("menuitem", { name: /プレビュー/ })).toBeNull();
  });
});
