import { parseCookieHeader } from "../../../shared/http/index.js";
import { AUTH_PATH_PREFIX } from "../../../shared/protocol/index.js";
/** 不透明 ceremony id 的 cookie 名。 */
export const CEREMONY_COOKIE = "dsh_auth_pk";
/** ceremony cookie 的有效期（秒），与 `CeremonyStore` 的缺省 TTL 对齐。 */
export const CEREMONY_TTL_SECONDS = 120;
/**
 * 精确输出 `dsh_auth_pk=<id>; Max-Age=120; Path=/auth; HttpOnly; Secure; SameSite=Lax`；
 * `secure=false` 时省略 `; Secure`（http 开发/测试）。属性顺序照既有 `buildSetCookie`，
 * 只有 Path 收窄到 `/auth`。
 */
export function buildCeremonyCookie(id, secure) {
    return `${CEREMONY_COOKIE}=${id}; Max-Age=${CEREMONY_TTL_SECONDS}; Path=${AUTH_PATH_PREFIX}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`;
}
/** 清空 ceremony cookie（同名同路径同属性、空值、`Max-Age=0`）；finish 无论成败都调用。 */
export function clearCeremonyCookie(secure) {
    return `${CEREMONY_COOKIE}=; Max-Age=0; Path=${AUTH_PATH_PREFIX}; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`;
}
/**
 * 从 Cookie 头读出 ceremony id；头缺失、无该名字、值为空都返回 undefined。
 * 不做格式校验：未知或伪造的 id 在 `CeremonyStore.consume` 里统一按无效处理。
 */
export function readCeremonyId(cookieHeader) {
    const id = parseCookieHeader(cookieHeader, CEREMONY_COOKIE);
    if (id === undefined || id === "")
        return undefined;
    return id;
}
//# sourceMappingURL=ceremony-cookie.js.map