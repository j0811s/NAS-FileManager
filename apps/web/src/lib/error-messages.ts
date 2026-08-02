import type { ApiErrorCode } from "@nas-fm/shared";

// サーバが実際に返す ApiErrorCode（wire contract）に加えて、
// クライアント側でのみ発生しサーバには存在しない表示用コードをここで拡張する。
// NETWORK_ERROR は XHR の "error" イベント（サーバ応答なし）専用で、
// サーバの AppError / statusOf の網羅チェックには含めない。
type DisplayErrorCode = ApiErrorCode | "NETWORK_ERROR";

const MESSAGES: Record<DisplayErrorCode, string> = {
  PATH_TRAVERSAL: "不正なパスです",
  INVALID_REQUEST: "不正な操作です",
  NOT_A_DIRECTORY: "フォルダではありません",
  IS_A_DIRECTORY: "フォルダは直接操作できません",
  NOT_FOUND: "見つかりませんでした",
  CONFLICT: "同名の項目が既に存在します",
  UNAUTHORIZED: "認証が必要です",
  UNSUPPORTED: "サポートされていない操作です",
  INTERNAL: "サーバでエラーが発生しました",
  NETWORK_ERROR: "ネットワークに接続できませんでした",
};

export function errorMessage(code: string): string {
  return MESSAGES[code as DisplayErrorCode] ?? "エラーが発生しました";
}
