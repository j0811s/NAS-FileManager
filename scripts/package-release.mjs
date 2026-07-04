import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(rootDir, "release");
const serverBundle = path.join(rootDir, "apps/server/dist/server.js");
const webDist = path.join(rootDir, "apps/web/dist");

for (const [label, p] of [
  ["apps/server/dist/server.js", serverBundle],
  ["apps/web/dist", webDist],
]) {
  if (!existsSync(p)) {
    console.error(
      `必要なビルド成果物が見つかりません: ${label}（先に npm run build を実行してください）`,
    );
    process.exit(1);
  }
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

cpSync(serverBundle, path.join(releaseDir, "server.js"));
cpSync(webDist, path.join(releaseDir, "public"), { recursive: true });

console.log(`release/ を作成しました:\n  release/server.js\n  release/public/`);
