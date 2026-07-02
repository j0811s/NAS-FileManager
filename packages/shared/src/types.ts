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

export type ApiErrorCode =
  | "PATH_TRAVERSAL"
  | "INVALID_REQUEST"
  | "NOT_A_DIRECTORY"
  | "IS_A_DIRECTORY"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export interface OkResponse {
  ok: true;
}

export interface MkdirRequest {
  path: string;
}

export interface RenameRequest {
  from: string;
  to: string;
}
