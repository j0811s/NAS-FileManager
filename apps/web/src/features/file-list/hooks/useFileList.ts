import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useFileList(path: string) {
  return useQuery({
    queryKey: ["list", path],
    queryFn: () => api.list(path),
  });
}
