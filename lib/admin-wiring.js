import { makeAdminRoutes } from "./features/admin/index.js";
import { hashPassword, verifyPassword } from "./features/password/index.js";
import { verifyTotpCode } from "./features/totp/index.js";
import { LoginRateLimiter, loadUsersFile, mutateUsersFile } from "./shared/index.js";
export function makeAdminWiring(input) {
    return makeAdminRoutes({
        sessions: input.sessions,
        cookieName: input.cookieName,
        // 管理面每请求现读 users.yaml（绝不信会话缓存 / /auth/status）。
        loadUsers: async () => (await loadUsersFile(input.usersPath)).snapshot,
        mutateUsers: (mutator) => mutateUsersFile(input.usersPath, mutator),
        hash: hashPassword,
        verify: verifyPassword,
        verifyTotp: (secretB32, code, nowMs) => verifyTotpCode(secretB32, code, nowMs),
        replayCheck: input.replayCheck,
        clientIp: input.clientIp,
        publicHost: input.publicHost,
        limiter: new LoginRateLimiter(),
        // D22：写盘已成功 ⇒ 吊销失败不得改变 200 语义，只置 sessionsRevoked:false。
        revokeSubject: (subject) => revokeSubjectNow(input.sessions, subject, input.log),
        clearRateBuckets: (subject) => {
            input.limiter.clearAccount(subject);
            input.passwordChangeLimiter.clearAccount(subject);
        },
        now: Date.now,
        logger: input.log,
    });
}
/**
 * 管理重置用的吊销探针（P2 §2）：返回「是否全部吊销成功」而**不抛**。
 * 与 P1 自助改密的 revoker 分开实现：那边在 200 语义下静默吞错，这边要把真假
 * 落到响应的 `sessionsRevoked` 与审计字段里，所以必须把结果带出来。
 */
async function revokeSubjectNow(sessions, subject, log) {
    const store = sessions();
    if (store === undefined) {
        log.error(`sessions not revoked after admin reset: ${subject} (session store unavailable)`);
        return false;
    }
    try {
        const revoked = await store.revokeBySubject(subject);
        log.info(`sessions revoked after admin reset: ${subject} (${revoked} sessions)`);
        return true;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log.error(`sessions not revoked after admin reset: ${subject} (${reason})`);
        return false;
    }
}
//# sourceMappingURL=admin-wiring.js.map