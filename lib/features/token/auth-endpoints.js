import { loginPageHtml, parseFormBody, resolvePublicHost, validateNext, } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { authCatchAll, handleLogout, handleStatus, methodNotAllowed, queryOf, } from "../../http/index.js";
import { buildSetCookie } from "../../session/index.js";
/**
 * 错 token 的唯一常量文案（D21）：所有拒绝共用同一响应形态，且绝不读 query、绝不反射
 * 请求文本（与密码段 `INVALID_CREDENTIALS` / P9 / D20 同一条纪律）。令牌模式只有一个
 * 共享秘密，本就没有账号枚举面，这条规则防的是「用请求内容拼文案」的开放重定向式用法。
 */
export const INVALID_TOKEN = "Invalid access token.";
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
function handleLogin(deps, req, res) {
    if (req.method === "GET") {
        serveLoginPage(deps, req, res);
        return;
    }
    if (req.method === "POST") {
        return loginAttempt(deps, req, res);
    }
    methodNotAllowed(res, "GET, POST");
}
/** GET：恒渲染登录页（不查会话、不重定向，M20）。 */
function serveLoginPage(deps, req, res) {
    const next = validateNext(queryOf(req).get("next") ?? "/");
    res.setHeader("cache-control", "no-store");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(loginPageHtml(next, undefined, { host: resolvePublicHost(deps.publicHost, req.headers.host) }));
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
        // 413/415 是协议层拒绝（非浏览器表单可达）：D21 刻意保留 text/plain 与 M19 语义。
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
        // D21：401 保持，body 换成登录卡片（error slot），否则浏览器导航只看到空白纯文本页。
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPageHtml(next, INVALID_TOKEN, {
            host: resolvePublicHost(deps.publicHost, req.headers.host),
        }));
        deps.logger.info("login rejected");
        return;
    }
    const store = deps.sessions();
    if (store === undefined) {
        // 运维故障（会话域未就绪）：D21 刻意保留 text/plain，用户无从修复，机器可读更有用。
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
//# sourceMappingURL=auth-endpoints.js.map