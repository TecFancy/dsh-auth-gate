/**
 * password 认证面（M3 用户口令门）。
 * 2026-09-13：由 `export *` 改为显式清单；挑战 cookie 的 API 直接由本 barrel 导出
 * （原先靠 `password-login.ts` 转口，转口已删）；新增导出必须在此登记。
 */
export { DUMMY_HASH, hashPassword, SCRYPT_KEYLEN, SCRYPT_MAXMEM, SCRYPT_N, SCRYPT_P, SCRYPT_R, verifyPassword, } from "./password.js";
export { DEFAULT_REVOKE_SWEEP_MS, DisabledSessionSweeper } from "./disabled-sweeper.js";
export { makePasswordChangeWiring, registerPasswordEndpoints } from "./password-endpoints.js";
export { PasswordGate } from "./password-gate.js";
export { handlePasswordLogin } from "./password-login.js";
export { buildChallengeValue, CHALLENGE_COOKIE, CHALLENGE_TTL_SECONDS, parseChallengeValue, } from "./challenge-cookie.js";
//# sourceMappingURL=index.js.map