import { useMemo, useState } from "react";
import type { FileEntry } from "@nas-fm/shared";
import { FolderPlus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/features/upload";
import { useFileList } from "../hooks/useFileList";
import { useFileMutations } from "../hooks/useFileMutations";
import { type SortDir, type SortKey, sortEntries } from "../sort";
import { MkdirDialog } from "../dialogs/MkdirDialog";
import { RenameDialog } from "../dialogs/RenameDialog";
import { DeleteDialog } from "../dialogs/DeleteDialog";
import { MoveDialog } from "../dialogs/MoveDialog";
import { PreviewDialog } from "../dialogs/PreviewDialog";
import { Breadcrumbs } from "./Breadcrumbs";
import { FileTable } from "./FileTable";
import { FileGrid } from "./FileGrid";
import { SortMenu } from "./SortMenu";

type ViewMode = "table" | "grid";
const VIEW_MODE_KEY = "nas-fm:view-mode";

function loadViewMode(): ViewMode {
  return localStorage.getItem(VIEW_MODE_KEY) === "table" ? "table" : "grid";
}

export function FileBrowser() {
  const [path, setPath] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [previewTarget, setPreviewTarget] = useState<FileEntry | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const { data, isLoading, isError, refetch } = useFileList(path);
  const { mkdir, rename, remove } = useFileMutations(path);

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
  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }
  const rel = (name: string) => (path ? `${path}/${name}` : name);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {viewMode === "grid" && (
          <SortMenu
            sortKey={sortKey}
            sortDir={sortDir}
            onSortKeyChange={setSortKey}
            onSortDirChange={setSortDir}
          />
        )}
        <Button
          variant={viewMode === "grid" ? "secondary" : "ghost"}
          size="icon"
          aria-label="グリッド表示"
          onClick={() => changeViewMode("grid")}
        >
          <LayoutGrid size={16} />
        </Button>
        <Button
          variant={viewMode === "table" ? "secondary" : "ghost"}
          size="icon"
          aria-label="テーブル表示"
          onClick={() => changeViewMode("table")}
        >
          <List size={16} />
        </Button>
        <Button size="sm" onClick={() => setMkdirOpen(true)}>
          <FolderPlus size={16} className="mr-2" />
          新しいフォルダ
        </Button>
      </div>

      <UploadDropzone path={path} />

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
      {data && viewMode === "table" && (
        <FileTable
          entries={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSortChange={toggleSort}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          path={path}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
        />
      )}
      {data && viewMode === "grid" && (
        <FileGrid
          entries={sorted}
          path={path}
          onOpenDir={openDir}
          onPreview={setPreviewTarget}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onMove={setMoveTarget}
        />
      )}

      <MkdirDialog
        open={mkdirOpen}
        onOpenChange={setMkdirOpen}
        onSubmit={(name) => mkdir.mutate(name)}
      />
      <RenameDialog
        open={renameTarget !== null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        currentName={renameTarget?.name ?? ""}
        onSubmit={(newName) => {
          if (renameTarget) rename.mutate({ from: rel(renameTarget.name), to: rel(newName) });
          setRenameTarget(null);
        }}
      />
      <DeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        targetName={deleteTarget?.name ?? ""}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(rel(deleteTarget.name));
          setDeleteTarget(null);
        }}
      />
      <MoveDialog
        open={moveTarget !== null}
        onOpenChange={(v) => !v && setMoveTarget(null)}
        entry={moveTarget}
        currentPath={path}
        onSubmit={(destPath) => {
          if (moveTarget) {
            const to = destPath ? `${destPath}/${moveTarget.name}` : moveTarget.name;
            rename.mutate({ from: rel(moveTarget.name), to });
          }
          setMoveTarget(null);
        }}
      />
      <PreviewDialog
        open={previewTarget !== null}
        onOpenChange={(v) => !v && setPreviewTarget(null)}
        name={previewTarget?.name ?? ""}
        path={previewTarget ? rel(previewTarget.name) : ""}
      />
    </div>
  );
}
