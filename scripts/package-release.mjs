import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseDir = path.join(rootDir, "release");
const serverBundle = path.join(rootDir, "apps/server/dist/server.js");
const webDist = path.join(rootDir, "apps/web/dist");
const serverPackageJson = path.join(rootDir, "apps/server/package.json");

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

// sharp はネイティブバインディング（.node）を含み esbuild でバンドルできないため
// server.ts のビルドでは `--external:sharp` としてバンドル対象外にしている。
// デプロイ先（Raspberry Pi 5, Raspberry Pi OS 64bit = linux/arm64/glibc）向けの
// ビルド済みバイナリを別途取得し、release/node_modules に同梱する。
const { dependencies } = JSON.parse(readFileSync(serverPackageJson, "utf8"));
const sharpVersion = dependencies.sharp;
if (!sharpVersion) {
  console.error("apps/server/package.json に sharp の依存が見つかりません");
  process.exit(1);
}

console.log(`sharp@${sharpVersion}（linux/arm64/glibc）を取得中...`);
const stagingDir = mkdtempSync(path.join(tmpdir(), "nasfm-sharp-arm64-"));
writeFileSync(
  path.join(stagingDir, "package.json"),
  JSON.stringify({
    name: "sharp-arm64-staging",
    private: true,
    dependencies: { sharp: sharpVersion },
  }),
);
execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
  cwd: stagingDir,
  stdio: "inherit",
  env: {
    ...process.env,
    npm_config_os: "linux",
    npm_config_cpu: "arm64",
    npm_config_libc: "glibc",
  },
});
cpSync(path.join(stagingDir, "node_modules"), path.join(releaseDir, "node_modules"), {
  recursive: true,
});
rmSync(stagingDir, { recursive: true, force: true });

console.log(
  `release/ を作成しました:\n  release/server.js\n  release/public/\n  release/node_modules/（sharp linux/arm64 ネイティブ含む）`,
);
