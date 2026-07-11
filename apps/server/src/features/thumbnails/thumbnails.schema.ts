import type { ThumbnailVariant } from "./thumbnails.service";
import { AppError } from "../../lib/errors";

export function requirePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    throw new AppError("INVALID_REQUEST", "path is required");
  }
  return value;
}

export function parseVariant(value: string | undefined): ThumbnailVariant {
  if (value === undefined || value === "thumb") return "thumb";
  if (value === "preview") return "preview";
  throw new AppError("INVALID_REQUEST", "invalid size");
}
