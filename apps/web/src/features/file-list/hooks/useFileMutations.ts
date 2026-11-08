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

  const bulkMove = useMutation({
    mutationFn: (v: { paths: string[]; dest: string }) => api.moveBulk(v.paths, v.dest),
    onSuccess: (res) => {
      // 移動元と移動先の両方の一覧が変わるため、一覧系をまとめて再取得する
      qc.invalidateQueries({ queryKey: ["list"] });
      const failures = res.results.filter((r) => !r.ok);
      const failed = failures.length;
      const succeeded = res.results.length - failed;
      // 失敗理由が 1 種類なら添える（同名衝突など、利用者が対処できるように）。複数種類なら件数のみ
      const codes = new Set(failures.map((r) => r.errorCode ?? "INTERNAL"));
      const reason = codes.size === 1 ? `: ${errorMessage([...codes][0])}` : "";
      if (failed === 0) {
        toast.success(`${succeeded}件移動しました`);
      } else if (succeeded === 0) {
        toast.error(`移動に失敗しました（${failed}件${reason}）`);
      } else {
        toast.error(`${succeeded}件移動しました（${failed}件失敗${reason}）`);
      }
    },
    onError: (err) => {
      toastError(err);
      // リクエスト途中の失敗ではサーバ側で一部が移動済みの可能性があるため、移動先も含めて再取得する
      qc.invalidateQueries({ queryKey: ["list"] });
    },
  });

  return { mkdir, rename, remove, bulkDelete, bulkMove };
}
