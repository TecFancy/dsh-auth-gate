import { methodNotAllowed, parseCookieHeader, resolvePostLoginLocation, } from "../../../shared/http/index.js";
import { isBootstrapSession, } from "../../../entities/session/index.js";
import { redirectTo, redirectToLogin } from "../model/respond.js";
/**
 * `GET /auth/continue`：向导完成后的最后一跳，302 到 dsh 的 `/?token=<launchToken>`，
 * 由 dsh 自己 mint 浏览器 cookie。
 *
 * 只认 cookie 里的**正式**会话：没有会话、会话失效、或拿的是 bootstrap 会话，一律回登录页
 * （且不回显 query），不靠「跳到 `/` 再被门弹回向导」兜底。它不认 query，也**不签发**任何
 * 会话，所以不会和数据面形成循环。桥缺失 / 抛错 → 回落到 `/`。
 */
export function makeContinueEndpoint(deps) {
    return async (req, res) => {
        if (req.method !== "GET") {
            methodNotAllowed(res, "GET");
            return;
        }
        const session = sessionOf(deps, req);
        if (session === undefined || isBootstrapSession(session)) {
            redirectToLogin(res);
            return;
        }
        redirectTo(res, await resolvePostLoginLocation(deps.bridge, "/", deps.logger));
    };
}
/** 会话行（只认 cookie）：无 store / 无 cookie / 已吊销 / 已过期 → undefined。 */
function sessionOf(deps, req) {
    const store = deps.sessions();
    if (store === undefined)
        return undefined;
    const cookie = parseCookieHeader(req.headers.cookie, deps.cookieName);
    return cookie === undefined || cookie === "" ? undefined : store.getByToken(cookie);
}
//# sourceMappingURL=continue-endpoint.js.map