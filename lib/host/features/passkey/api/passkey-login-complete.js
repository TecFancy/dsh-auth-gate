import { sendPasskeyFailure } from "./passkey-login-failures.js";
/** 成功路径：推进进程内计数器 → 清失败桶 → 注入 issueSession（受限语义由注入实现继承）。 */
export async function completeLogin(deps, counters, res, input) {
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
export function rejectLogin(deps, res, username, context, reason, clearCookie, admission) {
    admission.settle("failure", username);
    deps.logger.warn(`passkey login rejected: ${reason}`);
    sendPasskeyFailure(res, context, clearCookie);
}
