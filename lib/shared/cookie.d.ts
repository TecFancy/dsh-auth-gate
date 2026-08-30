/**
 * 从 Cookie 头解析指定名字的值；同名取首个。无头/无此名 → undefined；空值返回 ""。
 * 解析：`split(";")` → 每段 `trim()` → 首个 `"="` 切分 → 名字精确匹配（trim 后比较）。
 * 值不去引号（token 无引号）。纯函数，供 gate 与 auth 端点共用。
 */
export declare function parseCookieHeader(header: string | undefined, name: string): string | undefined;
//# sourceMappingURL=cookie.d.ts.map