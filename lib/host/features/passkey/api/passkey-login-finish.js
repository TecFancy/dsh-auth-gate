import { methodNotAllowed, parseFormBody, resolvePublicHost, validateNext, } from "../../../shared/http/index.js";
import { clearCeremonyCookie, readCeremonyId } from "../model/ceremony-cookie.js";
import { findPasskeyCredential, PasskeyCounterStore, readPasskeyAssertion, } from "../model/passkey-login.js";
import { runDummyVerification, verifyPasskeyAssertion, } from "./passkey-assertion-verify.js";
import { sendPasskeyFailure, sendPasskeyLocked, sendPasskeyUnavailable, } from "./passkey-login-failures.js";
/**
 * finish 主流程：405 → 415/413 → 429（先于 ceremony）→ 503（先于 consume）→ 消费 ceremony
 * → 断言字段校验 → 用户文件 → 校验 → 签发。所有响应写完才返回。
 */
export async function handlePasskeyLogin(deps, counters, req, res) {
    if (req.method !== "POST") {
        methodNotAllowed(res, "POST");
        return;
    }
    let params;
    try {
        params = await parseFormBody(req);
    }
    catch (error) {
        respondFormError(res, error);
        return;
    }
    const ip = deps.clientIp(req);
    const context = failureContext(deps, req, params);
    const lockout = deps.limiter.check(ip, undefined);
    if (!lockout.allowed) {
        sendPasskeyLocked(res, context, lockout.retryAfterSeconds);
        deps.logger.info("passkey login rate limited");
        return;
    }
    // 503 在 consume 之前：会话层未就绪不得烧掉用户的在途 ceremony（可原样重试）。
    const store = deps.sessions();
    if (store === undefined) {
        sendPasskeyUnavailable(res);
        deps.logger.error("passkey login failed: session store unavailable");
        return;
    }
    await finishLogin(deps, counters, req, res, { params, store, ip, context });
}
/** 消费 ceremony 并校验断言（先删后验：重放与并发只剩第一次能看到记录）。 */
async function finishLogin(deps, counters, req, res, input) {
    const { params, store, ip, context } = input;
    const ceremony = deps.ceremony.consume(readCeremonyId(req.headers.cookie) ?? "");
    const clearCookie = clearCeremonyCookie(deps.cookieSecure);
    if (ceremony?.kind !== "login") {
        rejectLogin(deps, res, ip, undefined, context, "ceremony missing or expired", clearCookie);
        return;
    }
    const assertion = readPasskeyAssertion(params);
    if (assertion === undefined) {
        rejectLogin(deps, res, ip, undefined, context, "malformed assertion", clearCookie);
        return;
    }
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    const match = findPasskeyCredential(loaded.snapshot, assertion.id);
    if (match === undefined || match.user.disabled) {
        await runDummyVerification({
            settings: deps.settings,
            assertion,
            challenge: challengeOf(ceremony),
        });
        const reason = match === undefined ? "unknown credential" : "disabled user";
        rejectLogin(deps, res, ip, match?.username, context, reason, clearCookie);
        return;
    }
    const verdict = await verifyPasskeyAssertion({
        settings: deps.settings,
        match,
        assertion,
        challenge: challengeOf(ceremony),
        storedCounter: counters.stored(match.record),
    });
    if (!verdict.ok) {
        rejectLogin(deps, res, ip, match.username, context, verdict.reason, clearCookie);
        return;
    }
    await completeLogin(deps, counters, res, {
        match,
        verdict,
        store,
        ip,
        next: context.next,
        clearCookie,
    });
}
/** 成功路径：推进进程内计数器 → 清失败桶 → 注入 issueSession（受限语义由注入实现继承）。 */
async function completeLogin(deps, counters, res, input) {
    const { match, verdict, store, ip, next, clearCookie } = input;
    if (verdict.warn !== undefined) {
        deps.logger.warn(`passkey login: counter regression allowed for ${match.username} ` +
            `(credential ${match.record.credentialId.slice(0, 8)})`);
    }
    counters.advance(match.record, verdict.newCounter);
    deps.limiter.recordSuccess(ip, match.username);
    await deps.issueSession(res, store, match.username, next, match.user, [clearCookie]);
    deps.logger.info(`passkey login succeeded: ${match.username} (credential ${match.record.credentialId.slice(0, 8)})`);
}
/** 统一拒绝：计失败（已知用户按用户名桶，未知/伪凭据只按 IP）+ 401 卡片。 */
function rejectLogin(deps, res, ip, username, context, reason, clearCookie) {
    deps.limiter.recordFailure(ip, username);
    deps.logger.warn(`passkey login rejected: ${reason}`);
    sendPasskeyFailure(res, context, clearCookie);
}
/** 失败页上下文：反钓鱼 host 来自配置（回退请求头 Host）+ 消毒后的 next。 */
function failureContext(deps, req, params) {
    return {
        host: resolvePublicHost(deps.publicHost, req.headers.host),
        next: validateNext(params.get("next") ?? "/"),
    };
}
/** ceremony 的 32 字节 challenge → 库要的 base64url（与 options 响应里的值逐字一致）。 */
function challengeOf(ceremony) {
    return Buffer.from(ceremony.challenge).toString("base64url");
}
/** 用户文件不可用 → 503（与口令登录同形；不算失败、不消费 ceremony 之后的状态）。 */
async function loadUsersOr503(deps, res) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        res.setHeader("cache-control", "no-store");
        res.writeHead(503, { "content-type": "text/plain" });
        res.end("user store unavailable");
        deps.logger.error(`user store unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
/** 415/413 响应（与口令登录同形：413 先写 `connection: close`）；无 status 的异常向上抛。 */
function respondFormError(res, error) {
    const failed = error;
    if (typeof failed.status !== "number")
        throw error;
    res.setHeader("cache-control", "no-store");
    if (failed.status === 413)
        res.setHeader("connection", "close");
    res.writeHead(failed.status, { "content-type": "text/plain" });
    res.end(failed.message ?? "bad request");
}
//# sourceMappingURL=passkey-login-finish.js.map