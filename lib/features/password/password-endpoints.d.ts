import { LoginRateLimiter, type UsersSnapshot } from "../../shared/index.js";
import { type HttpHandler } from "../../gate/index.js";
import { type PasswordLoginDeps } from "./password-login.js";
import { type SessionStore } from "../../session/index.js";
/** 改密端点的接线（§5）：写盘 / 哈希 / 独立限速桶 / 防重放 / 撤销会话，由 index.ts 注入。 */
export interface PasswordChangeWiring {
    /** 写盘入口：`(m) => mutateUsersFile(usersPath, m)`（锁内 CAS，唯一变更通道）。 */
    mutateUsers: (mutator: (snapshot: UsersSnapshot) => void | Promise<void>) => Promise<void>;
    /** 新口令哈希：index.ts 注入 hashPassword。 */
    hash: (password: string) => Promise<string>;
    /** 独立限速桶：与登录 limiter 不同实例、不同桶（P1 §1 限速）。 */
    limiter: LoginRateLimiter;
    /** 防重放：必须是 index.ts 登录侧那个 replayGuard 单例（D22 反退化断言）。 */
    replayCheck: (username: string, counter: number, code: string) => boolean;
    /** 写盘成功后撤销该 subject 全部会话（内部 try/catch，不改 200 语义）。 */
    revoke: (subject: string) => Promise<void>;
}
/**
 * 装配改密接线（§5 + §1.1-4）：独立限速桶 + 锁内写盘 + 新口令哈希 + 撤销会话。
 * 放在本切片而不是 root：root 侧只保留「接线」语义，撤销的 try/catch 也留在这里，
 * 端点永不看到 revoke 异常，写盘成功后的 200 语义不受影响。
 * 只接收 root 才有的四样东西；TOTP 校验函数 / clientIp / now / totpMode 等仍经
 * `registerPasswordEndpoints` 的登录 deps 流入，本切片不 import totp 切片（features 禁止互引）。
 */
export declare function makePasswordChangeWiring(usersPath: string, auth: {
    sessions: SessionStore | undefined;
}, replayCheck: (username: string, counter: number, code: string) => boolean, log: {
    error(message: unknown): void;
    info(message: unknown): void;
}): PasswordChangeWiring;
export interface PasswordEndpointsDeps extends PasswordLoginDeps {
    /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: HttpHandler;
    }): () => void;
    /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
    logoutOrder: number;
    /**
     * 改密接线（§5）。缺省 → 不注册 `/auth/password`（加法式公共面：既有测试 harness
     * 的对象字面量不必改动）；index.ts 在 password 模式下**总是**注入，生产唯一路径
     * 不存在「静默不注册」的空间（反退化测试见 password-change.test.ts）。
     */
    passwordChange?: PasswordChangeWiring | undefined;
}
/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式，P16）+（接线存在时）
 * 第 4 个 exact `/auth/password`（P1，§1 路由模型：1 prefix + 4 exact）。
 * 返回合并 disposer。路由模型同 M15：webserver 无 method 路由，exact handler 内部按
 * `req.method` 分发。
 */
export declare function registerPasswordEndpoints(deps: PasswordEndpointsDeps): () => void;
//# sourceMappingURL=password-endpoints.d.ts.map