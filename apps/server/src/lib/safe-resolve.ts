import path from "node:path";
import { AppError } from "./errors";

/** userPath を root 配下の絶対パスに解決する。root の外に出る場合は PATH_TRAVERSAL を投げる。 */
export function safeResolve(root: string, userPath: string): string {
  const resolved = path.resolve(root, "." + path.sep + userPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AppError("PATH_TRAVERSAL", "path traversal detected");
  }
  return resolved;
}
