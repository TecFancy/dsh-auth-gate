import { validateNext, parseCookieHeader, passwordLoginPageHtml, totpChallengePageHtml, } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { handlePasswordLogin, CHALLENGE_COOKIE, parseChallengeValue, } from "./password-login.js";
import { buildSetCookie } from "../../session/index.js";
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
/** 兜底：未注册的 `/auth/*` 一律 404，不落到 SPA fallback（M20）。 */
function authCatchAll(_req, res) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
}
// TODO(auth-m5): login CSRF token - re-evaluated in T13/D8, still not added.
function handleLogin(deps, req, res) {
    if (req.method === "GET") {
        const next = validateNext(queryOf(req).get("next") ?? "/");
        res.setHeader("cache-control", "no-store");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        // M4 T6：合法挑战 cookie → 渲染 TOTP 挑战页；否则密码页。
        // off 模式忽略 TOTP（T4）：残留/伪造 cookie 一律渲染密码页。
        const challenge = parseChallengeValue(parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE), deps.now(), deps.challengeMacKey);
        const showTotp = challenge !== undefined && deps.totpMode !== "off";
        res.end(showTotp ? totpChallengePageHtml(next) : passwordLoginPageHtml(next));
        return;
    }
    if (req.method === "POST") {
        return handlePasswordLogin(deps, req, res);
    }
    methodNotAllowed(res, "GET, POST");
}
function handleLogout(deps, req, res) {
    if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
    }
    return logout(deps, req, res);
}
/** POST /auth/logout：next 仅从 query 取（M22），不解析 body、不要求 content-type。 */
async function logout(deps, req, res) {
    const next = validateNext(queryOf(req).get("next") ?? "/");
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (store !== undefined && token !== undefined && token !== "") {
        await store.revokeByToken(token); // 无会话/无 cookie 静默成功
    }
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure));
    res.writeHead(302, { location: next });
    res.end();
    deps.logger.info("logout");
}
/** GET /auth/status：只认 cookie（M5，Bearer 会话 token 不参与）。 */
function handleStatus(deps, req, res) {
    if (req.method !== "GET") {
        methodNotAllowed(res, "GET");
        return;
    }
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    const authenticated = store !== undefined &&
        token !== undefined &&
        token !== "" &&
        store.getByToken(token) !== undefined;
    res.setHeader("cache-control", "no-store");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ authenticated, logoutOrder: deps.logoutOrder }));
}
function queryOf(req) {
    return new URL(req.url ?? "/", "http://x").searchParams;
}
function methodNotAllowed(res, allow) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(405, { allow, "content-type": "text/plain" });
    res.end("method not allowed");
}
//# sourceMappingURL=password-endpoints.js.map