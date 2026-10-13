import { isGuarded, type WrappableServer } from "./guard.js";

/**
 * 启动自检：返回未被守卫标记覆盖的入口清单，形如 "exact /api"、"fallback"、
 * "method register"。空 = 全部覆盖。只报告，不修复、不抛错。
 */
export function assertGuarded(server: WrappableServer): string[] {
  const failures: string[] = [];
  for (const [path, route] of server.exact) {
    if (!isGuarded(route.handler)) failures.push(`exact ${path}`);
  }
  for (const [path, route] of server.prefixes) {
    if (!isGuarded(route.handler)) failures.push(`prefix ${path}`);
  }
  for (const [path, route] of server.upgrades) {
    if (!isGuarded(route.handler)) failures.push(`upgrade ${path}`);
  }
  if (server.fallback !== undefined && !isGuarded(server.fallback)) {
    failures.push("fallback");
  }
  for (const method of ["register", "registerUpgrade", "registerFallback"] as const) {
    // Reflect.get 读取方法引用，避免 unbound-method 对成员访问的告警。
    const fn = Reflect.get(server, method) as (...args: never[]) => unknown;
    if (!isGuarded(fn)) failures.push(`method ${method}`);
  }
  return failures;
}
