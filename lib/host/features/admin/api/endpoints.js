import { formField, methodNotAllowed, parseFormBody } from "../../../shared/http/index.js";
import { auditSuccess } from "../model/audit.js";
import { deny, respondFormError, sendJson } from "./respond.js";
import { adminActor, hashOr503, loadUsersOr503, locateSession, admitAttempt, originAccepted, resetTarget, revokeTarget, settleAttempt, writeReset, } from "../model/reset-steps.js";
import { projectUsers } from "../model/users-list.js";
/** 装配两条管理路由（index.ts 注册为 `/auth/users` 与 `/auth/users/password`）。 */
export function makeAdminRoutes(deps) {
    return {
        users: (req, res) => handleUsers(deps, req, res),
        resetPassword: (req, res) => handleResetPassword(deps, req, res),
    };
}
/**
 * 管理面只收正式会话（G12 allow-list）：`full` 或缺省 `kind` 的旧行。受限会话
 * （`password-change-only`）与 bootstrap 会话一律 403；将来新增的 session kind 默认被拒，
 * 不需要在每处补一个 `!==`。
 */
function isFullSession(session) {
    return session.kind === undefined || session.kind === "full";
}
/** `GET /auth/users`：405 → 401 → 403（非 admin / 受限会话）→ 200 列表。**不产生审计**（§5 噪声）。 */
export function handleUsers(deps, req, res) {
    if (req.method !== "GET") {
        methodNotAllowed(res, "GET");
        return;
    }
    const session = locateSession(deps, req);
    if (session === undefined) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
    }
    return listUsers(deps, res, session);
}
async function listUsers(deps, res, session) {
    const snapshot = await loadUsersOr503(deps, res);
    if (snapshot === undefined)
        return;
    const actor = snapshot.users.get(session.subject);
    // 授权一律现读 yaml（§6 角色即时性）；受限会话不进管理面（§3）。
    if (actor?.role !== "admin" || actor.disabled === true) {
        sendJson(res, 403, { error: "forbidden" });
        return;
    }
    if (!isFullSession(session)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
    }
    sendJson(res, 200, { users: projectUsers(snapshot) });
}
/**
 * `POST /auth/users/password`：顺序冻结（§2），不得重排：
 * 405 → 415/413 → Origin → 401 → admin 403 → 受限会话 403 → 限流桶 → 现读 users
 * → 目标名 → 404 → `self` 403 → 策略 → 条件式 TOTP → 锁内写盘 → 吊销目标会话
 * → 清目标限流桶 → `200 {ok,sessionsRevoked}` + 审计。
 * `target` **只认 body**（query 里的同名字段一律忽略）；`confirm` 由客户端校验，服务端不读。
 */
export async function handleResetPassword(deps, req, res) {
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
    const session = locateSession(deps, req);
    const ctx = {
        ts: deps.now(),
        actor: session?.subject ?? "",
        target: formField(params, "target"),
        clientIp: deps.clientIp(req),
        reauth: "none",
        targetDisabled: false,
    };
    const password = formField(params, "password");
    const code = formField(params, "code");
    // 打码白名单：日志里出现这两个明文即替换（§5），贯穿到 hash/写盘/吊销的错误出口。
    const secrets = [password, code];
    try {
        const actor = await authorizeReset(deps, req, res, ctx, session, secrets);
        if (actor === undefined)
            return;
        const input = { actor, password, code, secrets };
        if ((await resetTarget(deps, res, ctx, input)) === undefined)
            return;
        const hashed = await hashOr503(deps, res, ctx, input);
        if (hashed === undefined)
            return;
        if (!(await writeReset(deps, res, ctx, hashed, input.secrets)))
            return;
        // 写盘已成功：吊销失败仍 200（§2 / D22），审计同一条成功事件带 sessionsRevoked:false。
        const sessionsRevoked = await revokeTarget(deps, ctx, input.secrets);
        deps.clearRateBuckets(ctx.target);
        settleAttempt(ctx, "success");
        // 已认证面成功同清 IP 桶（与改密一致）：不要把操作人锁在自己的管理表单外面。
        deps.limiter.recordSuccess(ctx.clientIp, ctx.actor, "admin");
        auditSuccess(deps.logger, ctx, sessionsRevoked);
        sendJson(res, 200, { ok: true, sessionsRevoked });
    }
    finally {
        settleAttempt(ctx, "abandon"); // 已结算时是空操作；503/异常只释放占位
    }
}
/**
 * 前半段门（§2）：Origin 403 → 会话 401 → admin 403（每请求现读）→ 受限会话 403 → 限流 429。
 * 返回通过全部门禁的 actor 记录；任一门未过时已写好响应并返回 undefined。
 */
async function authorizeReset(deps, req, res, ctx, session, secrets) {
    if (!originAccepted(deps, req)) {
        deny(deps, res, ctx, "bad_origin", 403, { error: "forbidden" });
        return undefined;
    }
    if (session === undefined) {
        deny(deps, res, ctx, "unauthenticated", 401, { error: "unauthorized" });
        return undefined;
    }
    const actor = await adminActor(deps, res, ctx, secrets);
    if (actor === undefined)
        return undefined;
    if (!isFullSession(session)) {
        deny(deps, res, ctx, "forbidden", 403, { error: "forbidden" });
        return undefined;
    }
    const lockout = admitAttempt(deps, ctx);
    if (lockout !== undefined) {
        res.setHeader("retry-after", String(lockout));
        deny(deps, res, ctx, "rate_limited", 429, { error: "locked", retryAfter: lockout });
        return undefined;
    }
    return actor;
}
