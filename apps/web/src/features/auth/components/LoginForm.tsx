import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiRequestError, api } from "@/lib/api";
import { errorMessage } from "@/lib/error-messages";

export function LoginForm() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: (pw: string) => api.login(pw),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    // サーバ不調をパスワード違いと誤認させると、打ち直しで試行回数制限に掛かるため区別して表示する
    onError: (err) => {
      if (!(err instanceof ApiRequestError)) {
        toast.error(errorMessage("NETWORK_ERROR"));
      } else if (err.code === "UNAUTHORIZED") {
        toast.error("パスワードが違います");
      } else {
        toast.error(errorMessage(err.code));
      }
    },
  });

  return (
    <div className="flex justify-center pt-16">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <h2 className="text-lg font-semibold">ログイン</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate(password);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="login-password">パスワード</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            ログイン
          </Button>
        </form>
      </Card>
    </div>
  );
}
