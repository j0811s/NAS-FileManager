import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { LoginForm } from "./LoginForm";

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useAuth();
  if (isLoading) {
    return <p className="text-muted-foreground">読み込み中…</p>;
  }
  if (!data?.authenticated) {
    return <LoginForm />;
  }
  return <>{children}</>;
}
