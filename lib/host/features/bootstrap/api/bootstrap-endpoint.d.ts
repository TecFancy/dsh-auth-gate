import type { HttpHandler } from "../../../shared/guard/index.js";
import { type SessionStore } from "../../../entities/session/index.js";
import type { ConfiguredProbe } from "../model/probe.js";
export interface BootstrapEndpointDeps {
    /** 未配置探针（每次请求现算）。 */
    probe: ConfiguredProbe;
    /** 当前进程的 launch token（与登录后桥读到的是同一枚）。 */
    readLaunchToken: () => string | undefined;
    sessions: () => SessionStore | undefined;
    cookieName: string;
    cookieSecure: boolean;
    sessionTtlSeconds: number;
    logger: {
        info(message: unknown): void;
        warn(message: unknown): void;
        error(message: unknown): void;
    };
}
/**
 * `GET /auth/bootstrap?token=<launchToken>`：校验 launch token、确认实例仍然未配置，
 * 然后签发一枚 `bootstrap` 会话并 302 到 `/auth/setup`。
 *
 * 这里是首次引导通道唯一的校验点：门只按请求形状重定向过来，不做校验也不做 IO。
 * 任何失败分支（形状不对、token 不对、已配置、探针 unknown、会话存储缺失、异常）都回到
 * `/auth/login?next=%2F` 且不下发 cookie，绝不放行未认证请求给 dsh。
 */
export declare function makeBootstrapEndpoint(deps: BootstrapEndpointDeps): HttpHandler;
//# sourceMappingURL=bootstrap-endpoint.d.ts.map