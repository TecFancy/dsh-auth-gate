import { validateNext, parseCookieHeader, parseFormBody, loginPageHtml, } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { buildSetCookie } from "../../session/index.js";
/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（M15：webserver 无 method 路由，exact
 * 表只按 pathname 建键、重复 path 抛错，故 GET/POST `/auth/login` 不能注册两条路由，
 * 由 handler 内部按 `req.method` 分发）。返回合并 disposer（内部收集每个 register 的
 * disposer）。
 */
export function registerAuthEndpoints(deps) {
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
function handleLogin(deps, req, res) {
    if (req.method === "GET") {
        serveLoginPage(req, res);
        return;
    }
    if (req.method === "POST") {
        return loginAttempt(deps, req, res);
    }
    methodNotAllowed(res, "GET, POST");
}
/** GET：恒渲染登录页（不查会话、不重定向，M20）。 */
function serveLoginPage(req, res) {
    const next = validateNext(queryOf(req).get("next") ?? "/");
    res.setHeader("cache-control", "no-store");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(loginPageHtml(next));
}
async function loginAttempt(deps, req, res) {
    let params;
    try {
        params = await parseFormBody(req);
    }
    catch (error) {
        const failed = error;
        if (typeof failed.status !== "number")
            throw error; // 不带 status 的流异常：向上抛（webserver 400）
        res.setHeader("cache-control", "no-store");
        if (failed.status === 413)
            res.setHeader("connection", "close"); // M19
        res.writeHead(failed.status, { "content-type": "text/plain" });
        res.end(failed.message ?? "bad request");
        return;
    }
    const token = params.get("token") ?? "";
    const next = validateNext(params.get("next") ?? "/");
    if (!(await deps.validateToken(token))) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("invalid token");
        deps.logger.info("login rejected");
        return;
    }
    const store = deps.sessions();
    if (store === undefined) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("session store unavailable");
        deps.logger.error("login failed: session store unavailable");
        return;
    }
    const { token: sessionToken } = await store.create("token", deps.sessionTtl * 1000);
    res.setHeader("cache-control", "no-store");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure));
    res.writeHead(302, { location: next });
    res.end();
    deps.logger.info("session issued");
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
/** GET /auth/status：只认 cookie（M5，Bearer 不参与）。 */
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
//# sourceMappingURL=auth-endpoints.js.map