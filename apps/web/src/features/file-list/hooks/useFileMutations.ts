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

  const bulkDelete = useMutation({
    mutationFn: (paths: string[]) => api.deleteBulk(paths),
    onSuccess: (res) => {
      invalidate();
      qc.invalidateQueries({ queryKey: ["disk-usage"] });
      const failed = res.results.filter((r) => !r.ok).length;
      const succeeded = res.results.length - failed;
      if (failed === 0) {
        toast.success(`${succeeded}件削除しました`);
      } else if (succeeded === 0) {
        toast.error(`削除に失敗しました（${failed}件）`);
      } else {
        toast.error(`${succeeded}件削除しました（${failed}件失敗）`);
      }
    },
    onError: onErrorAndRefresh,
  });

  return { mkdir, rename, remove, bulkDelete };
}
