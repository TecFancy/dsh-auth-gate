import { methodNotAllowed, parseFormBody, setPasskeyPermissionsPolicy, } from "../../../shared/http/index.js";
import { clearCeremonyCookie, readCeremonyId } from "../model/ceremony-cookie.js";
import { findPasskeyCredential, PasskeyCounterStore, readPasskeyAssertion, } from "../model/passkey-login.js";
import { runDummyVerification, verifyPasskeyAssertion, } from "./passkey-assertion-verify.js";
import { challengeOf, failureContext, loadUsersOr503, sendPasskeyFailure, sendPasskeyLocked, sendPasskeyUnavailable, } from "./passkey-login-failures.js";
/**
 * finish 主流程：405 → 415/413 → 429（先于 ceremony）→ 503（先于 consume）→ 消费 ceremony
 * → 断言字段校验 → 用户文件 → 校验 → 签发。所有响应写完才返回。
 */
export async function handlePasskeyLogin(deps, counters, req, res) {
    setPasskeyPermissionsPolicy(res);
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
    const context = failureContext(deps.publicHost, req, params, deps.passwordLoginDisabled);
    // 受理即占位（P1.3）：并发的断言尝试不能全部先看到「未锁定」。
    const admitted = deps.limiter.admit(ip, undefined, "passkey");
    if (!admitted.admitted) {
        sendPasskeyLocked(res, context, admitted.retryAfterSeconds);
        deps.logger.info("passkey login rate limited");
        return;
    }
    try {
        await runLogin(deps, counters, req, res, { params, context, admission: admitted.admission });
    }
    finally {
        admitted.admission.settle("abandon"); // 已结算时是空操作
    }
}
/** 受理之后的存储检查与 ceremony 消费；503 出口不结算失败（不烧在途 ceremony）。 */
async function runLogin(deps, counters, req, res, input) {
    // 503 在 consume 之前：会话层/用户存储未就绪不得烧掉用户的在途 ceremony（可原样重试）。
    const store = deps.sessions();
    if (store === undefined) {
        sendPasskeyUnavailable(res);
        deps.logger.error("passkey login failed: session store unavailable");
        return;
    }
    // 用户快照也在 consume 之前读：瞬时读盘失败不该把 ceremony 烧掉（§5.6）。
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    await finishLogin(deps, counters, req, res, { ...input, store, loaded });
}
/** 消费 ceremony 并校验断言（先删后验：重放与并发只剩第一次能看到记录）。 */
async function finishLogin(deps, counters, req, res, input) {
    const { params, store, context, loaded, admission } = input;
    const ceremony = deps.ceremony.consume(readCeremonyId(req.headers.cookie) ?? "");
    const clearCookie = clearCeremonyCookie(deps.cookieSecure);
    if (ceremony?.kind !== "login") {
        rejectLogin(deps, res, undefined, context, "ceremony missing or expired", clearCookie, admission);
        return;
    }
    const assertion = readPasskeyAssertion(params);
    if (assertion === undefined) {
        rejectLogin(deps, res, undefined, context, "malformed assertion", clearCookie, admission);
        return;
    }
    const match = findPasskeyCredential(loaded.snapshot, assertion.id);
    if (match === undefined || match.user.disabled) {
        await runDummyVerification({
            settings: deps.settings,
            assertion,
            challenge: challengeOf(ceremony),
        });
        const reason = match === undefined ? "unknown credential" : "disabled user";
        rejectLogin(deps, res, match?.username, context, reason, clearCookie, admission);
        return;
    }
    const storedCounter = counters.stored(match.record);
    const verdict = await verifyPasskeyAssertion({
        settings: deps.settings,
        match,
        assertion,
        challenge: challengeOf(ceremony),
        storedCounter,
    });
    if (!verdict.ok) {
        rejectLogin(deps, res, match.username, context, verdict.reason, clearCookie, admission);
        return;
    }
    // 并发断言：验证期间同一凭据已被推进过 ⇒ 这一条基于过期计数器，按重放拒绝（P2 L13）。
    // 判定与下面的 advance 之间没有 await，Node 单线程下是原子的。
    if (!counters.isCurrent(match.record, storedCounter)) {
        rejectLogin(deps, res, match.username, context, "counter advanced concurrently", clearCookie, admission);
        return;
    }
    await completeLogin(deps, counters, res, {
        admission,
        match,
        verdict,
        store,
        next: context.next,
        clearCookie,
    });
}
/** 成功路径：推进进程内计数器 → 清失败桶 → 注入 issueSession（受限语义由注入实现继承）。 */
async function completeLogin(deps, counters, res, input) {
    const { admission, match, verdict, store, next, clearCookie } = input;
    if (verdict.warn !== undefined) {
        deps.logger.warn(`passkey login: counter regression allowed for ${match.username} ` +
            `(credential ${match.record.credentialId.slice(0, 8)})`);
    }
    counters.advance(match.record, verdict.newCounter);
    admission.settle("success", match.username);
    await deps.issueSession(res, store, match.username, next, match.user, [clearCookie]);
    deps.logger.info(`passkey login succeeded: ${match.username} (credential ${match.record.credentialId.slice(0, 8)})`);
}
/** 统一拒绝：计失败（已知用户按用户名桶，未知/伪凭据只按 IP）+ 401 卡片。 */
function rejectLogin(deps, res, username, context, reason, clearCookie, admission) {
    admission.settle("failure", username);
    deps.logger.warn(`passkey login rejected: ${reason}`);
    sendPasskeyFailure(res, context, clearCookie);
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
