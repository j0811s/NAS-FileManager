import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { resolveAuthConfig } from "./lib/auth-config";
import { resolveNasRoot } from "./lib/config";

const root = resolveNasRoot();
const authConfig = resolveAuthConfig();
const app = createApp(root, authConfig);
const port = 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port} (NAS_ROOT: ${root})`);
});
