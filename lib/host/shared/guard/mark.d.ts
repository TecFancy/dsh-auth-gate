/**
 * 守卫标记：既用于幂等重包装（已守卫的 handler/resource 原样返回），也用于启动自检
 * 判断每个入口是否已经过守卫。单独一个模块是为了让 `guard.ts` 与 `resource.ts`
 * 共享它而不形成循环依赖。
 */
import type { WrappableFallback, WrappableRoute, WrappableUpgradeRoute } from "./guard.js";
/** 挂在被包装 handler/resource 函数上的守卫标记。全局 symbol 保证跨模块实例一致。 */
export declare const GUARDED: unique symbol;
/**
 * 目标是否已带守卫标记。参数放宽到 `unknown`：路由表里可能混入 `undefined`
 * （例如旧宿主上没有 handler、也没有 resource 的畸形条目），判断本身不能抛错。
 */
export declare function isGuarded(target: unknown): boolean;
/**
 * 路由条目上实际携带守卫标记的那个函数：HTTP 路由可能是 handler 或 0.2.2 的
 * `{ resource }`；upgrade 只有 handler。包装回滚与启动自检共用同一判定，避免两处漂移。
 */
export declare function routeTarget(route: WrappableRoute | WrappableUpgradeRoute): unknown;
/**
 * fallback 座位上的目标函数：函数形态返回自身；对象形态取 `resource` 或 `handler`
 * （0.2.3-alpha.2 起宿主也接受 `{ handler }`）。回滚与启动自检共用，避免两处漂移。
 */
export declare function fallbackTarget(fallback: WrappableFallback | undefined): unknown;
