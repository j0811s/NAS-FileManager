import { useSyncExternalStore } from "react";
import { type UploadItem, uploadQueueStore } from "../store/uploadQueueStore";

export function useUploadQueue(): UploadItem[] {
  return useSyncExternalStore(uploadQueueStore.subscribe, uploadQueueStore.getSnapshot);
}
