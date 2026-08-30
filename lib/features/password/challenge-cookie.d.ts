/** TOTP 挑战 cookie 名（M4 T5）。 */
export declare const CHALLENGE_COOKIE = "dsh_auth_challenge";
/** 挑战 cookie 有效期（秒，M4 T5 模块常量）。 */
export declare const CHALLENGE_TTL_SECONDS = 300;
/**
 * 挑战 cookie 值格式 `<username>.<expiresEpochMs>.<mac>`（D10：HMAC 签名）。
 * mac = HMAC-SHA256(key, `<username>.<expiresEpochMs>`) 的 base64url（43 字符，无 `.`，
 * 因此用户名的 `.` 不会与分隔符冲突，始终从右侧切）。密钥为进程级随机值
 * （apply() 与 limiter / replayGuard 同寿命）；重启/插件重载后在途挑战失效。
 */
export declare function buildChallengeValue(username: string, expiresEpochMs: number, key: Uint8Array): string;
/**
 * 解析并验证挑战 cookie 值；MAC 无效/旧明文格式/格式非法/过期/时间戳异常 → undefined
 * （视为无挑战：密码路径 / 密码页）。MAC 恒时比较；等长才进入比较（base64url 固定 43
 * 字符，长度不等即非法，先返回避免 timingSafeEqual 抛错）。
 */
export declare function parseChallengeValue(value: string | undefined, nowMs: number, key: Uint8Array): string | undefined;
//# sourceMappingURL=challenge-cookie.d.ts.map