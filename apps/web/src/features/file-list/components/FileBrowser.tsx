import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFileList } from "../hooks/useFileList";
import { type SortKey, sortEntries, type SortDir } from "../sort";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileTable } from "./FileTable";

export function FileBrowser() {
  const [path, setPath] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const { data, isLoading, isError, refetch } = useFileList(path);

  const sorted = useMemo(
    () => (data ? sortEntries(data.entries, sortKey, sortDir) : []),
    [data, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function openDir(name: string) {
    setPath(path ? `${path}/${name}` : name);
  }

  return (
    <div className="space-y-4">
      <Breadcrumbs path={path} onNavigate={setPath} />
      {isLoading && <p className="text-muted-foreground">読み込み中…</p>}
      {isError && (
        <div className="space-y-2">
          <p className="text-destructive">一覧の読み込みに失敗しました。</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            再試行
          </Button>
        </div>
      )}
      {data && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          path={path}
          onRename={() => {}}
          onDelete={() => {}}
        />
      )}
    </div>
  );
}
