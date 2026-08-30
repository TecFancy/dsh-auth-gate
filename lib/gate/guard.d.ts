import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Gate, GuardKind } from "./gate.js";
/** 挂在被包装 handler/方法上的守卫标记（幂等重包装 + 自检共用）。 */
export declare const GUARDED: unique symbol;
/** 登录页路径（拒绝时 302 的目标）。 */
export declare const LOGIN_PATH = "/auth/login";
/** auth 公共路径前缀（两种 gate 的白名单：登录/登出/状态端点免守卫）。 */
export declare const AUTH_PATH_PREFIX = "/auth";
/** 认证本地代理（`dsh-auth-proxy --mark-proxy`）附加的请求标记头。 */
export declare const PROXY_MARKER_HEADER = "x-dsh-proxy";
/** 是否命中"代理标记 + 禁行方法"：`/api/<method>` 路径上带 `X-Dsh-Proxy: 1`。 */
export declare function isProxyDeniedRequest(req: IncomingMessage, pathname: string): boolean;
export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
export interface WrappableRoute {
    kind: "exact" | "prefix";
    path: string;
    handler: HttpHandler;
}
export interface WrappableUpgradeRoute {
    path: string;
    handler: UpgradeHandler;
}
/** webServer 运行时形状的结构镜像（impl-m1.md §2.1）；真实实例运行时满足它。 */
export interface WrappableServer {
    exact: Map<string, WrappableRoute>;
    prefixes: Map<string, WrappableRoute>;
    upgrades: Map<string, WrappableUpgradeRoute>;
    fallback: HttpHandler | undefined;
    register(route: WrappableRoute): () => void;
    registerUpgrade(route: WrappableUpgradeRoute): () => void;
    registerFallback(handler: HttpHandler): () => void;
}
/** 守卫日志的最小表面（自检/诊断用）。 */
export interface GuardLog {
    error(message: unknown): void;
}
export declare function isGuarded(target: (...args: never[]) => unknown): boolean;
/**
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫写
 * 302/401，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
 */
export declare function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler): HttpHandler;
/**
 * 给一个 upgrade handler 套守卫。deny 在 ws 协商前直接拒握手，不进入
 * 原 handler，也不为 socket 附加任何监听器。
 */
export declare function guardUpgrade(gate: () => Gate, handler: UpgradeHandler): UpgradeHandler;
/**
 * 拒绝一个 HTTP 请求：浏览器导航（GET 且 Accept 含 text/html）→ 302 登录页
 * （带 next 回跳）；其余 → 401。两者都禁缓存。
 */
export declare function denyHttp(req: IncomingMessage, res: ServerResponse): void;
/** 拒绝一个 WS 升级：写 401 响应行后销毁 socket，不进入 ws 协商。 */
export declare function denyUpgrade(socket: Duplex): void;
/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export declare function denyForbidden(res: ServerResponse): void;
/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。幂等：同一 server 第二次调用返回同一
 * unwrap。返回的 unwrap 整体回滚（快照 + 原方法）。
 */
export declare function wrapServer(server: WrappableServer, gate: () => Gate, log: GuardLog): () => void;
//# sourceMappingURL=guard.d.ts.map