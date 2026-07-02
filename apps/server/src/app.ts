import { Hono } from "hono";
import type { FileEntry } from "@nas-fm/shared";

export const app = new Hono();

app.get("/health", (c) => {
  // @nas-fm/shared の型解決をワークスペース越しに検証するための参照。
  const sampleType: FileEntry["type"] = "dir";
  return c.json({ status: "ok", sampleType });
});
