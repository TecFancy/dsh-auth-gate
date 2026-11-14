/** 不透明 ceremony id 的 cookie 名。 */
export declare const CEREMONY_COOKIE = "dsh_auth_pk";
/** ceremony cookie 的有效期（秒），与 `CeremonyStore` 的缺省 TTL 对齐。 */
export declare const CEREMONY_TTL_SECONDS = 120;
/**
 * 精确输出 `dsh_auth_pk=<id>; Max-Age=120; Path=/auth; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 开发/测试）。属性顺序照既有 `buildSetCookie`，
 * 只有 Path 收窄到 `/auth`。
 */
export declare function buildCeremonyCookie(id: string, secure: boolean): string;
/** 清空 ceremony cookie（同名同路径同属性、空值、`Max-Age=0`）；finish 无论成败都调用。 */
export declare function clearCeremonyCookie(secure: boolean): string;
/**
 * 从 Cookie 头读出 ceremony id；头缺失、无该名字、值为空都返回 undefined。
 * 不做格式校验：未知或伪造的 id 在 `CeremonyStore.consume` 里统一按无效处理。
 */
export declare function readCeremonyId(cookieHeader: string | undefined): string | undefined;
//# sourceMappingURL=ceremony-cookie.d.ts.map