import type { ServerResponse } from "node:http";
import type { HttpHandler } from "../../../shared/guard/index.js";
import type { SessionStore } from "../../../entities/session/index.js";
import type { ConfiguredProbe } from "../model/probe.js";
/** token 模式的写入结果：`saved-unreadable` = 写盘成功但当前进程读不回新值。 */
export interface SetupTokenOutcome {
    status: "saved" | "saved-unreadable" | "failed";
    /** 只在 saved / saved-unreadable 时给页面渲染一次。 */
    token?: string | undefined;
}
export interface SetupEndpointDeps {
    mode: "token" | "password";
    /** 未配置探针：每次渲染/提交前复查，配置一旦成立就拒绝继续写盘。 */
    probe: ConfiguredProbe;
    sessions: () => SessionStore | undefined;
    cookieName: string;
    cookieSecure: boolean;
    sessionTtlSeconds: number;
    publicHost: string;
    tokenRef: string;
    usersPath: string;
    /** token 模式：服务端自己生成并保存访问令牌（没有 body 参数）。 */
    saveToken: () => Promise<SetupTokenOutcome>;
    /** password 模式：建第一个管理员；策略由实现方判定。 */
    createAdmin: (username: string, password: string) => Promise<"ok" | "conflict" | "invalid" | "failed">;
    /** 向导完成的正式会话（写 Set-Cookie）：token 模式 subject=token，password 模式=用户名。 */
    issueFullSession: (subject: string, res: ServerResponse) => Promise<void>;
    logger: {
        info(message: unknown): void;
        warn(message: unknown): void;
        error(message: unknown): void;
    };
}
export interface SetupHandlers {
    get: HttpHandler;
    post: HttpHandler;
}
/**
 * 首次配置向导的两个方法（`/auth/setup`：GET 渲染、POST 提交；webserver 的 exact 表按
 * pathname 建键，GET/POST 不能注册成两条路由）。
 *
 * 三条硬约束：只有有效的 `bootstrap` 会话能进（正式会话看到「已配置」页，无会话回登录页）；
 * **每次 GET/POST 都复查未配置探针**：bootstrap 会话能跨重启活最多 1 小时，期间运维可能已经
 * 用 CLI 补好凭据，配置一旦成立就不能再从这张旧会话写盘；POST 还必须过同源校验，与既有写路径
 * 同一条纪律。向导完成后先吊销全部 bootstrap 会话，再给当前响应签发正式会话。
 */
export declare function makeSetupHandlers(deps: SetupEndpointDeps): SetupHandlers;
//# sourceMappingURL=setup-endpoint.d.ts.map