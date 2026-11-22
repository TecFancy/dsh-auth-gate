/** 挂在被包装 handler/resource 函数上的守卫标记。全局 symbol 保证跨模块实例一致。 */
export const GUARDED = Symbol.for("dsh-auth.guarded");
/**
 * 目标是否已带守卫标记。参数放宽到 `unknown`：路由表里可能混入 `undefined`
 * （例如旧宿主上没有 handler、也没有 resource 的畸形条目），判断本身不能抛错。
 */
export function isGuarded(target) {
    return typeof target === "function" && target[GUARDED] === true;
}
/**
 * 路由条目上实际携带守卫标记的那个函数：HTTP 路由可能是 handler 或 0.2.2 的
 * `{ resource }`；upgrade 只有 handler。包装回滚与启动自检共用同一判定，避免两处漂移。
 */
export function routeTarget(route) {
    return "resource" in route && route.resource !== undefined ? route.resource : route.handler;
}
