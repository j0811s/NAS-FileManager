import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useDiskUsage() {
  return useQuery({
    queryKey: ["disk-usage"],
    queryFn: () => api.diskUsage(),
    retry: false,
  });
}
