import { USERNAME_RE, checkPasswordPolicy, checkRequestOrigin, parseCookieHeader, } from "../../shared/index.js";
import { auditDenied } from "./audit.js";
import { deny, fail, safeMessage, sendText } from "./respond.js";
/** P2 §6：Origin / Sec-Fetch-Site 同源校验（fail-closed，publicHost 缺省只信 Sec-Fetch-Site）。 */
export function originAccepted(deps, req) {
    return checkRequestOrigin(originRequest(req), deps.publicHost).ok;
}
/**
 * `OriginCheckRequest` 结构适配：`IncomingMessage["socket"]` 的类型是 `net.Socket`，
 * TLS 标记 `encrypted` 只存在于 `TLSSocket`（运行时才有），故这里现取一次布尔值。
 */
function originRequest(req) {
    return { headers: req.headers, socket: { encrypted: isEncrypted(req.socket) } };
}
function isEncrypted(socket) {
    return "encrypted" in socket && socket.encrypted === true;
}
/** 会话定位：只认 cookie（M5 同口径），Bearer 不参与；store/token 无效一律 undefined。 */
export function locateSession(deps, req) {
    const store = deps.sessions();
    const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (store === undefined || token === undefined || token === "")
        return undefined;
    return store.getByToken(token);
}
/** 管理桶门（key = actor subject + clientIp）：锁定 → retry-after 秒数；放行 → undefined。 */
export function lockoutSeconds(deps, ctx) {
    const check = deps.limiter.check(ctx.clientIp, ctx.actor);
    return check.allowed ? undefined : check.retryAfterSeconds;
}
/**
 * 现读 users.yaml。失败 → 503（读失败**不计失败**，与 P1 端点同口径）；
 * 带 `ctx` 时记审计 `io`（已认证拒绝必须留痕，§5）。
 */
export async function loadUsersOr503(deps, res, ctx, secrets = []) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        deps.logger.error(`admin user store unavailable: ${safeMessage(error, secrets)}`);
        if (ctx !== undefined)
            auditDenied(deps.logger, ctx, "io");
        sendText(res, 503, "user store unavailable");
        return undefined;
    }
}
/**
 * admin 校验（§2）：**每请求现读 users.yaml** 的 `role === "admin" && !disabled`，
 * 绝不信会话内缓存（会话对象本就没有 role）。非 admin / 不存在 / 禁用 → 403。
 */
export async function adminActor(deps, res, ctx, secrets = []) {
    const snapshot = await loadUsersOr503(deps, res, ctx, secrets);
    if (snapshot === undefined)
        return undefined;
    const actor = snapshot.users.get(ctx.actor);
    if (actor?.role !== "admin" || actor.disabled === true) {
        deny(deps, res, ctx, "forbidden", 403, { error: "forbidden" });
        return undefined;
    }
    return actor;
}
/**
 * 限流之后的校验链（§2）：现读 users → 目标名（`USERNAME_RE`）→ 404 → `self` 403 →
 * 策略（含 `≠旧`：用目标现哈希验一次）→ 条件式 TOTP。
 * **策略在 TOTP 之前**：口令不合规不该消费一枚验证码（§2 次序理由）。
 */
export async function resetTarget(deps, res, ctx, input) {
    const snapshot = await loadUsersOr503(deps, res, ctx, input.secrets);
    if (snapshot === undefined)
        return undefined;
    if (!USERNAME_RE.test(ctx.target)) {
        fail(deps, res, ctx, "bad_target", 400, { error: "bad_target" });
        return undefined;
    }
    const target = snapshot.users.get(ctx.target);
    if (target === undefined) {
        fail(deps, res, ctx, "not_found", 404, { error: "not_found" });
        return undefined;
    }
    ctx.targetDisabled = target.disabled === true;
    if (ctx.target === ctx.actor) {
        // 在 TOTP 之前挡下：否则自砸 30 秒窗口（§2）。
        fail(deps, res, ctx, "self", 403, { error: "forbidden" });
        return undefined;
    }
    const policy = await checkPasswordPolicy(input.password, {
        oldPasswordHash: target.passwordHash,
        verifyOld: deps.verify,
    });
    if (!policy.ok) {
        fail(deps, res, ctx, "policy", 400, { error: "policy", rules: policy.rules });
        return undefined;
    }
    if (!reauthAccepted(deps, ctx, input)) {
        fail(deps, res, ctx, "bad_reauth", 401, { error: "invalid_totp" });
        return undefined;
    }
    return target;
}
/**
 * 条件式再认证（§6）：actor **自己**启用 TOTP 才要求 `code`；未启用时带了也忽略
 * （写死，不 400；码不进日志）。命中 → `replayCheck(actor, counter, code)`（登录侧同一单例）。
 */
