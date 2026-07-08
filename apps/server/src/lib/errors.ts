import type { ApiErrorCode } from "@nas-fm/shared";

export class AppError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

export function statusOf(code: ApiErrorCode): 400 | 401 | 404 | 409 | 500 | 501 {
  switch (code) {
    case "PATH_TRAVERSAL":
    case "INVALID_REQUEST":
    case "NOT_A_DIRECTORY":
    case "IS_A_DIRECTORY":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "UNSUPPORTED":
      return 501;
    case "INTERNAL":
      return 500;
  }
}

export function fromFsError(err: unknown, subject: string): AppError {
  if (err instanceof AppError) return err;
  const code = (err as NodeJS.ErrnoException).code;
  switch (code) {
    case "ENOENT":
      return new AppError("NOT_FOUND", `not found: ${subject}`);
    case "EEXIST":
      return new AppError("CONFLICT", `already exists: ${subject}`);
    case "ENOTDIR":
      return new AppError("NOT_A_DIRECTORY", `not a directory: ${subject}`);
    case "EISDIR":
      return new AppError("IS_A_DIRECTORY", `is a directory: ${subject}`);
    default:
      return new AppError("INTERNAL", `unexpected error: ${String(err)}`);
  }
}
