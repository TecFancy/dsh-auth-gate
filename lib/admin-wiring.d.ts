import type { IncomingMessage } from "node:http";
import { type AdminRoutes } from "./features/admin/index.js";
import { LoginRateLimiter } from "./shared/index.js";
import type { SessionStore } from "./session/index.js";
/**
 * P2 管理面的 root 侧装配（从 `src/index.ts` 拆出，守住 250 行文件上限）：
 * 新独立限流桶 + 锁内写盘 + 吊销探针 + 双桶清理，全部在这里注入 `features/admin`。
 *
 * 三条口径：
 * - **现读**：权限判定与目标判定都走 `loadUsersFile`（每请求现读，绝不信会话缓存）；
 * - **单例**：`replayCheck` 必须是登录侧那个 `TotpReplayGuard` 单例（同码不能在两处各用一次）；
 * - **限流桶互相独立**：登录桶/自助改密桶/管理桶三者互不影响，管理成功只清目标的登录桶
 *   与自助改密桶（`clearAccount` **不动 IP 桶**，清 IP 桶等于给攻击者发豁免）。
 */
export interface AdminWiringInput {
    readonly sessions: () => SessionStore | undefined;
    readonly cookieName: string;
    readonly usersPath: string;
    readonly publicHost: string;
    readonly clientIp: (req: IncomingMessage) => string;
    /** 登录限速器（清目标账号桶用）。 */
    readonly limiter: LoginRateLimiter;
    /** P1 自助改密限速器（清目标账号桶用）。 */
    readonly passwordChangeLimiter: LoginRateLimiter;
    readonly replayCheck: (username: string, counter: number, code: string) => boolean;
    readonly log: {
        info(message: unknown): void;
        error(message: unknown): void;
    };
}
export declare function makeAdminWiring(input: AdminWiringInput): AdminRoutes;
//# sourceMappingURL=admin-wiring.d.ts.map