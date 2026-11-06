import { isGuarded } from "./mark.js";
import type { WrappableRoute, WrappableServer, WrappableUpgradeRoute } from "./guard.js";

/** 路由条目上实际应带守卫标记的函数（handler 或 0.2.2 的 resource）。 */
function routeTarget(route: WrappableRoute | WrappableUpgradeRoute): unknown {
  return "resource" in route && route.resource !== undefined ? route.resource : route.handler;
}

/**
 * 启动自检：返回未被守卫标记覆盖的入口清单，形如 "exact /api"、"fallback"、
 * "method register"。空 = 全部覆盖。只报告，不修复、不抛错。
 *
 * handler 与 resource 两种路由都检查；fallback 既认函数也认 `{ resource }` 对象。
 */
export function assertGuarded(server: WrappableServer): string[] {
  const failures: string[] = [];
  for (const [path, route] of server.exact) {
    if (!isGuarded(routeTarget(route))) failures.push(`exact ${path}`);
  }
  for (const [path, route] of server.prefixes) {
    if (!isGuarded(routeTarget(route))) failures.push(`prefix ${path}`);
  }
  for (const [path, route] of server.upgrades) {
    if (!isGuarded(routeTarget(route))) failures.push(`upgrade ${path}`);
  }
  const fallback = server.fallback;
  if (fallback !== undefined) {
    const target = typeof fallback === "function" ? fallback : fallback.resource;
    if (!isGuarded(target)) failures.push("fallback");
  }
  for (const method of ["register", "registerUpgrade", "registerFallback"] as const) {
    // Reflect.get 读取方法引用，避免 unbound-method 对成员访问的告警。
    const fn = Reflect.get(server, method) as (...args: never[]) => unknown;
    if (!isGuarded(fn)) failures.push(`method ${method}`);
  }
  return failures;
}
