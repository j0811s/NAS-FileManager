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
  | "UNAUTHORIZED"
  | "UNSUPPORTED"
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

export interface LoginRequest {
  password: string;
}

export interface AuthStatus {
  authenticated: boolean;
}

export interface DiskUsageResponse {
  total: number;
  used: number;
  free: number;
}

export interface TrashEntry {
  id: string;
  name: string;
  originalPath: string;
  type: FileType;
  size: number;
  /** 削除時刻（epoch ミリ秒） */
  deletedAt: number;
}

export interface TrashListResponse {
  entries: TrashEntry[];
}

export interface TrashRestoreRequest {
  id: string;
}
