/**
 * password 认证面（M3 用户口令门）。
 * 2026-09-13：由 `export *` 改为显式清单；挑战 cookie 的 API 直接由本 barrel 导出
 * （原先靠 `password-login.ts` 转口，转口已删）；新增导出必须在此登记。
 */
export { DUMMY_HASH, hashPassword, SCRYPT_KEYLEN, SCRYPT_MAXMEM, SCRYPT_N, SCRYPT_P, SCRYPT_R, verifyPassword, } from "./lib/password.js";
export { DEFAULT_REVOKE_SWEEP_MS, DisabledSessionSweeper } from "./model/disabled-sweeper.js";
export type { DisabledSweeperOptions } from "./model/disabled-sweeper.js";
export { makePasswordChangeWiring, registerPasswordEndpoints } from "./api/password-endpoints.js";
export type { PasswordChangeWiring, PasswordEndpointsDeps } from "./api/password-endpoints.js";
export { PasswordGate } from "./model/password-gate.js";
export type { PasswordGateOptions } from "./model/password-gate.js";
export { handlePasswordLogin } from "./model/password-login.js";
export type { PasswordLoginDeps } from "./model/password-login.js";
export { buildChallengeValue, CHALLENGE_COOKIE, CHALLENGE_TTL_SECONDS, parseChallengeValue, } from "./model/challenge-cookie.js";
export { PASSWORD_CHANGED_NOTICE, PASSWORD_CHANGED_TEXT, resolveLoginNotice, } from "./model/login-notice.js";
//# sourceMappingURL=index.d.ts.map