import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

function toastError(err: unknown): void {
  const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
  toast.error(errorMessage(code));
}

export function useFileMutations(path: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["list", path] });
  const join = (name: string) => (path ? `${path}/${name}` : name);

  const onErrorAndRefresh = (err: unknown) => {
    toastError(err);
    invalidate();
  };

  const mkdir = useMutation({
    mutationFn: (name: string) => api.mkdir(join(name)),
    onSuccess: () => {
      invalidate();
      toast.success("フォルダを作成しました");
    },
    onError: onErrorAndRefresh,
  });

  const rename = useMutation({
    mutationFn: (v: { from: string; to: string }) => api.rename(v.from, v.to),
    onSuccess: () => {
      invalidate();
      toast.success("名前を変更しました");
    },
    onError: onErrorAndRefresh,
  });

  const remove = useMutation({
    mutationFn: (target: string) => api.remove(target),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      toast.success("削除しました");
    },
    onError: onErrorAndRefresh,
  });

  return { mkdir, rename, remove };
}
