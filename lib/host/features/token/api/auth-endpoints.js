import { lockoutMessage, loginPageHtml } from "../../../shared/login-page/index.js";
import { authCatchAll, methodNotAllowed, mountRoutes, parseFormBody, queryOf, resolvePostLoginLocation, setPasskeyPermissionsPolicy, resolvePublicHost, validateNext, } from "../../../shared/http/index.js";
import { AUTH_PATH_PREFIX, LOGIN_PATH, LOGOUT_PATH, STATUS_PATH, } from "../../../shared/protocol/index.js";
import { buildSetCookie, handleLogout, handleStatus, } from "../../../entities/session/index.js";
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
 * disposer；部分失败按注册逆序回滚，见 `mountRoutes`）。
 */
export function registerAuthEndpoints(deps) {
    return mountRoutes(deps.register, [
        { kind: "prefix", path: AUTH_PATH_PREFIX, handler: authCatchAll },
        {
            kind: "exact",
            path: LOGIN_PATH,
            handler: (req, res) => handleLogin(deps, req, res),
        },
        {
            kind: "exact",
            path: LOGOUT_PATH,
            handler: (req, res) => handleLogout(deps, req, res),
        },
        {
            kind: "exact",
            path: STATUS_PATH,
            handler: (req, res) => handleStatus(deps, req, res),
        },
    ]);
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
    setPasskeyPermissionsPolicy(res);
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
    const admitted = deps.limiter.admit(deps.clientIp(req), undefined, "token");
    if (!admitted.admitted) {
        // D21 的同一张卡片：限速器是 D39 之后才加到 token 域的，裸文本 429 会让浏览器导航
        // 落回 #85 要消灭的那张白页（口令段的 429 早就是 HTML 卡片）。
        res.setHeader("cache-control", "no-store");
        res.setHeader("retry-after", String(admitted.retryAfterSeconds));
        res.writeHead(429, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPageHtml(next, lockoutMessage(admitted.retryAfterSeconds), {
            host: resolvePublicHost(deps.publicHost, req.headers.host),
        }));
        deps.logger.info("rate limit exceeded");
        return;
    }
    try {
        await completeLogin(deps, req, res, token, next, admitted.admission);
    }
    finally {
        admitted.admission.settle("abandon"); // 已结算时是空操作
    }
}
/** 受理之后的校验与签发；失败计 token 域，成功清该域。 */
async function completeLogin(deps, req, res, token, next, admission) {
    if (!(await deps.validateToken(token))) {
        // D21：401 保持，body 换成登录卡片（error slot），否则浏览器导航只看到空白纯文本页。
        res.setHeader("cache-control", "no-store");
        res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
        res.end(loginPageHtml(next, INVALID_TOKEN, {
            host: resolvePublicHost(deps.publicHost, req.headers.host),
        }));
        admission.settle("failure");
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
    admission.settle("success");
    const { token: sessionToken } = await store.create("token", deps.sessionTtl * 1000);
    res.setHeader("cache-control", "no-store");
    // 抑制发往 `/?token=` 那一跳的 Referer：登录页 URL 不作为下游 Referer 传播（与 dsh 303 同形）。
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("set-cookie", buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure));
    const location = await resolvePostLoginLocation(deps.launchTokenBridge, next, deps.logger);
    res.writeHead(302, { location });
    res.end();
    deps.logger.info("session issued");
}
