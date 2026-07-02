import { serve } from "@hono/node-server";
import { app } from "./app";

const port = 8080;

serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`Server listening on http://0.0.0.0:${info.port}`);
});
