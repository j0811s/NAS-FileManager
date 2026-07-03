import type { ApiErrorCode } from "@nas-fm/shared";

const MESSAGES: Record<ApiErrorCode, string> = {
  PATH_TRAVERSAL: "不正なパスです",
  INVALID_REQUEST: "不正な操作です",
  NOT_A_DIRECTORY: "フォルダではありません",
  IS_A_DIRECTORY: "フォルダは直接操作できません",
  NOT_FOUND: "見つかりませんでした",
  CONFLICT: "同名の項目が既に存在します",
  INTERNAL: "サーバでエラーが発生しました",
};

export function errorMessage(code: string): string {
  return MESSAGES[code as ApiErrorCode] ?? "エラーが発生しました";
}
