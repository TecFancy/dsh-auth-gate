/**
 * passkey 认证面（M6）：ceremony 一次性存储、不透明 ceremony cookie、从既有扁平配置
 * 派生的 WebAuthn 参数（RP ID / origin 白名单 / 策略开关），以及 `dsh-auth passkey`
 * 运维子命令。model 段无 IO、无日志；端点与启动自检由 root 侧装配使用这里的公共 API。
 * 新增导出必须在此登记。
 */
export { CeremonyStore } from "./model/ceremony-store.js";
export type { CeremonyCreateOptions, CeremonyKind, CeremonyRecord, CeremonyStoreOptions, } from "./model/ceremony-store.js";
export { buildCeremonyCookie, CEREMONY_COOKIE, CEREMONY_TTL_SECONDS, clearCeremonyCookie, readCeremonyId, } from "./model/ceremony-cookie.js";
export { handlePasskeyCli, type PasskeyCliIo, type PasskeyFlags } from "./cli/cli.js";
export { resolvePasskeySettings } from "./model/passkey-config.js";
export type { PasskeyDisabledReason, PasskeySettings, PasskeySettingsInput, } from "./model/passkey-config.js";
export { registerPasskeyLoginEndpoints } from "./api/passkey-login-endpoints.js";
export type { PasskeyLoginDeps } from "./api/passkey-login-endpoints.js";
export { registerPasskeyEndpoints } from "./api/passkey-endpoints.js";
export type { PasskeyEndpointsDeps } from "./api/passkey-endpoints.js";
export type { PasskeyManagement, PasskeyManagementDeps, PasskeyManagementSettings, } from "./api/passkey-management-deps.js";
export { buildPasskeyRecord, canAddPasskey, matchCredentialPrefix, normalizePasskeyLabel, parseTransports, PASSKEY_ID_PREFIX_MIN_LENGTH, PASSKEY_LABEL_MAX_LENGTH, PASSKEY_SUPPORTED_ALGORITHMS, PASSKEY_SUMMARY_PREFIX_LENGTH, sortPasskeysByCreatedAt, toPasskeySummary, } from "./model/passkey-management.js";
export type { CredentialPrefixMatch, NewPasskeyInput, PasskeyAlgorithm, } from "./model/passkey-management.js";
export { PASSKEY_LOGIN_FAILED_MESSAGE, PASSKEY_LOGIN_LOCKED_MESSAGE, } from "./api/passkey-login-failures.js";
export { PasskeyCounterStore, findPasskeyCredential, readPasskeyAssertion, selectVerificationCounter, } from "./model/passkey-login.js";
export type { PasskeyAssertion, PasskeyCredentialMatch, PasskeyLoginSettings, } from "./model/passkey-login.js";
export { PasskeyOptionsQuota } from "./model/options-quota.js";
export type { PasskeyOptionsQuotaCheck, PasskeyOptionsQuotaOptions, } from "./model/options-quota.js";
//# sourceMappingURL=index.d.ts.map