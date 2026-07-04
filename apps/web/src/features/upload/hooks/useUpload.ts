import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

export function useUpload(path: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setProgress(0);
      try {
        await api.upload(path, file, { onProgress: setProgress });
        toast.success(`${file.name} をアップロードしました`);
        qc.invalidateQueries({ queryKey: ["list", path] });
      } catch (err) {
        const code = err instanceof ApiRequestError ? err.code : "INTERNAL";
        if (err instanceof ApiRequestError && err.code === "UNAUTHORIZED") {
          qc.invalidateQueries({ queryKey: ["me"] });
        }
        toast.error(errorMessage(code));
      } finally {
        setProgress(null);
      }
    },
    [path, qc],
  );

  return { upload, progress, isUploading: progress !== null };
}
