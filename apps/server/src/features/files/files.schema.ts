import type { BulkPathsRequest, MkdirRequest, RenameRequest } from "@nas-fm/shared";
import { AppError } from "../../lib/errors";

export function requirePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new AppError("INVALID_REQUEST", "path is required");
  }
  return value;
}

export function optionalPath(value: string | undefined): string {
  return value ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMkdirBody(value: unknown): MkdirRequest {
  if (!isRecord(value) || typeof value.path !== "string" || value.path === "") {
    throw new AppError("INVALID_REQUEST", "body must be { path: string }");
  }
  return { path: value.path };
}

export function parseRenameBody(value: unknown): RenameRequest {
  if (
    !isRecord(value) ||
    typeof value.from !== "string" ||
    value.from === "" ||
    typeof value.to !== "string" ||
    value.to === ""
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { from: string, to: string }");
  }
  return { from: value.from, to: value.to };
}

export function parseBulkPathsBody(value: unknown): BulkPathsRequest {
  if (
    !isRecord(value) ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    !value.paths.every((p) => typeof p === "string" && p !== "")
  ) {
    throw new AppError("INVALID_REQUEST", "body must be { paths: string[] } (non-empty)");
  }
  return { paths: value.paths };
}
