import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { isCrossSiteDocumentNavigation, serveCrossSiteBounce } from "./cross-site-bounce.js";
import type { Gate, GateDeny, GuardKind, GuardRequest } from "./gate.js";
import { denyReply, forbiddenReply, isProxyDeniedRequest, writeGuardReply } from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";
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

/** 路由条目上实际带守卫标记的那个函数。 */
function routeTarget(route: WrappableRoute | WrappableUpgradeRoute): unknown {
  return "resource" in route && route.resource !== undefined ? route.resource : route.handler;
}

/**
 * 给一个 HTTP handler 套守卫。已守卫（幂等）则原样返回；deny 由守卫按 gate 给出的
 * 决策写 302/401/403，不调用原 handler；错误不捕获（交给 webserver 统一处理）。
 * allow 但属跨站顶层文档导航时不进原 handler，改回同源弹回页（见 `serveCrossSiteBounce`）。
 */
export function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler): HttpHandler {
  if (isGuarded(handler)) return handler;
  const guarded = (async (req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const decision = await gate().decide(req, kind, pathname);
    if (decision === "allow") {
      if (isProxyDeniedRequest(req, pathname)) {
        writeGuardReply(res, forbiddenReply());
        return;
      }
      if (isCrossSiteDocumentNavigation(req)) {
        serveCrossSiteBounce(res);
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
 */
export function guardUpgrade(gate: () => Gate, handler: UpgradeHandler): UpgradeHandler {
  if (isGuarded(handler)) return handler;
  const guarded = (async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const decision = await gate().decide(req, "upgrade", pathname);
    if (decision === "allow") {
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

/** 拒绝一个 WS 升级：写 401 响应行后销毁 socket，不进入 ws 协商。 */
export function denyUpgrade(socket: Duplex): void {
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export function denyForbidden(res: ServerResponse): void {
  writeGuardReply(res, forbiddenReply());
}

const unwrappers = new WeakMap<WrappableServer, () => void>();

/** 把表里目标函数仍是本次 wrap 产出的守卫版本的条目换回原路由；已删除/被换掉的条目不动。 */
function rollbackRoutes(
  table: Map<string, WrappableRoute>,
  origins: WeakMap<object, WrappableRoute>,
): void {
  for (const [path, entry] of [...table]) {
    const own = routeTarget(entry);
    const origin = typeof own === "function" ? origins.get(own) : undefined;
    if (origin !== undefined) table.set(path, origin);
  }
}

/** upgrade 表的逐条回滚，语义与 `rollbackRoutes` 相同。 */
function rollbackUpgrades(
  table: Map<string, WrappableUpgradeRoute>,
  origins: WeakMap<object, WrappableUpgradeRoute>,
): void {
  for (const [path, entry] of [...table]) {
    const origin = origins.get(entry.handler);
    if (origin !== undefined) table.set(path, origin);
  }
}

/**
 * 包装一个 WrappableServer：存量表 + fallback 原地换守卫，三个注册方法替换为
 * 守卫版本（增量保险，apply 顺序无关）。handler 与 0.2.2 的 resource 两种路由
 * 都进入同一套守卫；幂等：同一 server 第二次调用返回同一 unwrap。
 *
 * 返回的 unwrap 逐条回滚，不整表还原：只把目标函数仍是本次 wrap 产出的守卫版本的
 * 条目换回原路由（D27：wrap 之后注册的路由保留在表中、只摘掉守卫；wrap 期间被
 * 拥有者卸载的条目不写回；被第三方换成别的函数的条目不碰）。最后还原三个注册方法。
 */
export function wrapServer(server: WrappableServer, gate: () => Gate, log: GuardLog): () => void {
  // 规格冻结签名：log 预留给诊断；包装/还原本身静默（自检在 index.ts 负责）。
  void log;
  const existing = unwrappers.get(server);
  if (existing !== undefined) return existing;

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
      const resource = guardResource(gate, kind, route.resource);
      if (resource === route.resource) return route;
      httpOrigins.set(resource, route);
      return { ...route, resource };
    }
    const handler = guardHttp(gate, kind, route.handler);
    if (handler === route.handler) return route;
    httpOrigins.set(handler, route);
    return { ...route, handler };
  };
  const guardUpgradeRoute = (route: WrappableUpgradeRoute): WrappableUpgradeRoute => {
    const handler = guardUpgrade(gate, route.handler);
    if (handler === route.handler) return route;
    upgradeOrigins.set(handler, route);
    return { ...route, handler };
  };
  const guardFallback = (fallback: WrappableFallback): WrappableFallback => {
    if (isResourceFallback(fallback)) {
      const resource = guardResource(gate, "fallback", fallback.resource);
      if (resource === fallback.resource) return fallback;
      fallbackOrigins.set(resource, fallback);
      return { ...fallback, resource };
    }
    const guarded = guardHttp(gate, "fallback", fallback);
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
  register[GUARDED] = true;
  registerUpgrade[GUARDED] = true;
  registerFallback[GUARDED] = true;
  server.register = register;
  server.registerUpgrade = registerUpgrade;
  server.registerFallback = registerFallback;

  const unwrap = () => {
    rollbackRoutes(server.exact, httpOrigins);
    rollbackRoutes(server.prefixes, httpOrigins);
    rollbackUpgrades(server.upgrades, upgradeOrigins);
    const fallback = server.fallback;
    if (fallback !== undefined) {
      const own = typeof fallback === "function" ? fallback : fallback.resource;
      const origin = fallbackOrigins.get(own);
      if (origin !== undefined) server.fallback = origin;
    }
    server.register = original.register;
    server.registerUpgrade = original.registerUpgrade;
    server.registerFallback = original.registerFallback;
    unwrappers.delete(server);
  };
  unwrappers.set(server, unwrap);
  return unwrap;
}
