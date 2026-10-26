import type { HttpHandler } from "../../../shared/guard/index.js";
import { type LaunchTokenBridge } from "../../../shared/http/index.js";
import { type SessionStore } from "../../../entities/session/index.js";
export interface ContinueEndpointDeps {
    sessions: () => SessionStore | undefined;
    cookieName: string;
    /** dsh 的 launch token 桥；不可用时回落到 `/`，让 dsh 自己决定怎么认人。 */
    bridge: LaunchTokenBridge | undefined;
    logger: {
        warn?(message: unknown): void;
    };
}
/**
 * `GET /auth/continue`：向导完成后的最后一跳，302 到 dsh 的 `/?token=<launchToken>`，
 * 由 dsh 自己 mint 浏览器 cookie。
 *
 * 只认 cookie 里的**正式**会话：没有会话、会话失效、或拿的是 bootstrap 会话，一律回登录页
 * （且不回显 query），不靠「跳到 `/` 再被门弹回向导」兜底。它不认 query，也**不签发**任何
 * 会话，所以不会和数据面形成循环。桥缺失 / 抛错 → 回落到 `/`。
 */
export declare function makeContinueEndpoint(deps: ContinueEndpointDeps): HttpHandler;
//# sourceMappingURL=continue-endpoint.d.ts.map