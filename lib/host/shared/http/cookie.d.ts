/**
 * 构造一条 `Set-Cookie` 值：`<name>=<value>; Max-Age=<secs>; Path=/; HttpOnly; [Secure; ]SameSite=Lax`。
 *
 * 这是本插件**唯一**的 cookie 属性模板：会话 cookie 与放行后重铸的一次性标记都走它，属性集合
 * 因此不会在两处漂移（`SameSite=Lax` 是外层 cookie 的既定选择，见 D1 与跨站弹回记录）。
 * `secure=false` 时省略 `; Secure`（纯 http 测试/开发，M7）。
 */
export declare function buildCookie(name: string, value: string, maxAgeSeconds: number, secure?: boolean): string;
/**
 * 从 Cookie 头解析指定名字的值；同名取首个。无头/无此名 → undefined；空值返回 ""。
 * 解析：`split(";")` → 每段 `trim()` → 首个 `"="` 切分 → 名字精确匹配（trim 后比较）。
 * 值不去引号（token 无引号）。纯函数，供 gate 与 auth 端点共用。
 */
export declare function parseCookieHeader(header: string | undefined, name: string): string | undefined;
