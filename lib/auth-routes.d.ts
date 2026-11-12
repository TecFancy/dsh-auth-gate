import type { Context } from "@deepseek-ai/cordis";
import { type wirePasskey } from "./passkey-wiring.js";
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
export declare function mountAuthRoutes(ctx: Context, input: AuthRouteWiring): void;
//# sourceMappingURL=auth-routes.d.ts.map