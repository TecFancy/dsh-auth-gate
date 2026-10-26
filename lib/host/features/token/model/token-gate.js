import { isNavigationRequest, isPublicStaticPath } from "../../../shared/guard/index.js";
import { isAuthPath, SETUP_PATH } from "../../../shared/protocol/index.js";
import { safeEqual } from "../../../shared/crypto/index.js";
import { isBootstrapSession, } from "../../../entities/session/index.js";
import { bootstrapRedirectPath, parseCookieHeader } from "../../../shared/http/index.js";
/** 恒时比较在 `shared/crypto`，这里转口导出：既有调用点（含 barrel）不用改 import。 */
export { safeEqual };
/**
 * 共享 token 门（M2）：`/auth` 前缀 + 公开只读静态路径白名单 → 会话 cookie → Bearer，
 * 恒时校验，fail-closed。
 *
 * 首次引导通道：本来要拒绝的 `GET /?token=` 只按请求形状 302 到 `/auth/bootstrap?token=`，
 * 门内不校验 token、不读文件、不做 IO。bootstrap 会话只放行 `/auth/*`（上面已放行），
 * 其余导航 302 回向导页，API 401，WS 拒握手。
 */
export class TokenGate {
    resolveToken;
    sessions;
    cookieName;
    constructor(options) {
        this.resolveToken = options.resolveToken;
        this.sessions = options.sessions;
        this.cookieName = options.cookieName;
    }
    async decide(req, kind, pathname) {
        if (isAuthPath(pathname))
            return "allow";
        const session = this.sessionOf(req);
        if (session !== undefined)
            return isBootstrapSession(session) ? denyBootstrap(req) : "allow";
        if (isPublicStaticPath(kind, pathname))
            return "allow";
        const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
        if (bearer !== undefined) {
            try {
                const stored = await this.resolveToken();
                if (stored !== undefined && safeEqual(bearer, stored))
                    return "allow";
            }
            catch {
                return "deny"; // fail-closed 双保险（index.ts 的 resolver 已自行 catch 并记日志）
            }
        }
        const hint = bootstrapRedirectPath(req);
        if (hint !== undefined)
            return { deny: { redirect: hint } };
        return "deny";
    }
    /** 会话行（只认会话 cookie，与既有 token 通道一致）：无 store/无 cookie/失效 → undefined。 */
    sessionOf(req) {
        const store = this.sessions();
        if (store === undefined)
            return undefined;
        const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
        return cookie === undefined || cookie === "" ? undefined : store.getByToken(cookie);
    }
}
/** bootstrap 会话被拒的宿主路径：导航 → 302 向导页；WS → 拒握手；其余（API）→ 401。 */
function denyBootstrap(req) {
    return isNavigationRequest(req) ? { deny: { redirect: SETUP_PATH } } : "deny";
}
//# sourceMappingURL=token-gate.js.map