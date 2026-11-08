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
  | "TOO_MANY_REQUESTS"
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

export interface SearchEntry extends FileEntry {
  /** マッチした項目自身の、NAS_ROOT からの相対パス */
  path: string;
}

export interface SearchResponse {
  entries: SearchEntry[];
  truncated: boolean;
}

export interface BulkPathsRequest {
  paths: string[];
}

/** 一括操作（削除・移動）の 1 項目ぶんの結果。失敗した項目だけ errorCode を持つ */
export interface BulkItemResult {
  path: string;
  ok: boolean;
  errorCode?: ApiErrorCode;
}

export interface BulkDeleteResponse {
  results: BulkItemResult[];
}

/** paths の各項目を dest フォルダ直下へ同じ名前で移動する。dest は "" でルート直下 */
export interface BulkMoveRequest {
  paths: string[];
  dest: string;
}

export interface BulkMoveResponse {
  results: BulkItemResult[];
}
