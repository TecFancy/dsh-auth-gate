/**
 * 从 Cookie 头解析指定名字的值；同名取首个。无头/无此名 → undefined；空值返回 ""。
 * 解析：`split(";")` → 每段 `trim()` → 首个 `"="` 切分 → 名字精确匹配（trim 后比较）。
 * 值不去引号（token 无引号）。纯函数，供 gate 与 auth 端点共用。
 */
export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    return trimmed.slice(eq + 1);
  }
  return undefined;
}