function reauthAccepted(deps, ctx, input) {
    const secret = input.actor.totpSecret;
    if (secret === undefined)
        return true;
    ctx.reauth = "totp";
    const counter = deps.verifyTotp(secret, input.code, deps.now());
    return counter !== undefined && deps.replayCheck(ctx.actor, counter, input.code);
}
/** 新口令哈希；失败 → `ioFailure`（503 + 审计 `io` + 计失败）。 */
export async function hashOr503(deps, res, ctx, input) {
    try {
        return await deps.hash(input.password);
    }
    catch (error) {
        return ioFailure(deps, res, ctx, error, input.secrets);
    }
}
/**
 * 锁内复核失败（TOCTOU，grok #5）：actor 在**锁外授权读之后**被降权/禁用。
 * 与 IO 失败严格区分：映射为 403 `forbidden`，不写盘、不吊销、不计失败。
 */
export class ActorNotAdminError extends Error {
    constructor(actor) {
        super(`actor is no longer an admin: ${actor}`);
        this.name = "ActorNotAdminError";
    }
}
/**
 * 锁内 RMW（唯一变更入口）：**先复核 actor 仍是 admin 且未禁用**（TOCTOU，grok #5），
 * 再设 `must_change_password: true` + 新哈希。`totpSecret` / `role` / `disabled` 一律不动（验收 8）；
 * 只改这两个字段，last-admin 判定不会误触发。目标在锁内消失 → 抛错 → 503（不静默写幽灵用户）。
 */
export async function writeReset(deps, res, ctx, hashed, secrets = []) {
    try {
        await deps.mutateUsers((snapshot) => {
            // 授权读在锁外（adminActor），锁内必须复核：降权/禁用发生在两者之间时不得写盘。
            const actor = snapshot.users.get(ctx.actor);
            if (actor?.role !== "admin" || actor.disabled === true) {
                throw new ActorNotAdminError(ctx.actor);
            }
            const record = snapshot.users.get(ctx.target);
            if (record === undefined) {
                throw new Error(`target not found in users snapshot: ${ctx.target}`);
            }
            record.passwordHash = hashed;
            record.mustChangePassword = true;
        });
        return true;
    }
    catch (error) {
        if (error instanceof ActorNotAdminError) {
            // 授权状态已变（不是 IO 故障）：403 + 审计 forbidden，不写哈希、不吊销、不计失败。
            deny(deps, res, ctx, "forbidden", 403, { error: "forbidden" });
            return false;
        }
        ioFailure(deps, res, ctx, error, secrets);
        return false;
    }
}
/** 撤销目标全部会话（`self` 已挡掉 ⇒ 天然不含 actor）；注入方保证不抛，这里仍兜底。 */
export async function revokeTarget(deps, ctx, secrets = []) {
    try {
        return await deps.revokeSubject(ctx.target);
    }
    catch (error) {
        deps.logger.error(`admin session revoke failed: ${safeMessage(error, secrets)}`);
        return false;
    }
}
/** 写盘/哈希失败统一出口：计失败 + `logger.error` + 审计 `io` + 503 text/plain。 */
function ioFailure(deps, res, ctx, error, secrets) {
    deps.limiter.recordFailure(ctx.clientIp, ctx.actor);
    deps.logger.error(`admin password reset failed: ${safeMessage(error, secrets)}`);
    auditDenied(deps.logger, ctx, "io");
    sendText(res, 503, "password reset unavailable");
    return undefined;
}
//# sourceMappingURL=reset-steps.js.map