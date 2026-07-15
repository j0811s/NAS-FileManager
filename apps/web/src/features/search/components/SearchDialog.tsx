import { useEffect, useState } from "react";
import type { SearchEntry } from "@nas-fm/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useHashPath } from "@/lib/useHashPath";
import { useSearch } from "../hooks/useSearch";

function formatSize(entry: SearchEntry): string {
  if (entry.type === "dir") return "—";
  if (entry.size < 1024) return `${entry.size} B`;
  if (entry.size < 1024 * 1024) return `${(entry.size / 1024).toFixed(1)} KB`;
  if (entry.size < 1024 * 1024 * 1024) return `${(entry.size / 1024 / 1024).toFixed(1)} MB`;
  return `${(entry.size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

export function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [, navigate] = useHashPath();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useSearch(debouncedQuery);
  const entries = data?.entries ?? [];
  const trimmed = debouncedQuery.trim();

  function handleOpenChange(v: boolean) {
    if (!v) setQuery("");
    onOpenChange(v);
  }

  function goTo(entry: SearchEntry) {
    navigate(parentOf(entry.path));
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>検索</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="ファイル名・フォルダ名で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {trimmed === "" && (
          <p className="text-sm text-muted-foreground">検索キーワードを入力してください</p>
        )}
        {trimmed !== "" && isFetching && <p className="text-sm text-muted-foreground">検索中…</p>}
        {trimmed !== "" && !isFetching && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">見つかりませんでした</p>
        )}
        {entries.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名前</TableHead>
                  <TableHead>場所</TableHead>
                  <TableHead>サイズ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.path} className="cursor-pointer" onClick={() => goTo(entry)}>
                    <TableCell>{entry.name}</TableCell>
                    <TableCell>{entry.path}</TableCell>
                    <TableCell>{formatSize(entry)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data?.truncated && (
              <p className="text-sm text-muted-foreground">結果が多いため一部のみ表示しています</p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
