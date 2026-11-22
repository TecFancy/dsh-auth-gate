import z from "@deepseek-ai/schemastery";
import { CeremonyStore, PasskeyOptionsQuota, registerPasskeyEndpoints, resolvePasskeySettings, } from "./host/features/passkey/index.js";
import { hashPassword, issueLoginSession, verifyPassword } from "./host/features/password/index.js";
import { verifyTotpCode } from "./host/features/totp/index.js";
import { loadUsersFile, mutateUsersFile } from "./host/entities/user/index.js";
import { makeClientIpResolver, parseClientIpPolicy } from "./host/shared/http/index.js";
import { LoginRateLimiter } from "./host/shared/rate-limit/index.js";
/** 配置片段对应的 schema 节点（展开进 `src/index.ts` 的 `Config`）。 */
export const passkeyConfigFields = {
    passkey: z.union([z.const("off"), z.const("optional"), z.const("required")]).default("off"),
    passkeyRpName: z.string().default("DeepSeek Harness"),
    passkeyRpId: z.string().default(""),
    passkeyOrigins: z.array(z.string()).default([]),
    passkeyEnforceCounter: z.boolean().default(false),
    passkeyConditionalUi: z.boolean().default(false).volatile(),
};
/**
 * 解析并自检 passkey 配置：功能不成立时返回 `enabled: false` 并打 error 日志（fail-closed，
 * 实例照常启动）；`totp: "required"` 与 passkey 同开时打 info（passkey 满足 2FA，不降级）。
 *
 * `passkey: "required"` 且 WebAuthn 参数不成立时，error 日志额外说明「口令登录同样关闭」，
 * 因为这是运维最需要立刻看到的一句话：实例此刻谁都进不来。
 */
export function wirePasskey(config) {
    const settings = resolvePasskeySettings({
        passkey: config.passkey,
        publicHost: config.publicHost,
        passkeyRpName: config.passkeyRpName,
        passkeyRpId: config.passkeyRpId,
        passkeyOrigins: config.passkeyOrigins,
        passkeyEnforceCounter: config.passkeyEnforceCounter,
        passkeyConditionalUi: config.passkeyConditionalUi.get(),
        totp: config.totp,
    });
    const passwordLoginDisabled = settings.passwordLoginDisabled;
    if (config.mode !== "password") {
        if (config.passkey !== "off") {
            config.log.error("passkey is password-mode only; ignored in token mode");
        }
        // token 模式没有口令登录可言，`required` 在这里没有意义：不关闭任何东西。
        return { enabled: false, passwordLoginDisabled: false, settings, login: undefined };
    }
    if (!settings.enabled) {
        if (settings.reason !== "off") {
            config.log.error(`passkey disabled: ${settings.reason}`);
            if (passwordLoginDisabled) {
                config.log.error("passkey is required but unusable: password sign-in stays disabled, so nobody can sign in " +
                    'until the WebAuthn configuration is fixed or passkey is set back to "optional"');
            }
        }
        return { enabled: false, passwordLoginDisabled, settings, login: undefined };
    }
    if (settings.totpSatisfied) {
        config.log.info(`passkey enabled (rpId=${settings.rpId}); passkeys satisfy the TOTP two-factor policy`);
    }
    if (passwordLoginDisabled) {
        config.log.info("passkey is required: password sign-in is disabled for this instance");
    }
    return {
        enabled: true,
        passwordLoginDisabled,
        settings,
        login: { enabled: true, conditionalUi: settings.conditionalUi },
    };
}
/**
 * 注册 passkey 登录的两个端点（begin + finish）。`settings.enabled === false` 时什么都不注册，
 * 返回空 disposer：端点只在功能可用时存在，`/auth/passkey/*` 未启用时落到 `/auth` 的 404 兜底。
 *
 * 限速与口令登录**分开**：passkey 失败不会把口令登录的锁定桶打满，反之亦然。
 */
export function makePasskeyWiring(input) {
    if (!input.settings.enabled)
        return () => undefined;
    const ceremony = new CeremonyStore();
    const limiter = new LoginRateLimiter();
    const optionsQuota = new PasskeyOptionsQuota();
    const policy = parseClientIpPolicy(input.config.clientIpHeader, input.config.trustedProxyCidrs);
    const clientIp = makeClientIpResolver(policy, input.log);
    const settings = input.settings;
    return registerPasskeyEndpoints({
        register: (route) => input.server.register(route),
        sessions: () => input.auth.sessions,
        cookieSecure: input.config.cookieSecure,
        ceremony,
        optionsQuota,
        settings: {
            rpId: settings.rpId,
            rpName: settings.rpName,
            origins: settings.origins,
            enforceCounter: settings.enforceCounter,
        },
        publicHost: input.config.publicHost,
        loadUsers: () => loadUsersFile(input.usersPath),
        clientIp,
        limiter,
        issueSession: (res, store, username, next, user, extraSetCookie) => issueLoginSession({
            cookieName: input.config.cookieName,
            cookieSecure: input.config.cookieSecure,
            sessionTtl: input.config.sessionTtl,
            launchTokenBridge: input.launchTokenBridge,
            logger: input.log,
        }, res, store, username, next, user, extraSetCookie),
        logger: input.log,
        cookieName: input.config.cookieName,
        totpMode: input.config.totp,
        // passkey-only 下失败卡不渲染口令表单（那张卡上没有可用的退路），
        // 删除最后一把凭据也会被拒绝（口令已关，删光等于锁死）。
        passwordLoginDisabled: input.settings.passwordLoginDisabled,
        // 注册/管理/设置页（PR3）：再认证用口令 + TOTP，写盘走锁内 mutateUsersFile。
        management: {
            mutateUsers: (mutator) => mutateUsersFile(input.usersPath, mutator),
            verify: verifyPassword,
            hash: hashPassword,
            verifyTotp: (secretB32, code, nowMs) => verifyTotpCode(secretB32, code, nowMs),
            replayCheck: input.replayCheck,
            conditionalUi: input.conditionalUi,
            persistConditionalUi: input.persistConditionalUi,
        },
    });
}
