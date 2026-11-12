import type { Context } from "@deepseek-ai/cordis";
import { makeEndpointsWiring } from "./endpoints-wiring.js";
import { makePasskeyWiring, type wirePasskey } from "./passkey-wiring.js";
import type { AuthConfig, AuthService } from "./index.js";
import type { TotpReplayGuard } from "./host/features/totp/index.js";
import type { WrappableServer } from "./host/shared/guard/index.js";
import type { LoginRateLimiter } from "./host/shared/rate-limit/index.js";

/**
 * `/auth` 路由的 root 侧挂载（从 `src/index.ts` 拆出，守住 250 行文件与 80 行函数上限）：
 * passkey（登录 + 注册/管理/设置）与口令/token 端点。两者共用同一个 `replayGuard` 单例（D22）
 * 与同一个条件 UI 运行期值。
 */

/** `mountAuthRoutes` 的输入。 */
export interface AuthRouteWiring {
  readonly server: WrappableServer;
  readonly config: AuthConfig;
  readonly auth: AuthService;
  readonly usersPath: string;
  readonly launchTokenBridge: () => Promise<string | undefined>;
  readonly passkey: ReturnType<typeof wirePasskey>;
  readonly resolveToken: (() => Promise<string | undefined>) | undefined;
  readonly limiter: LoginRateLimiter;
  readonly replayGuard: TotpReplayGuard;
  readonly challengeMacKey: Uint8Array;
  readonly conditionalUi: () => boolean;
  readonly setConditionalUi: (enabled: boolean) => void;
  readonly log: {
    error(message: unknown): void;
    warn(message: unknown): void;
    info(message: unknown): void;
  };
}

/** 挂载 passkey 与口令/token 两组端点（各自 `ctx.effect`，随 fiber 释放）。 */
export function mountAuthRoutes(ctx: Context, input: AuthRouteWiring): void {
  const { server, config, auth, usersPath, launchTokenBridge, passkey, log } = input;
  mountPasskeyRoutes(ctx, input);
  ctx.effect(
    () =>
      makeEndpointsWiring({
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
        passkeyLogin:
          passkey.login === undefined
            ? undefined
            : { enabled: true, conditionalUi: input.conditionalUi() },
        log,
      }),
    "dsh-auth-gate: auth endpoints",
  );
}

/**
 * passkey 路由（登录 begin/finish + 注册/管理/设置）：只在配置自检通过时注册；未启用时
 * `/auth/passkey/*` 落到 `/auth` 前缀的 404 兜底。限速桶与口令登录分开。
 */
function mountPasskeyRoutes(ctx: Context, input: AuthRouteWiring): void {
  const { server, config, auth, usersPath, launchTokenBridge, passkey, log } = input;
  ctx.effect(
    () =>
      makePasskeyWiring({
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
        replayCheck: (username, counter, code) =>
          input.replayGuard.checkAndRecord(username, counter, code),
        log,
      }),
    "dsh-auth-gate: passkey routes",
  );
}

/**
 * 把条件 UI 开关写回宿主 settings 服务（`passkeyConditionalUi` 是 volatile 字段，与遥测的
 * `installId` 同一条通道）。宿主没有 settings 服务时只保留内存值并记 error：开关在本次进程内
 * 生效，重启回到配置文件的值，绝不私自写私有文件。
 */
async function persistPasskeyConditionalUi(
  ctx: Context,
  enabled: boolean,
  log: { error(message: unknown): void },
): Promise<void> {
  const settings = ctx.get("settings") as unknown as
    { update(namespace: string, patch: object): Promise<void> } | undefined;
  if (typeof settings !== "object" || settings === null || typeof settings.update !== "function") {
    log.error("passkey conditional UI changed in memory only: settings service unavailable");
    return;
  }
  try {
    await settings.update("dsh-auth-gate", { passkeyConditionalUi: enabled });
  } catch (error) {
    log.error(
      `passkey conditional UI not persisted: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
