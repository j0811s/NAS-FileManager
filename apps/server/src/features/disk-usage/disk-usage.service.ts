import fs from "node:fs/promises";
import type { DiskUsageResponse } from "@nas-fm/shared";

export async function getDiskUsage(root: string): Promise<DiskUsageResponse> {
  const stat = await fs.statfs(root);
  const total = stat.blocks * stat.bsize;
  // bavail: 一般ユーザーが実際に書き込める空き容量（root 予約分を除く）。df の Available と同じ考え方。
  const free = stat.bavail * stat.bsize;
  const used = total - free;
  return { total, used, free };
}
