/**
 * next 校验（M8+M20）：单个 `/` 开头、非 `//` 开头、不含 `\`，且不是 `/auth` 或
 * `/auth/*`（防登录后 302 回环）；否则回落 `/`。token 与 password 两个端点流共用。
 */
export function validateNext(next: string): string {
  if (
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\") &&
    next !== "/auth" &&
    !next.startsWith("/auth/")
  ) {
    return next;
  }
  return "/";
}
