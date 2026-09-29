import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Gate, GateDeny, GuardKind } from "./gate.js";
/** 挂在被包装 handler/方法上的守卫标记（幂等重包装 + 自检共用）。 */
export declare const GUARDED: unique symbol;
/** 登录页路径：`"deny"` 字符串分支（既有 token 门）的默认 302 目标。 */
export declare const LOGIN_PATH = "/auth/login";
/**
 * 浏览器导航判定（P2 §3）：只认 `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`。
 * **禁止**用 `Accept` 子串匹配（面板 fetch 的 Accept 很杂，会假绿）；两个头都缺 →
 * false（fail-closed：按 API 处理，401 而不是放行）。
 */
export declare function isNavigationRequest(req: IncomingMessage): boolean;
/**
 * Location 消毒（§6）：只允许站内相对路径（`/` 开头、非 `//`、无反斜杠、无控制符）。
 * 判定与登录 `next` 共用 `shared` 的 `isSafeRelativeTarget`：同一条 302 出口纪律，
 * 控制符会让浏览器把 `"/\t/evil.com"` 解析成协议相对的站外地址（见该文件注释）。
 */
export declare function isSafeLocation(location: string): boolean;
/** auth 公共路径前缀（两种 gate 的白名单：登录/登出/状态端点免守卫）。 */
export declare const AUTH_PATH_PREFIX = "/auth";
/**
 * 免守卫的公开只读静态路径（精确匹配）。浏览器抓取 Web App Manifest 时按规范
 * 不带凭证（Chromium `manifest_fetcher.cc`：只有 link 带 `crossorigin="use-credentials"`
 * 才是 `kInclude`，否则 `kOmit`），cookie/Bearer 门永远认不出这次请求，登录用户
 * 也会恒 401。manifest 只含应用名/图标/显示模式等公开元数据，不含工作区信息，
 * 故列入白名单（语义与 `/auth` 同一类：不认证也必须可达）。
 */
export declare const PUBLIC_STATIC_PATHS: readonly string[];
/**
 * 是否命中公开只读静态路径。`kind === "upgrade"` 一律不算：这些路径只有 HTTP
 * GET 语义，放行握手只会白扩攻击面（升级请求仍走完整认证）。
 */
export declare function isPublicStaticPath(kind: GuardKind, pathname: string): boolean;
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
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫按 gate 给出的
 * 决策写 302/401/403，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
 */
export declare function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler): HttpHandler;
/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
 */
export declare function guardUpgrade(gate: () => Gate, handler: UpgradeHandler): UpgradeHandler;
/**
 * 拒绝一个 HTTP 请求，按 gate 决策渲染（P2；`decision` 缺省 = 字符串 `"deny"`）：
 * - `{deny:{redirect}}` → 302 gate 给出的目标（消毒失败则退回 LOGIN_PATH）；
 * - `{deny:{status}}` → 该 401/403；
 * - `{deny:{upgrade:true}}` → 401 兜底（正常不会落到 HTTP 面）；
 * - `"deny"`（旧门）→ 浏览器导航 302 登录页 + `next`，其余 401。
 * 一律 `cache-control: no-store`。
 */
export declare function denyHttp(req: IncomingMessage, res: ServerResponse, decision?: GateDeny): void;
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