import z from "@deepseek-ai/schemastery";
import { resolvePasskeySettings } from "./host/features/passkey/index.js";
/** 配置片段对应的 schema 节点（展开进 `src/index.ts` 的 `Config`）。 */
export const passkeyConfigFields = {
    passkey: z.union([z.const("off"), z.const("optional")]).default("off"),
    passkeyRpName: z.string().default("DeepSeek Harness"),
    passkeyRpId: z.string().default(""),
    passkeyOrigins: z.array(z.string()).default([]),
    passkeyEnforceCounter: z.boolean().default(false),
    passkeyConditionalUi: z.boolean().default(false),
};
/**
 * 解析并自检 passkey 配置：功能不成立时返回 `enabled: false` 并打 error 日志（fail-closed，
 * 实例照常启动）；`totp: "required"` 与 passkey 同开时打 info（passkey 满足 2FA，不降级）。
 */
export function wirePasskey(config) {
    const settings = resolvePasskeySettings({
        passkey: config.passkey,
        publicHost: config.publicHost,
        passkeyRpName: config.passkeyRpName,
        passkeyRpId: config.passkeyRpId,
        passkeyOrigins: config.passkeyOrigins,
        passkeyEnforceCounter: config.passkeyEnforceCounter,
        passkeyConditionalUi: config.passkeyConditionalUi,
        totp: config.totp,
    });
    if (config.mode !== "password") {
        if (config.passkey !== "off") {
            config.log.error("passkey is password-mode only; ignored in token mode");
        }
        return { enabled: false, settings };
    }
    if (!settings.enabled) {
        if (settings.reason !== "off") {
            config.log.error(`passkey disabled: ${settings.reason}`);
        }
        return { enabled: false, settings };
    }
    if (settings.totpSatisfied) {
        config.log.info(`passkey enabled (rpId=${settings.rpId}); passkeys satisfy the TOTP two-factor policy`);
    }
    return { enabled: true, settings };
}
//# sourceMappingURL=passkey-wiring.js.map