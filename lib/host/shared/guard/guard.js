import { isCrossSiteDocumentNavigation, serveCrossSiteBounce } from "./cross-site-bounce.js";
import { denyReply, forbiddenReply, isProxyDeniedRequest, rebridgeReply, writeGuardReply, } from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";
import { rebridgeDecision } from "./rebridge.js";
import { guardResource } from "./resource.js";
export { GUARDED, isGuarded } from "./mark.js";
export { isNavigationRequest, isProxyDeniedRequest, isPublicStaticPath, isSafeLocation, PROXY_MARKER_HEADER, PUBLIC_STATIC_PATHS, } from "./http.js";
/** 运行期判定：这条路由带 resource 而不是 handler。旧宿主永远不会命中。 */
function isResourceRoute(route) {
    return typeof route.resource === "function";
}
/** 运行期判定：fallback 是 `{ resource }` 对象而不是函数。 */
function isResourceFallback(fallback) {
    return typeof fallback !== "function" && typeof fallback.resource === "function";
}
/** 路由条目上实际带守卫标记的那个函数。 */
function routeTarget(route) {
    return "resource" in route && route.resource !== undefined ? route.resource : route.handler;
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
export function guardHttp(gate, kind, handler, onAdmit, rebridgeHook) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, res) => {
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
    });
    guarded[GUARDED] = true;
    return guarded;
}
/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
 * `onAdmit` 与其他入口同义：门放行之后调用一次。
 */
export function guardUpgrade(gate, handler, onAdmit) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, socket, head) => {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const decision = await gate().decide(req, "upgrade", pathname);
        if (decision === "allow") {
            onAdmit?.();
            await handler(req, socket, head);
            return;
        }
        denyUpgrade(socket);
    });
    guarded[GUARDED] = true;
    return guarded;
}
/**
 * 拒绝一个 HTTP 请求并把决策写进 node:http 响应。拒绝语义见 `denyReply`：
 * 302 跳转一律 no-store 且带 no-referrer，401/403 一律纯文本 no-store。
 */
export function denyHttp(req, res, decision = "deny") {
    writeGuardReply(res, denyReply(req, decision));
}
/** 拒绝一个 WS 升级：写 401 响应行后销毁 socket，不进入 ws 协商。 */
export function denyUpgrade(socket) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
}
/** 403 拒绝（代理标记命中）：与 dsh /api 围栏同形（forbidden），禁缓存。 */
export function denyForbidden(res) {
    writeGuardReply(res, forbiddenReply());
}
const unwrappers = new WeakMap();
/** 把表里目标函数仍是本次 wrap 产出的守卫版本的条目换回原路由；已删除/被换掉的条目不动。 */
function rollbackRoutes(table, origins) {
    for (const [path, entry] of [...table]) {
        const own = routeTarget(entry);
        const origin = typeof own === "function" ? origins.get(own) : undefined;
        if (origin !== undefined)
            table.set(path, origin);
    }
}
/** fallback 座位的回滚：只还原本次 wrap 产出的那个目标函数。 */
function rollbackFallback(server, origins) {
    const fallback = server.fallback;
    if (fallback === undefined)
        return;
    const own = typeof fallback === "function" ? fallback : fallback.resource;
    const origin = origins.get(own);
    if (origin !== undefined)
        server.fallback = origin;
}
/** upgrade 表的逐条回滚，语义与 `rollbackRoutes` 相同。 */
function rollbackUpgrades(table, origins) {
    for (const [path, entry] of [...table]) {
        const origin = origins.get(entry.handler);
        if (origin !== undefined)
            table.set(path, origin);
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
 *
 * `rebridge` 透传给每个 HTTP 入口（handler 与 resource 两种形态、存量与晚注册、fallback），
 * 语义见 {@link AdmitRebridge}；upgrade 入口不接它，握手没法用重定向修复。
 */
export function wrapServer(server, gate, log, onAdmit, rebridge) {
    // 规格冻结签名：log 预留给诊断；包装/还原本身静默（自检在 index.ts 负责）。
    void log;
    const existing = unwrappers.get(server);
    if (existing !== undefined)
        return existing;
    const original = {
        register: server.register.bind(server),
        registerUpgrade: server.registerUpgrade.bind(server),
        registerFallback: server.registerFallback.bind(server),
    };
    // 仅记录本次 wrap 新产出的守卫函数（已守卫的输入原样返回，不归本次回滚）。
    const httpOrigins = new WeakMap();
    const upgradeOrigins = new WeakMap();
    const fallbackOrigins = new WeakMap();
    const guardRoute = (route, kind = route.kind) => {
        if (isResourceRoute(route)) {
            const resource = guardResource(gate, kind, route.resource, onAdmit, rebridge);
            if (resource === route.resource)
                return route;
            httpOrigins.set(resource, route);
            return { ...route, resource };
        }
        const handler = guardHttp(gate, kind, route.handler, onAdmit, rebridge);
        if (handler === route.handler)
            return route;
        httpOrigins.set(handler, route);
        return { ...route, handler };
    };
    const guardUpgradeRoute = (route) => {
        const handler = guardUpgrade(gate, route.handler, onAdmit);
        if (handler === route.handler)
            return route;
        upgradeOrigins.set(handler, route);
        return { ...route, handler };
    };
    const guardFallback = (fallback) => {
        if (isResourceFallback(fallback)) {
            const resource = guardResource(gate, "fallback", fallback.resource, onAdmit, rebridge);
            if (resource === fallback.resource)
                return fallback;
            fallbackOrigins.set(resource, fallback);
            return { ...fallback, resource };
        }
        const guarded = guardHttp(gate, "fallback", fallback, onAdmit, rebridge);
        if (guarded !== fallback)
            fallbackOrigins.set(guarded, fallback);
        return guarded;
    };
    for (const [path, route] of server.exact)
        server.exact.set(path, guardRoute(route, "exact"));
    for (const [path, route] of server.prefixes)
        server.prefixes.set(path, guardRoute(route));
    for (const [path, route] of server.upgrades)
        server.upgrades.set(path, guardUpgradeRoute(route));
    if (server.fallback !== undefined)
        server.fallback = guardFallback(server.fallback);
    const register = ((route) => original.register(guardRoute(route)));
    const registerUpgrade = ((route) => original.registerUpgrade(guardUpgradeRoute(route)));
    const registerFallback = ((fallback) => original.registerFallback(guardFallback(fallback)));
    for (const method of [register, registerUpgrade, registerFallback])
        method[GUARDED] = true;
    server.register = register;
    server.registerUpgrade = registerUpgrade;
    server.registerFallback = registerFallback;
    const unwrap = () => {
        rollbackRoutes(server.exact, httpOrigins);
        rollbackRoutes(server.prefixes, httpOrigins);
        rollbackUpgrades(server.upgrades, upgradeOrigins);
        rollbackFallback(server, fallbackOrigins);
        server.register = original.register;
        server.registerUpgrade = original.registerUpgrade;
        server.registerFallback = original.registerFallback;
        unwrappers.delete(server);
    };
    unwrappers.set(server, unwrap);
    return unwrap;
}
//# sourceMappingURL=guard.js.map