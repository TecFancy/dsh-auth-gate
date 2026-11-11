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
//# sourceMappingURL=index.d.ts.map