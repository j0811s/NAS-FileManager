import type { MkdirRequest, RenameRequest } from "@nas-fm/shared";
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
