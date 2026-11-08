/**
 * アップロード対象のファイルと、アップロード先フォルダから見た配置フォルダ（"" なら直下）。
 * relDir は "/" 区切り・前後に "/" なし。生成はこのモジュールの関数に限る（サーバ側でも safeResolve で検証される）
 */
export type CollectedFile = { file: File; relDir: string };

/** 読み込めなかったファイル・フォルダ（ドロップしたフォルダからの相対パス） */
export type CollectFailure = { path: string; error: unknown };

export type CollectResult = { files: CollectedFile[]; failed: CollectFailure[] };

/** OS が自動生成し、NAS に置く意味が無いファイル */
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function isIgnored(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

function joinDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** readEntries は 1 回で全件を返すとは限らない（Chrome は最大 100 件ずつ）ため、空が返るまで繰り返す */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** 読めないエントリ（権限・ドロップ中の削除・壊れたリンク等）は failed に記録し、残りの収集は続ける */
async function walk(entry: FileSystemEntry, dir: string, out: CollectResult): Promise<void> {
  const entryPath = joinDir(dir, entry.name);
  if (entry.isFile) {
    if (isIgnored(entry.name)) return;
    try {
      out.files.push({ file: await readFile(entry as FileSystemFileEntry), relDir: dir });
    } catch (error) {
      out.failed.push({ path: entryPath, error });
    }
    return;
  }
  if (entry.isDirectory) {
    let children: FileSystemEntry[];
    try {
      children = await readAllEntries(entry as FileSystemDirectoryEntry);
    } catch (error) {
      out.failed.push({ path: entryPath, error });
      return;
    }
    for (const child of children) await walk(child, entryPath, out);
  }
}

/** ドロップされたエントリを再帰的にたどり、フォルダ構造を relDir として保ったまま列挙する。空フォルダは返さない */
export async function collectFromEntries(entries: FileSystemEntry[]): Promise<CollectResult> {
  const out: CollectResult = { files: [], failed: [] };
  for (const entry of entries) await walk(entry, "", out);
  return out;
}

/**
 * drop イベントの DataTransfer から列挙する。
 * DataTransferItem はイベント処理が終わると読めなくなるため、エントリ・File の取り出しは await より前に同期で行う。
 * エントリが取れない項目（API 非対応など）だけはファイル単体として扱う。
 */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<CollectResult> {
  const entries: FileSystemEntry[] = [];
  const looseFiles: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      entries.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }
  const result = await collectFromEntries(entries);
  result.files.push(...collectFromFileList(looseFiles));
  return result;
}

/** input の FileList から列挙する。webkitdirectory で選んだ場合は webkitRelativePath からフォルダを復元する */
export function collectFromFileList(files: Iterable<File>): CollectedFile[] {
  const out: CollectedFile[] = [];
  for (const file of files) {
    if (isIgnored(file.name)) continue;
    const rel = file.webkitRelativePath ?? "";
    const slash = rel.lastIndexOf("/");
    out.push({ file, relDir: slash === -1 ? "" : rel.slice(0, slash) });
  }
  return out;
}
