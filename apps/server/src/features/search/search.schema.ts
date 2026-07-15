import { AppError } from "../../lib/errors";

export function requireQuery(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new AppError("INVALID_REQUEST", "q is required");
  }
  return trimmed;
}
