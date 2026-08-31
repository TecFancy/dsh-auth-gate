import type { ServerResponse } from "node:http";
import { type SessionStore } from "../../session/index.js";
/** issueSession 所需 deps 子集（结构化类型；PasswordEndpointsDeps 天然兼容）。 */
export interface IssueSessionDeps {
    cookieName: string;
    cookieSecure: boolean;
    sessionTtl: number;
    /** 可选：dsh launch-token 桥（0.1.2-alpha+）。返回相对 `/?token=` 或 undefined。 */
    launchTokenBridge?: () => Promise<string | undefined>;
    logger: {
        warn(message: unknown): void;
        info(message: unknown): void;
    };
}
/** 发会话（P14）：subject=username，每次登录新会话；成功 → 302 + set-cookie。
 * 桥命中 → 302 到相对 `/?token=`（浏览器自动 mint dsh cookie；相对地址沿用当前
 * origin，不依赖请求 Host）；桥失败/未配置 → 保持原 302(next)，绝不阻塞登录成功。 */
export declare function issueSession(deps: IssueSessionDeps, res: ServerResponse, store: SessionStore, username: string, next: string, extraSetCookie?: string[]): Promise<void>;
//# sourceMappingURL=session-issue.d.ts.map