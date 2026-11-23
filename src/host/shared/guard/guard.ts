import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { AdmitHook, Gate, GateDeny, GuardRequest } from "./gate.js";
import { denyReply, forbiddenReply, writeGuardReply } from "./http.js";
import type { FallbackAuthAdapter, HostAuthRule } from "./host-auth.js";
import { GUARDED } from "./mark.js";
import type { AdmitRebridge } from "./rebridge.js";
import {
  rollbackFallback,
  rollbackRegisterMethods,
  rollbackRoutes,
  rollbackUpgrades,
} from "./rollback.js";
import type { ResourceHandler } from "./resource.js";
import { makeEntryWrappers } from "./wrap-routes.js";

export { GUARDED, isGuarded } from "./mark.js";
export { denyUpgrade, guardHttp, guardUpgrade } from "./wrap-routes.js";
export {
  isNavigationRequest,
  isProxyDeniedRequest,
  isPublicStaticPath,
  isSafeLocation,
  PROXY_MARKER_HEADER,
  PUBLIC_STATIC_PATHS,
} from "./http.js";
export type { GuardReply } from "./http.js";
export type { GuardRequest } from "./gate.js";
export type { ResourceHandler } from "./resource.js";
export type {
  FallbackAuthAdapter,
  HostAuthPolicy,
  HostAuthRequest,
  HostAuthRule,
} from "./host-auth.js";

export type HttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  peer?: unknown,
) => void | Promise<void>;

export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  peer?: unknown,
) => void | Promise<void>;

/** handler 形态的 HTTP 路由（DSH 0.2.0/0.2.1 与 0.2.2 都支持）。 */
export interface WrappableHttpRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
  resource?: never;
  /** 宿主路由鉴权（0.2.3-alpha.2 起；旧宿主忽略）。 */
  auth?: HostAuthRule;
}

/** Fetch resource 形态的 HTTP 路由（DSH 0.2.2 起 `webServer.register` 接受）。 */
export interface WrappableResourceRoute {
  kind: "exact" | "prefix";
  path: string;
  resource: ResourceHandler;
  handler?: never;
  /** 宿主路由鉴权（0.2.3-alpha.2 起；旧宿主忽略）。 */
  auth?: HostAuthRule;
}

export type WrappableRoute = WrappableHttpRoute | WrappableResourceRoute;

/**
 * fallback 座位：旧宿主是函数；0.2.2 起官方 SPA 兜底用 `{ resource }` 对象；0.2.3-alpha.2
 * 起同一对象可带 `handler` 形态与 `auth`。守卫对三种形态都套门。
 */
export type WrappableFallback =
  | HttpHandler
  | { handler: HttpHandler; resource?: never; auth?: HostAuthRule }
  | { resource: ResourceHandler; handler?: never; auth?: HostAuthRule };

export interface WrappableUpgradeRoute {
  path: string;
  handler: UpgradeHandler;
  /** 宿主路由鉴权（0.2.3-alpha.2 起；旧宿主忽略）。 */
  auth?: HostAuthRule;
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
  /** 诊断告警（可选：只有一个 `error` 的旧装配仍可用）。 */
  warn?(message: unknown): void;
}

/**
 * 拒绝一个 HTTP 请求并把决策写进 node:http 响应。拒绝语义见 `denyReply`：
 * 302 跳转一律 no-store 且带 no-referrer，401/403 一律纯文本 no-store。
 */
export function denyHttp(
  req: GuardRequest,
  res: ServerResponse,
  decision: GateDeny = "deny",
): void {
  writeGuardReply(res, denyReply(req, decision));
}

/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export function denyForbidden(res: ServerResponse): void {
  writeGuardReply(res, forbiddenReply());
}

const unwrappers = new WeakMap<WrappableServer, () => void>();

