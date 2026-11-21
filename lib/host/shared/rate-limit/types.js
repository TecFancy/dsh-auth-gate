/**
 * 限速器的公共类型与键工具：从 `rate-limit.ts` 拆出守住单文件行数上限。
 * 语义文档见 `rate-limit.ts`（类）与 Agent Note D39。
 */
/** 每个域的桶键：`scope\u0000value`。 */
export function keyOf(scope, value) {
    return `${scope}\u0000${value}`;
}
/** 从已拼好的 IP 键（`scope\u0000value`）还原同一域的账号键。 */
export function acctKeyOf(ipKey, account) {
    return `${ipKey.slice(0, ipKey.indexOf("\u0000"))}\u0000${account}`;
}
export const SCOPES = [
    "login",
    "totp",
    "passkey",
    "token",
    "password-change",
    "admin",
];
/**
 * 把一个账号闸并入已有的 IP 受理句柄：结算时两个都结算，重复调用由各自挡住。
 * passkey 的流程是「先占 IP，解析出用户后再占账号」，调用方只需继续使用合并后的句柄。
 */
export function combineAdmissions(primary, secondary) {
    return {
        settle: (outcome, account) => {
            primary.settle(outcome, account);
            secondary.settle(outcome);
        },
    };
}
