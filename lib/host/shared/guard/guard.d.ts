import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { AdmitHook, Gate, GateDeny, GuardKind, GuardRequest } from "./gate.js";
import { type AdmitRebridge } from "./rebridge.js";
import { type ResourceHandler } from "./resource.js";
export { GUARDED, isGuarded } from "./mark.js";
export { isNavigationRequest, isProxyDeniedRequest, isPublicStaticPath, isSafeLocation, PROXY_MARKER_HEADER, PUBLIC_STATIC_PATHS, } from "./http.js";
export type { GuardReply } from "./http.js";
export type { GuardRequest } from "./gate.js";
export type { ResourceHandler } from "./resource.js";
export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
/** handler 形态的 HTTP 路由（DSH 0.2.0/0.2.1 与 0.2.2 都支持）。 */
export interface WrappableHttpRoute {
    kind: "exact" | "prefix";
    path: string;
    handler: HttpHandler;
    resource?: never;
}
/** Fetch resource 形态的 HTTP 路由（DSH 0.2.2 起 `webServer.register` 接受）。 */
export interface WrappableResourceRoute {
    kind: "exact" | "prefix";
    path: string;
    resource: ResourceHandler;
    handler?: never;
}
export type WrappableRoute = WrappableHttpRoute | WrappableResourceRoute;
/** fallback 座位：旧宿主是函数，0.2.2 起官方 SPA 兜底用 `{ resource }` 对象。 */
export type WrappableFallback = HttpHandler | {
    resource: ResourceHandler;
};
export interface WrappableUpgradeRoute {
    path: string;
    handler: UpgradeHandler;
}
/** webServer 运行时形状的结构镜像（impl-m1.md §2.1）；真实实例运行时满足它。 */
export interface WrappableServer {
    exact: Map<string, WrappableRoute>;
    prefixes: Map<string, WrappableRoute>;
    upgrades: Map<string, WrappableUpgradeRoute>;
    fallback: WrappableFallback | undefined;
    register(route: WrappableRoute): () => void;
    registerUpgrade(route: WrappableUpgradeRoute): () => void;
    registerFallback(fallback: WrappableFallback): () => void;
}
/** 守卫日志的最小表面（自检/诊断用）。 */
export interface GuardLog {
    error(message: unknown): void;
}
/**
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫按 gate 给出的
 * 决策写 302/401/403，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
 * allow 但属跨站顶层文档导航时不进原 handler，改回同源弹回页（见 `serveCrossSiteBounce`）。
 *
 * `onAdmit` 在 `decide()` 返回 allow 之后、守卫自己的传输层否决（代理标记、跨站弹回）之前
 * 调用：它回答的是「门放行了这次请求」，与守卫随后怎么分流无关（见 {@link AdmitHook}）。
 *
 * `rebridge` 在 `onAdmit` 之后询问：它回答「这次放行的请求要不要先重铸宿主 cookie」。给出
 * 站内 Location 时守卫 302 到它、不调用原 handler（见 {@link AdmitRebridge}）。
 *
 * 顺序有讲究：**跨站弹回排在重铸之前**。两者修的是不同的病：弹回修「Strict cookie 存在但
 * 跨站导航不带它」，重铸修「cookie 名字对不上或已过期」。跨站导航里宿主必然回 401，若先重铸，
 * 新签发的 Strict cookie 在整条跨站重定向链上照样不会被发送，反而把弹回本来能修好的场景变成
 * 401（issue #69 记录的 `ERR_TOO_MANY_REDIRECTS` 就是这条链）。弹回后是同源重试，那时才轮到
 * 重铸判断宿主到底认不认。
 */
export declare function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler, onAdmit?: AdmitHook, rebridgeHook?: AdmitRebridge): HttpHandler;
/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
 * `onAdmit` 与其他入口同义：门放行之后调用一次。
 */
export declare function guardUpgrade(gate: () => Gate, handler: UpgradeHandler, onAdmit?: AdmitHook): UpgradeHandler;
/**
 * 拒绝一个 HTTP 请求并把决策写进 node:http 响应。拒绝语义见 `denyReply`：
 * 302 跳转一律 no-store 且带 no-referrer，401/403 一律纯文本 no-store。
 */
export declare function denyHttp(req: GuardRequest, res: ServerResponse, decision?: GateDeny): void;
/** 拒绝一个 WS 升级：写 401 响应行后销毁 socket，不进入 ws 协商。 */
export declare function denyUpgrade(socket: Duplex): void;
/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export declare function denyForbidden(res: ServerResponse): void;
/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。handler 与 0.2.2 的 resource 两种路由
 * 都进入同一套守卫；幂等：同一 server 第二次调用返回同一 unwrap。
 *
 * 返回的 unwrap 逐条回滚，不整表还原：只把目标函数仍是本次 wrap 产出的守卫版本的
 * 条目换回原路由（D27：wrap 之后注册的路由保留在表中、只摘掉守卫；wrap 期间被
 * 拥有者卸载的条目不写回；被第三方换成别的函数的条目不碰）。最后还原三个注册方法。
 *
 * `rebridge` 透传给每个 HTTP 入口（handler 与 resource 两种形态、存量与晚注册、fallback），
 * 语义见 {@link AdmitRebridge}；upgrade 入口不接它，握手没法用重定向修复。
 */
export declare function wrapServer(server: WrappableServer, gate: () => Gate, log: GuardLog, onAdmit?: AdmitHook, rebridge?: AdmitRebridge): () => void;
//# sourceMappingURL=guard.d.ts.map