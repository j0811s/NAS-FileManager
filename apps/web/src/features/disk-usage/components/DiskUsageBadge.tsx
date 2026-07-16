import { useDiskUsage } from "../hooks/useDiskUsage";

function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export function DiskUsageBadge() {
  const { data } = useDiskUsage();
  if (!data) return null;

  const ratio = data.used / data.total;
  const className = ratio >= 0.9 ? "text-destructive" : "text-muted-foreground";

  return <span className={`text-sm ${className}`}>残り {formatGB(data.free)}</span>;
}
