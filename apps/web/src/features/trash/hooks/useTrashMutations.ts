import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

function toastError(err: unknown): void {
  const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
  toast.error(errorMessage(code));
}

export function useTrashMutations() {
  const qc = useQueryClient();
  const invalidateTrash = () => qc.invalidateQueries({ queryKey: ["trash"] });

  const restore = useMutation({
    mutationFn: (id: string) => api.restoreFromTrash(id),
    onSuccess: () => {
      invalidateTrash();
      qc.invalidateQueries({ queryKey: ["list"] });
      toast.success("復元しました");
    },
    onError: toastError,
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.purgeTrashEntry(id),
    onSuccess: () => {
      invalidateTrash();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      toast.success("完全に削除しました");
    },
    onError: toastError,
  });

  return { restore, purge };
}
