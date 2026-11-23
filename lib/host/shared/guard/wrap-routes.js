import { isCrossSiteDocumentNavigation, serveCrossSiteBounce } from "./cross-site-bounce.js";
import { composeFallbackAuth } from "./host-auth.js";
import { denyReply, forbiddenReply, isProxyDeniedRequest, rebridgeReply, writeGuardReply, } from "./http.js";
import { GUARDED, isGuarded } from "./mark.js";
import { rebridgeDecision } from "./rebridge.js";
import { guardResource } from "./resource.js";
/** 运行期判定：这条路由带 resource 而不是 handler。旧宿主永远不会命中。 */
function isResourceRoute(route) {
    return typeof route.resource === "function";
}
/** 运行期判定：fallback 是 `{ resource }` 对象而不是函数。 */
function isResourceFallback(fallback) {
    return typeof fallback !== "function" && typeof fallback.resource === "function";
}
/** 运行期判定：fallback 是 `{ handler }` 对象（0.2.3-alpha.2 起宿主也接受这一形态）。 */
function isHandlerFallback(fallback) {
    return typeof fallback !== "function" && typeof fallback.handler === "function";
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
 * `peer` 是宿主 0.2.3-alpha.2 起传给 handler 的已放行 Peer；守卫**原样转发**，不解读。
 * 宿主自己的 `/api` 等 required 路由处理器只有拿到 Peer 才会工作，丢了它等于把宿主的
 * 路由弄坏（本插件只加一道门，不替换宿主语义）。
 */
export function guardHttp(gate, kind, handler, onAdmit, rebridgeHook) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, res, peer) => {
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
            await handler(req, res, peer);
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
 * 门抛错同样按拒绝处理（fail-closed）：握手没有「稍后重试」的语义，不能把异常留给宿主。
 * `onAdmit` 与其他入口同义：门放行之后调用一次；`peer` 与 {@link guardHttp} 一样原样转发。
 */
export function guardUpgrade(gate, handler, onAdmit) {
    if (isGuarded(handler))
        return handler;
    const guarded = (async (req, socket, head, peer) => {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        let decision;
        try {
            decision = await gate().decide(req, "upgrade", pathname);
        }
        catch {
            denyUpgrade(socket);
            return;
        }
        if (decision === "allow") {
            onAdmit?.();
            await handler(req, socket, head, peer);
            return;
        }
        denyUpgrade(socket);
    });
    guarded[GUARDED] = true;
    return guarded;
}
/** upgrade 被拒时写 401 响应行并关闭握手 socket（不进入 ws 协商）。 */
export function denyUpgrade(socket) {
    socket.on("error", () => undefined);
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}
/**
 * 造一组入口包装器：存量与晚注册的路由都走同一条守卫套法，`*Origins` 记录每个新产出的
 * 守卫函数对应的原入口（逐条回滚用，D27）。`fallbackAuth` 只在宿主有路由鉴权模型时传入。
 */
export function makeEntryWrappers(gate, onAdmit, rebridge, fallbackAuth) {
    const httpOrigins = new WeakMap();
    const upgradeOrigins = new WeakMap();
    const fallbackOrigins = new WeakMap();
    const route = (incoming, kind = incoming.kind) => {
        if (isResourceRoute(incoming)) {
            const resource = guardResource(gate, kind, incoming.resource, onAdmit, rebridge);
            if (resource === incoming.resource)
                return incoming;
            httpOrigins.set(resource, incoming);
            return { ...incoming, resource };
        }
        const handler = guardHttp(gate, kind, incoming.handler, onAdmit, rebridge);
        if (handler === incoming.handler)
            return incoming;
        httpOrigins.set(handler, incoming);
        return { ...incoming, handler };
    };
    const upgradeRoute = (incoming) => {
        const handler = guardUpgrade(gate, incoming.handler, onAdmit);
        if (handler === incoming.handler)
            return incoming;
        upgradeOrigins.set(handler, incoming);
        return { ...incoming, handler };
    };
    const fallback = (incoming) => {
        if (isResourceFallback(incoming)) {
            const resource = guardResource(gate, "fallback", incoming.resource, onAdmit, rebridge);
            const auth = composeFallbackAuth(incoming.auth, fallbackAuth);
            if (resource === incoming.resource && auth === incoming.auth)
                return incoming;
            fallbackOrigins.set(resource, incoming);
            return auth === undefined ? { ...incoming, resource } : { ...incoming, resource, auth };
        }
        const object = isHandlerFallback(incoming) ? incoming : undefined;
        // 函数形 fallback 只属于 0.1.x/0.2.0/0.2.1/0.2.2：那几代只接受函数或 `{ resource }`，把函数
        // 换成 `{ handler }` 对象会让它接不到任何未匹配请求。所以函数形原样保持函数形，也**不**给它
        // 挂 `auth`（旧宿主不读这个字段，而 alpha.2 的兜底是 `{ resource }` 对象，另走上面那条分支）。
        if (object === undefined) {
            const plain = incoming;
            const guarded = guardHttp(gate, "fallback", plain, onAdmit, rebridge);
            if (guarded === plain)
                return incoming;
            fallbackOrigins.set(guarded, incoming);
            return guarded;
        }
        const guarded = guardHttp(gate, "fallback", object.handler, onAdmit, rebridge);
        const auth = composeFallbackAuth(object.auth, fallbackAuth);
        if (guarded === object.handler && auth === object.auth)
            return incoming;
        fallbackOrigins.set(guarded, incoming);
        const next = { ...object, handler: guarded };
        return auth === undefined ? next : { ...next, auth };
    };
    return { route, upgradeRoute, fallback, httpOrigins, upgradeOrigins, fallbackOrigins };
}
