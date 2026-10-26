import { isNavigationRequest } from "../../../shared/guard/index.js";
import { checkRequestOrigin, parseCookieHeader, parseFormBody, } from "../../../shared/http/index.js";
import { BOOTSTRAP_SESSION_KIND, CONTINUE_PATH } from "../../../shared/protocol/index.js";
import { isBootstrapSession } from "../../../entities/session/index.js";
import { redirectTo, redirectToLogin, sendHtml, sendText } from "../model/respond.js";
import { setupConfiguredHtml, setupPageHtml, setupResultHtml } from "../model/setup-page.js";
const UNTRUSTED_ORIGIN = "untrusted origin";
const ALREADY_CONFIGURED = "already configured";
const UNAUTHORIZED = "unauthorized";
const SAVE_FAILED = "Could not store the access token. Set DSH_AUTH_TOKEN in the environment and restart dsh.";
const ADMIN_FAILED = "Could not create the administrator account. Check the users file and retry.";
const MISMATCH = "The two passwords do not match.";
const INVALID = "Check the username and password rules and retry. Passwords need at least 14 characters with upper case, lower case, a digit and a symbol.";
const CONFLICT = "That username already exists.";
/**
 * 首次配置向导的两个方法（`/auth/setup`：GET 渲染、POST 提交；webserver 的 exact 表按
 * pathname 建键，GET/POST 不能注册成两条路由）。
 *
 * 三条硬约束：只有有效的 `bootstrap` 会话能进（正式会话看到「已配置」页，无会话回登录页）；
 * **每次 GET/POST 都复查未配置探针**：bootstrap 会话能跨重启活最多 1 小时，期间运维可能已经
 * 用 CLI 补好凭据，配置一旦成立就不能再从这张旧会话写盘；POST 还必须过同源校验，与既有写路径
 * 同一条纪律。向导完成后先吊销全部 bootstrap 会话，再给当前响应签发正式会话。
 */
export function makeSetupHandlers(deps) {
    return {
        get: (req, res) => handleGet(deps, req, res),
        post: (req, res) => handlePost(deps, req, res),
    };
}
async function handleGet(deps, req, res) {
    const session = sessionOf(deps, req);
    if (session === undefined) {
        redirectToLogin(res);
        return;
    }
    // 正式会话、或配置在 bootstrap 会话签发之后成立了：都只给「已配置」页，绝不再渲染向导。
    if (!isBootstrapSession(session) || (await deps.probe.state()) !== "unconfigured") {
        sendHtml(res, 200, setupConfiguredHtml());
        return;
    }
    sendHtml(res, 200, setupPageHtml(pageInput(deps)));
}
async function handlePost(deps, req, res) {
    if (!isBootstrapSession(sessionOf(deps, req))) {
        denyUnauthenticated(req, res);
        return;
    }
    if ((await deps.probe.state()) !== "unconfigured") {
        await denyAlreadyConfigured(deps, req, res);
        return;
    }
    const origin = checkRequestOrigin(req, deps.publicHost);
    if (!origin.ok) {
        deps.logger.warn(`setup rejected: ${origin.detail}`);
        sendText(res, 403, UNTRUSTED_ORIGIN);
        return;
    }
    const params = await readForm(req, res);
    if (params === undefined)
        return;
    if (deps.mode === "token") {
        await completeTokenSetup(deps, res);
        return;
    }
    await completePasswordSetup(deps, res, {
        username: params.get("username") ?? "",
        password: params.get("password") ?? "",
        confirm: params.get("confirm") ?? "",
    });
}
/** token 模式：服务端生成并保存令牌 → 吊销 bootstrap 会话 → 签发正式会话 → 结果页。 */
async function completeTokenSetup(deps, res) {
    const outcome = await deps.saveToken();
    if (outcome.status === "failed") {
        deps.logger.warn("setup failed: access token not stored");
        sendText(res, 500, SAVE_FAILED);
        return;
    }
    await revokeBootstrapSessions(deps);
    await deps.issueFullSession("token", res);
    deps.logger.info("setup complete: access token saved");
    sendHtml(res, 200, setupResultHtml({
        token: outcome.token ?? "",
        unreadable: outcome.status === "saved-unreadable",
    }));
}
/** password 模式：确认口令 → 建管理员 → 吊销 bootstrap 会话 → 签发正式会话 → 回首页。 */
async function completePasswordSetup(deps, res, form) {
    if (form.password !== form.confirm) {
        renderForm(deps, res, MISMATCH);
        return;
    }
    const outcome = await deps.createAdmin(form.username, form.password);
    if (outcome === "invalid") {
        renderForm(deps, res, INVALID);
        return;
    }
    if (outcome === "conflict") {
        renderForm(deps, res, CONFLICT);
        return;
    }
    if (outcome === "failed") {
        deps.logger.warn("setup failed: administrator account not created");
        sendText(res, 500, ADMIN_FAILED);
        return;
    }
    await revokeBootstrapSessions(deps);
    await deps.issueFullSession(form.username, res);
    deps.logger.info("setup complete: administrator created");
    redirectTo(res, CONTINUE_PATH);
}
/** 表单级失败：400 重渲染向导页（错误文案是固定句子，不回显表单内容）。 */
function renderForm(deps, res, error) {
    sendHtml(res, 400, setupPageHtml({ ...pageInput(deps), error }));
}
function pageInput(deps) {
    return {
        mode: deps.mode,
        tokenRef: deps.tokenRef,
        cookieSecure: deps.cookieSecure,
        sessionTtl: deps.sessionTtlSeconds,
        usersPath: deps.usersPath,
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
/**
 * 配置已经成立、但持着旧 bootstrap 会话的 POST：先吊销全部 bootstrap 会话，再拒绝。
 * 导航 302 登录页（浏览器表单就是导航），其余 403 固定句。**绝不写盘。**
 */
async function denyAlreadyConfigured(deps, req, res) {
    deps.logger.warn("setup rejected: instance already configured");
    await revokeBootstrapSessions(deps);
    if (isNavigationRequest(req)) {
        redirectToLogin(res);
        return;
    }
    sendText(res, 403, ALREADY_CONFIGURED);
}
/** 未认证的 POST：导航 302 登录页（浏览器表单就是导航），其余 401。 */
function denyUnauthenticated(req, res) {
    if (isNavigationRequest(req)) {
        redirectToLogin(res);
        return;
    }
    sendText(res, 401, UNAUTHORIZED);
}
/** 读表单体；413/415 在这里直接写响应，其余流异常向上抛（webserver 统一处理）。 */
async function readForm(req, res) {
    try {
        return await parseFormBody(req);
    }
    catch (error) {
        const failed = error;
        if (typeof failed.status !== "number")
            throw error;
        if (failed.status === 413)
            res.setHeader("connection", "close");
        sendText(res, failed.status, failed.message ?? "bad request");
        return undefined;
    }
}
/** 关窗：向导完成后所有 bootstrap 会话立即失效；吊销失败不改变已经成立的成功语义。 */
async function revokeBootstrapSessions(deps) {
    const store = deps.sessions();
    if (store === undefined)
        return;
    try {
        const revoked = await store.revokeByKind(BOOTSTRAP_SESSION_KIND);
        if (revoked > 0)
            deps.logger.info(`bootstrap sessions revoked: ${revoked}`);
    }
    catch {
        deps.logger.warn("bootstrap session revoke failed");
    }
}
//# sourceMappingURL=setup-endpoint.js.map