import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { resolveAuthConfig } from "./lib/auth-config";
import { resolveNasRoot } from "./lib/config";

const root = resolveNasRoot();
const authConfig = resolveAuthConfig();

// バンドル後（release/server.js）は隣に public/ が置かれる想定。
// 開発時（tsx で src/server.ts を直接実行）はその場所に public/ が存在しないため、
// 静的配信は自動的にスキップされる（NAS_ROOT/AuthConfig と同じ「無ければスキップ」方針）。
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");
const staticDir = existsSync(publicDir) ? publicDir : undefined;

const app = createApp(root, authConfig, staticDir);
const port = Number(process.env.PORT) || 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port} (NAS_ROOT: ${root})`);
});
