import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useTrash() {
  return useQuery({ queryKey: ["trash"], queryFn: () => api.listTrash() });
}
