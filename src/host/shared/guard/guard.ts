import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { isCrossSiteDocumentNavigation, serveCrossSiteBounce } from "./cross-site-bounce.js";
import type { AdmitHook, Gate, GateDecision, GateDeny, GuardKind, GuardRequest } from "./gate.js";
import {
  denyReply,
  forbiddenReply,
  isProxyDeniedRequest,
  rebridgeReply,
  writeGuardReply,
} from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";
import { rebridgeDecision, type AdmitRebridge } from "./rebridge.js";
import {
  rollbackFallback,
  rollbackRegisterMethods,
  rollbackRoutes,
  rollbackUpgrades,
} from "./rollback.js";
import { guardResource, type ResourceHandler } from "./resource.js";

export { GUARDED, isGuarded } from "./mark.js";
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

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

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
export type WrappableFallback = HttpHandler | { resource: ResourceHandler };

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
  /** 诊断告警（可选：只有一个 `error` 的旧装配仍可用）。 */
  warn?(message: unknown): void;
}

/** 运行期判定：这条路由带 resource 而不是 handler。旧宿主永远不会命中。 */
function isResourceRoute(route: WrappableRoute): route is WrappableResourceRoute {
  return typeof (route as WrappableResourceRoute).resource === "function";
}

/** 运行期判定：fallback 是 `{ resource }` 对象而不是函数。 */
function isResourceFallback(
  fallback: WrappableFallback,
): fallback is { resource: ResourceHandler } {
  return typeof fallback !== "function" && typeof fallback.resource === "function";
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
export function guardHttp(
  gate: () => Gate,
  kind: GuardKind,
  handler: HttpHandler,
  onAdmit?: AdmitHook,
  rebridgeHook?: AdmitRebridge,
): HttpHandler {
  if (isGuarded(handler)) return handler;
  const guarded = (async (req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const decision = await gate().decide(req, kind, pathname);
    if (decision === "allow") {
      onAdmit?.();
      if (isProxyDeniedRequest(req, pathname)) {
        writeGuardReply(res, forbiddenReply());
        return;
      }
      if (isCrossSiteDocumentNavigation(req)) {
        serveCrossSiteBounce(res);
        return;
      }
      const rebridge = rebridgeDecision(rebridgeHook, req, kind, pathname);
      if (rebridge !== undefined) {
        writeGuardReply(res, rebridgeReply(rebridge.location, rebridge.setCookie));
        return;
      }
      await handler(req, res);
      return;
    }
    writeGuardReply(res, denyReply(req, decision));
  }) as HttpHandler & { [GUARDED]?: true };
  guarded[GUARDED] = true;
  return guarded;
}

/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
 * 门抛错同样按拒绝处理（fail-closed）：握手没有「稍后重试」的语义，不能把异常留给宿主。
 * `onAdmit` 与其他入口同义：门放行之后调用一次。
 */
export function guardUpgrade(
  gate: () => Gate,
  handler: UpgradeHandler,
  onAdmit?: AdmitHook,
): UpgradeHandler {
  if (isGuarded(handler)) return handler;
  const guarded = (async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    let decision: GateDecision;
    try {
      decision = await gate().decide(req, "upgrade", pathname);
    } catch {
      denyUpgrade(socket);
      return;
    }
    if (decision === "allow") {
      onAdmit?.();
      await handler(req, socket, head);
      return;
    }
    denyUpgrade(socket);
  }) as UpgradeHandler & { [GUARDED]?: true };
  guarded[GUARDED] = true;
  return guarded;
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

/**
 * 拒绝一个 WS 升级：写 401 响应行后优雅结束连接，不进入 ws 协商。
 *
 * 先挂一个 no-op `error` 监听器再写：客户端可能已经重置连接，`end()` 之后的 socket
 * 错误若没人监听会升级成未捕获的 `'error'` 事件（进程级崩溃）。`end()` 让对端读到完整
 * 401 响应；`destroy()` 会把还没刷出的响应行直接丢掉。
 */
export function denyUpgrade(socket: Duplex): void {
  socket.on("error", () => undefined);
  socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
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
 */
export function wrapServer(
  server: WrappableServer,
  gate: () => Gate,
  log: GuardLog,
  onAdmit?: AdmitHook,
  rebridge?: AdmitRebridge,
): () => void {
  // 幂等：第二次 wrap 不重新包装，返回第一次的 unwrap；但「谁拥有这次包装」必须可见：
  // 否则两个调用方都以为自己的 unwrap 会拆卸守卫，实际只有先来的那个负责。
  const existing = unwrappers.get(server);
  if (existing !== undefined) {
    // 所有权只属于第一次 wrap：第二个调用方拿到的 disposer 必须是空操作，
    // 否则它卸载时会替第一个调用方拆掉守卫（G3：幂等 ≠ 共享所有权）。
    log.warn?.("wrapServer: server is already guarded; second wrap is a no-op (returns a no-op)");
    void existing;
    return () => undefined;
  }

  const original = {
    register: server.register.bind(server),
    registerUpgrade: server.registerUpgrade.bind(server),
    registerFallback: server.registerFallback.bind(server),
  };
  // 仅记录本次 wrap 新产出的守卫函数（已守卫的输入原样返回，不归本次回滚）。
  const httpOrigins = new WeakMap<object, WrappableRoute>();
  const upgradeOrigins = new WeakMap<object, WrappableUpgradeRoute>();
  const fallbackOrigins = new WeakMap<object, WrappableFallback>();

  const guardRoute = (route: WrappableRoute, kind: GuardKind = route.kind): WrappableRoute => {
    if (isResourceRoute(route)) {
      const resource = guardResource(gate, kind, route.resource, onAdmit, rebridge);
      if (resource === route.resource) return route;
      httpOrigins.set(resource, route);
      return { ...route, resource };
    }
    const handler = guardHttp(gate, kind, route.handler, onAdmit, rebridge);
    if (handler === route.handler) return route;
    httpOrigins.set(handler, route);
    return { ...route, handler };
  };
  const guardUpgradeRoute = (route: WrappableUpgradeRoute): WrappableUpgradeRoute => {
    const handler = guardUpgrade(gate, route.handler, onAdmit);
    if (handler === route.handler) return route;
    upgradeOrigins.set(handler, route);
    return { ...route, handler };
  };
  const guardFallback = (fallback: WrappableFallback): WrappableFallback => {
    if (isResourceFallback(fallback)) {
      const resource = guardResource(gate, "fallback", fallback.resource, onAdmit, rebridge);
      if (resource === fallback.resource) return fallback;
      fallbackOrigins.set(resource, fallback);
      return { ...fallback, resource };
    }
    const guarded = guardHttp(gate, "fallback", fallback, onAdmit, rebridge);
    if (guarded !== fallback) fallbackOrigins.set(guarded, fallback);
    return guarded;
  };

  for (const [path, route] of server.exact) server.exact.set(path, guardRoute(route, "exact"));
  for (const [path, route] of server.prefixes) server.prefixes.set(path, guardRoute(route));
  for (const [path, route] of server.upgrades) server.upgrades.set(path, guardUpgradeRoute(route));
  if (server.fallback !== undefined) server.fallback = guardFallback(server.fallback);

  const register = ((route: WrappableRoute) =>
    original.register(guardRoute(route))) as WrappableServer["register"] & { [GUARDED]?: true };
  const registerUpgrade = ((route: WrappableUpgradeRoute) =>
    original.registerUpgrade(guardUpgradeRoute(route))) as WrappableServer["registerUpgrade"] & {
    [GUARDED]?: true;
  };
  const registerFallback = ((fallback: WrappableFallback) =>
    original.registerFallback(guardFallback(fallback))) as WrappableServer["registerFallback"] & {
    [GUARDED]?: true;
  };
  for (const method of [register, registerUpgrade, registerFallback]) method[GUARDED] = true;
  server.register = register;
  server.registerUpgrade = registerUpgrade;
  server.registerFallback = registerFallback;

  const unwrap = () => {
    rollbackRoutes(server.exact, httpOrigins);
    rollbackRoutes(server.prefixes, httpOrigins);
    rollbackUpgrades(server.upgrades, upgradeOrigins);
    rollbackFallback(server, fallbackOrigins);
    rollbackRegisterMethods(server, { register, registerUpgrade, registerFallback }, original);
    unwrappers.delete(server);
  };
  unwrappers.set(server, unwrap);
  return unwrap;
}
