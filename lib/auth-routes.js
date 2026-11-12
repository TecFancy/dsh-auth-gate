import { makeEndpointsWiring } from "./endpoints-wiring.js";
import { makePasskeyWiring } from "./passkey-wiring.js";
/** 挂载 passkey 与口令/token 两组端点（各自 `ctx.effect`，随 fiber 释放）。 */
export function mountAuthRoutes(ctx, input) {
    const { server, config, auth, usersPath, launchTokenBridge, passkey, log } = input;
    mountPasskeyRoutes(ctx, input);
    ctx.effect(() => makeEndpointsWiring({
        server,
        config,
        auth,
        resolveToken: input.resolveToken,
        launchTokenBridge,
        usersPath,
        limiter: input.limiter,
        replayGuard: input.replayGuard,
        challengeMacKey: input.challengeMacKey,
        passkeyEnabled: passkey.enabled,
        passkeyLogin: passkey.login === undefined
            ? undefined
            : { enabled: true, conditionalUi: input.conditionalUi() },
        log,
    }), "dsh-auth-gate: auth endpoints");
}
/**
 * passkey 路由（登录 begin/finish + 注册/管理/设置）：只在配置自检通过时注册；未启用时
 * `/auth/passkey/*` 落到 `/auth` 前缀的 404 兜底。限速桶与口令登录分开。
 */
function mountPasskeyRoutes(ctx, input) {
    const { server, config, auth, usersPath, launchTokenBridge, passkey, log } = input;
    ctx.effect(() => makePasskeyWiring({
        server,
        config,
        auth,
        launchTokenBridge,
        usersPath,
        settings: passkey.settings,
        conditionalUi: input.conditionalUi,
        persistConditionalUi: async (enabled) => {
            input.setConditionalUi(enabled);
            await persistPasskeyConditionalUi(ctx, enabled, log);
        },
        replayCheck: (username, counter, code) => input.replayGuard.checkAndRecord(username, counter, code),
        log,
    }), "dsh-auth-gate: passkey routes");
}
/**
 * 把条件 UI 开关写回宿主 settings 服务（`passkeyConditionalUi` 是 volatile 字段，与遥测的
 * `installId` 同一条通道）。宿主没有 settings 服务时只保留内存值并记 error：开关在本次进程内
 * 生效，重启回到配置文件的值，绝不私自写私有文件。
 */
async function persistPasskeyConditionalUi(ctx, enabled, log) {
    const settings = ctx.get("settings");
    if (typeof settings !== "object" || settings === null || typeof settings.update !== "function") {
        log.error("passkey conditional UI changed in memory only: settings service unavailable");
        return;
    }
    try {
        await settings.update("dsh-auth-gate", { passkeyConditionalUi: enabled });
    }
    catch (error) {
        log.error(`passkey conditional UI not persisted: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=auth-routes.js.map