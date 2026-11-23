import type { Duplex } from "node:stream";
import type { AdmitHook, Gate, GuardKind } from "./gate.js";
import type { HttpHandler, UpgradeHandler, WrappableFallback, WrappableRoute, WrappableUpgradeRoute } from "./guard.js";
import { type FallbackAuthAdapter } from "./host-auth.js";
import { type AdmitRebridge } from "./rebridge.js";
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
export declare function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler, onAdmit?: AdmitHook, rebridgeHook?: AdmitRebridge): HttpHandler;
/**
 * 给一个 upgrade handler 套守卫。**任何**非 allow 决策（含 `{deny:{upgrade:true}}`）
 * 都在 ws 协商前直接拒握手，不进入原 handler，也不为 socket 附加任何监听器。
 * 门抛错同样按拒绝处理（fail-closed）：握手没有「稍后重试」的语义，不能把异常留给宿主。
 * `onAdmit` 与其他入口同义：门放行之后调用一次；`peer` 与 {@link guardHttp} 一样原样转发。
 */
export declare function guardUpgrade(gate: () => Gate, handler: UpgradeHandler, onAdmit?: AdmitHook): UpgradeHandler;
/** upgrade 被拒时写 401 响应行并关闭握手 socket（不进入 ws 协商）。 */
export declare function denyUpgrade(socket: Duplex): void;
/** 入口包装器：四类入口共用的守卫套法 + 本次 wrap 的回滚起点表。 */
export interface EntryWrappers {
    readonly route: (route: WrappableRoute, kind?: GuardKind) => WrappableRoute;
    readonly upgradeRoute: (route: WrappableUpgradeRoute) => WrappableUpgradeRoute;
    readonly fallback: (fallback: WrappableFallback) => WrappableFallback;
    readonly httpOrigins: WeakMap<object, WrappableRoute>;
    readonly upgradeOrigins: WeakMap<object, WrappableUpgradeRoute>;
    readonly fallbackOrigins: WeakMap<object, WrappableFallback>;
}
/**
 * 造一组入口包装器：存量与晚注册的路由都走同一条守卫套法，`*Origins` 记录每个新产出的
 * 守卫函数对应的原入口（逐条回滚用，D27）。`fallbackAuth` 只在宿主有路由鉴权模型时传入。
 */
export declare function makeEntryWrappers(gate: () => Gate, onAdmit?: AdmitHook, rebridge?: AdmitRebridge, fallbackAuth?: FallbackAuthAdapter): EntryWrappers;
