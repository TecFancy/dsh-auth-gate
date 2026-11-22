import type {
  WrappableFallback,
  WrappableRoute,
  WrappableServer,
  WrappableUpgradeRoute,
} from "./guard.js";
import { routeTarget } from "./mark.js";

/** 三个注册方法的一份引用（wrap 前的原方法，或 wrap 后装上去的 wrapper）。 */
type RegisterMethods = Pick<WrappableServer, "register" | "registerUpgrade" | "registerFallback">;

/**
 * 把表里目标函数仍是本次 wrap 产出的守卫版本的条目换回原路由；已删除/被换掉的条目不动。
 * 逐条回滚，不整表还原（D27）。
 */
export function rollbackRoutes(
  table: Map<string, WrappableRoute>,
  origins: WeakMap<object, WrappableRoute>,
): void {
  for (const [path, entry] of [...table]) {
    const own = routeTarget(entry);
    const origin = typeof own === "function" ? origins.get(own) : undefined;
    if (origin !== undefined) table.set(path, origin);
  }
}

/** fallback 座位的回滚：只还原本次 wrap 产出的那个目标函数。 */
export function rollbackFallback(
  server: WrappableServer,
  origins: WeakMap<object, WrappableFallback>,
): void {
  const fallback = server.fallback;
  if (fallback === undefined) return;
  const own = typeof fallback === "function" ? fallback : fallback.resource;
  const origin = origins.get(own);
  if (origin !== undefined) server.fallback = origin;
}

/** upgrade 表的逐条回滚，语义与 {@link rollbackRoutes} 相同。 */
export function rollbackUpgrades(
  table: Map<string, WrappableUpgradeRoute>,
  origins: WeakMap<object, WrappableUpgradeRoute>,
): void {
  for (const [path, entry] of [...table]) {
    const origin = origins.get(entry.handler);
    if (origin !== undefined) table.set(path, origin);
  }
}

/**
 * 还原三个注册方法：只写回「当前值仍是本次 wrapper」的那一个。第三方 wrapper 叠在
 * 守卫 wrapper 之上时，它的 unwrap 还没跑，整层覆盖会把它丢掉。
 */
export function rollbackRegisterMethods(
  server: WrappableServer,
  wrappers: RegisterMethods,
  origins: RegisterMethods,
): void {
  if (server.register === wrappers.register) server.register = origins.register;
  if (server.registerUpgrade === wrappers.registerUpgrade) {
    server.registerUpgrade = origins.registerUpgrade;
  }
  if (server.registerFallback === wrappers.registerFallback) {
    server.registerFallback = origins.registerFallback;
  }
}
