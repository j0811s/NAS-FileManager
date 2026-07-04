import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
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

const queryClient = createAuthAwareQueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
