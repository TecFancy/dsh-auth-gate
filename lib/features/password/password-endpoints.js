import { loginPath, parseCookieHeader, passwordLoginPageHtml, resolvePublicHost, totpChallengePageHtml, validateNext, } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { authCatchAll, handleLogout, handleStatus, methodNotAllowed, queryOf, } from "../../http/index.js";
import { handlePasswordLogin } from "./password-login.js";
import { buildSetCookie } from "../../session/index.js";
import { CHALLENGE_COOKIE, parseChallengeValue } from "./challenge-cookie.js";
/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式，P16）。返回合并 disposer。
 * 路由模型同 M15：webserver 无 method 路由，exact handler 内部按 `req.method` 分发。
 */
export function registerPasswordEndpoints(deps) {
    const disposers = [];
    const track = (route) => {
        disposers.push(deps.register(route));
    };
    track({ kind: "prefix", path: AUTH_PATH_PREFIX, handler: authCatchAll });
    track({ kind: "exact", path: "/auth/login", handler: (req, res) => handleLogin(deps, req, res) });
    track({
        kind: "exact",
        path: "/auth/logout",
        handler: (req, res) => handleLogout(deps, req, res),
    });
    track({
        kind: "exact",
        path: "/auth/status",
        handler: (req, res) => handleStatus(deps, req, res),
    });
    return () => {
        for (const disposer of [...disposers].reverse())
            disposer();
    };
}
// TODO(auth-m5): login CSRF token - re-evaluated in T13/D8, still not added.
function handleLogin(deps, req, res) {
    if (req.method === "GET") {
        const next = validateNext(queryOf(req).get("next") ?? "/");
        const host = resolvePublicHost(deps.publicHost, req.headers.host);
        res.setHeader("cache-control", "no-store");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        // 2026-09-17 重设计：TOTP 段提供「换一个账号」回退。GET ?stage=password 显式清掉
        // 挑战 cookie 并渲染密码页。只清 cookie、不放行任何凭据：下次提交仍需密码 + TOTP。
        if (queryOf(req).get("stage") === "password") {
            res.setHeader("set-cookie", buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure));
            res.end(passwordLoginPageHtml(next, undefined, { host }));
            return;
        }
        // M4 T6：合法挑战 cookie → 渲染 TOTP 挑战页；否则密码页。
        // off 模式忽略 TOTP（T4）：残留/伪造 cookie 一律渲染密码页。
        const challenge = parseChallengeValue(parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE), deps.now(), deps.challengeMacKey);
        const showTotp = challenge !== undefined && deps.totpMode !== "off";
        res.end(showTotp
            ? totpChallengePageHtml(next, undefined, {
                host,
                who: challenge,
                resetHref: loginPath(next, "password"),
            })
            : passwordLoginPageHtml(next, undefined, { host }));
        return;
    }
    if (req.method === "POST") {
        return handlePasswordLogin(deps, req, res);
    }
    methodNotAllowed(res, "GET, POST");
}
//# sourceMappingURL=password-endpoints.js.map