import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@/lib/api";

export function createAuthAwareQueryClient(): QueryClient {
  const onAuthError = (error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "UNAUTHORIZED") {
      client.invalidateQueries({ queryKey: ["me"] });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: onAuthError }),
    mutationCache: new MutationCache({ onError: onAuthError }),
  });
  return client;
}

export const queryClient = createAuthAwareQueryClient();
