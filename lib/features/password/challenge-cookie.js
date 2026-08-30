import { createHmac, timingSafeEqual } from "node:crypto";
/** TOTP 挑战 cookie 名（M4 T5）。 */
export const CHALLENGE_COOKIE = "dsh_auth_challenge";
/** 挑战 cookie 有效期（秒，M4 T5 模块常量）。 */
export const CHALLENGE_TTL_SECONDS = 300;
/**
 * 挑战 cookie 值格式 `<username>.<expiresEpochMs>.<mac>`（D10：HMAC 签名）。
 * mac = HMAC-SHA256(key, `<username>.<expiresEpochMs>`) 的 base64url（43 字符，无 `.`，
 * 因此用户名的 `.` 不会与分隔符冲突，始终从右侧切）。密钥为进程级随机值
 * （apply() 与 limiter / replayGuard 同寿命）；重启/插件重载后在途挑战失效。
 */
export function buildChallengeValue(username, expiresEpochMs, key) {
    const prefix = `${username}.${expiresEpochMs}`;
    const mac = createHmac("sha256", key).update(prefix).digest("base64url");
    return `${prefix}.${mac}`;
}
/**
 * 解析并验证挑战 cookie 值；MAC 无效/旧明文格式/格式非法/过期/时间戳异常 → undefined
 * （视为无挑战：密码路径 / 密码页）。MAC 恒时比较；等长才进入比较（base64url 固定 43
 * 字符，长度不等即非法，先返回避免 timingSafeEqual 抛错）。
 */
export function parseChallengeValue(value, nowMs, key) {
    if (value === undefined)
        return undefined;
    const lastDot = value.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === value.length - 1)
        return undefined;
    const prefix = value.slice(0, lastDot);
    const providedMac = value.slice(lastDot + 1);
    const computedMac = createHmac("sha256", key).update(prefix).digest("base64url");
    if (providedMac.length !== computedMac.length)
        return undefined;
    if (!timingSafeEqual(Buffer.from(providedMac), Buffer.from(computedMac)))
        return undefined;
    const dot = prefix.lastIndexOf(".");
    if (dot <= 0 || dot === prefix.length - 1)
        return undefined;
    const username = prefix.slice(0, dot);
    const expires = Number(prefix.slice(dot + 1));
    if (!Number.isInteger(expires) ||
        expires <= nowMs ||
        expires - nowMs > CHALLENGE_TTL_SECONDS * 1000) {
        return undefined;
    }
    return username;
}
//# sourceMappingURL=challenge-cookie.js.map