import { hashPassword } from "./password";

export interface AuthConfig {
  secret: string;
  passwordHash: string;
}

const DEV_SECRET = "dev-insecure-secret-change-me";
const DEV_PASSWORD = "admin";

/**
 * 認証設定を環境変数から解決する。
 * AUTH_SECRET / AUTH_PASSWORD_HASH が未設定の場合は開発用のデフォルト（パスワード "admin"）に
 * フォールバックし、本番では環境変数を設定するよう警告する。
 */
export function resolveAuthConfig(): AuthConfig {
  const envSecret = process.env.AUTH_SECRET;
  const envHash = process.env.AUTH_PASSWORD_HASH;
  if (!envSecret || !envHash) {
    console.warn(
      "WARNING: 開発用の認証設定を使用中。本番では AUTH_SECRET と AUTH_PASSWORD_HASH を設定すること",
    );
  }
  return {
    secret: envSecret ?? DEV_SECRET,
    passwordHash: envHash ?? hashPassword(DEV_PASSWORD),
  };
}
