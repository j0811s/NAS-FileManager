import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * NAS_ROOT 環境変数からストレージルートを解決する。
 * 未設定の場合は開発用に <cwd>/.dev-share を自動作成して使う。
 * NAS_ROOT が指す先が存在しない/ディレクトリでない場合は起動失敗させる（設定ミスを隠さない）。
 */
export function resolveNasRoot(): string {
  const fromEnv = process.env.NAS_ROOT;
  if (fromEnv) {
    const root = path.resolve(fromEnv);
    const st = statSync(root, { throwIfNoEntry: false });
    if (!st?.isDirectory()) {
      throw new Error(`NAS_ROOT is not an existing directory: ${root}`);
    }
    return root;
  }
  const devRoot = path.resolve(process.cwd(), ".dev-share");
  mkdirSync(devRoot, { recursive: true });
  return devRoot;
}
