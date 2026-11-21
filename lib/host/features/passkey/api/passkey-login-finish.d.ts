/**
 * passkey 登录 finish 端点：受理（限速占位）→ 存储检查 → **先删后验**地消费 ceremony →
 * 字段校验 → 凭据查找（未命中做等量工作）→ 验签 + 策略 → 注入 `issueSession` 签发 302。
 * 401 恒为同一张卡片与常量文案；原因码只进日志。受限/正式会话由注入实现决定。
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
    /**
     * 口令登录是否被策略关闭（`passkey: "required"`）：只影响失败卡的形状与文案 - passkey-only
     * 下那张卡上没有口令表单，也不能再写「改用密码」。
     */
    readonly passwordLoginDisabled?: boolean | undefined;
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
