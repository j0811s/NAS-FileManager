export type FileType = "file" | "dir";

export interface FileEntry {
  name: string;
  size: number;
  /** 最終更新時刻（epoch ミリ秒） */
  mtime: number;
  type: FileType;
}

export interface ListResponse {
  path: string;
  entries: FileEntry[];
}