/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。handler 与 0.2.2 的 resource 两种路由
 * 都进入同一套守卫；幂等：同一 server 第二次调用返回同一 unwrap，并打一条
 * `log.warn`（第二次调用不是新的 owner，不能假装自己会拆卸守卫）。
 *
 * 返回的 unwrap 逐条回滚，不整表还原：只把目标函数仍是本次 wrap 产出的守卫版本的
 * 条目换回原路由（D27：wrap 之后注册的路由保留在表中、只摘掉守卫；wrap 期间被
 * 拥有者卸载的条目不写回；被第三方换成别的函数的条目不碰）。最后还原三个注册方法：
 * 同样只还原「当前值仍是本次 wrapper」的方法，叠在上面的第三方 wrapper 不动。
 *
 * `rebridge` 透传给每个 HTTP 入口（handler 与 resource 两种形态、存量与晚注册、fallback），
 * 语义见 {@link AdmitRebridge}；upgrade 入口不接它，握手没法用重定向修复。
 *
 * `fallbackAuth` 只在宿主有路由鉴权模型（0.2.3-alpha.2 起）时传入：它把宿主 fallback 的
 * `auth` 规则包一层，未完整认证时降级成 `anonymous`，让守卫按登录流程判定（见
 * {@link FallbackAuthAdapter}）。旧宿主没有 `auth` 字段，注册对象逐字不变。
 */
export function wrapServer(
  server: WrappableServer,
  gate: () => Gate,
  log: GuardLog,
  onAdmit?: AdmitHook,
  rebridge?: AdmitRebridge,
  fallbackAuth?: FallbackAuthAdapter,
): () => void {
  // 幂等：第二次 wrap 不重新包装，返回第一次的 unwrap；但「谁拥有这次包装」必须可见：
  // 否则两个调用方都以为自己的 unwrap 会拆卸守卫，实际只有先来的那个负责。
  const existing = unwrappers.get(server);
  if (existing !== undefined) {
    // 所有权只属于第一次 wrap：第二个调用方拿到的 disposer 必须是空操作，
    // 否则它卸载时会替第一个调用方拆掉守卫（G3：幂等 ≠ 共享所有权）。
    log.warn?.("wrapServer: server is already guarded; second wrap is a no-op (returns a no-op)");
    return () => undefined;
  }

  const original = {
    register: server.register.bind(server),
    registerUpgrade: server.registerUpgrade.bind(server),
    registerFallback: server.registerFallback.bind(server),
  };
  const entries = makeEntryWrappers(gate, onAdmit, rebridge, fallbackAuth);

  for (const [path, route] of server.exact) server.exact.set(path, entries.route(route, "exact"));
  for (const [path, route] of server.prefixes) server.prefixes.set(path, entries.route(route));
  for (const [path, route] of server.upgrades)
    server.upgrades.set(path, entries.upgradeRoute(route));
  if (server.fallback !== undefined) server.fallback = entries.fallback(server.fallback);

  const register = ((route: WrappableRoute) =>
    original.register(entries.route(route))) as WrappableServer["register"] & { [GUARDED]?: true };
  const registerUpgrade = ((route: WrappableUpgradeRoute) =>
    original.registerUpgrade(entries.upgradeRoute(route))) as WrappableServer["registerUpgrade"] & {
    [GUARDED]?: true;
  };
  const registerFallback = ((fallback: WrappableFallback) =>
    original.registerFallback(
      entries.fallback(fallback),
    )) as WrappableServer["registerFallback"] & {
    [GUARDED]?: true;
  };
  for (const method of [register, registerUpgrade, registerFallback]) method[GUARDED] = true;
  server.register = register;
  server.registerUpgrade = registerUpgrade;
  server.registerFallback = registerFallback;

  const unwrap = () => {
    rollbackRoutes(server.exact, entries.httpOrigins);
    rollbackRoutes(server.prefixes, entries.httpOrigins);
    rollbackUpgrades(server.upgrades, entries.upgradeOrigins);
    rollbackFallback(server, entries.fallbackOrigins);
    rollbackRegisterMethods(server, { register, registerUpgrade, registerFallback }, original);
    unwrappers.delete(server);
  };
  unwrappers.set(server, unwrap);
  return unwrap;
}
