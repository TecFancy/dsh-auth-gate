/**
 * passkey 登录 finish 端点（隐藏表单 POST）的实现：限速 → 会话存储检查 → **先删后验**地
 * 消费 ceremony → 字段校验 → 全局凭据查找（未命中做等量工作）→ 库验签 + 业务策略 →
 * 注入 `issueSession` 签发 302。
 *
 * 401 恒为同一张登录卡片 + 同一常量文案；原因码只进日志，绝不回显断言内容。会话的
 * 受限/正式分支由注入的 `issueSession` 决定，这里不重复实现。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../../../entities/user/index.js";
import type { LoginRateLimiter } from "../../../shared/rate-limit/index.js";
import type { CeremonyStore } from "../model/ceremony-store.js";
import { PasskeyCounterStore, type PasskeyLoginSettings } from "../model/passkey-login.js";
/** finish 端点需要的依赖子集（`PasskeyLoginDeps` 在此基础上只多一个 `register`）。 */
export interface PasskeyLoginFinishDeps {
    readonly sessions: () => SessionStore | undefined;
    readonly cookieSecure: boolean;
    readonly ceremony: CeremonyStore;
    readonly settings: PasskeyLoginSettings;
    readonly publicHost: string;
    readonly loadUsers: () => Promise<UsersLoadResult>;
    readonly clientIp: (req: IncomingMessage) => string;
    readonly limiter: LoginRateLimiter;
    readonly issueSession: (res: ServerResponse, store: SessionStore, username: string, next: string, user: UserRecord, extraSetCookie: string[]) => Promise<void>;
    readonly logger: {
        error(message: unknown): void;
        warn(message: unknown): void;
        info(message: unknown): void;
    };
}
/**
 * finish 主流程：405 → 415/413 → 429（先于 ceremony）→ 503（先于 consume）→ 消费 ceremony
 * → 断言字段校验 → 用户文件 → 校验 → 签发。所有响应写完才返回。
 */
export declare function handlePasskeyLogin(deps: PasskeyLoginFinishDeps, counters: PasskeyCounterStore, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=passkey-login-finish.d.ts.map