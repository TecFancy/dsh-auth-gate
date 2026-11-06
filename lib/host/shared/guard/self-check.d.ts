import type { WrappableServer } from "./guard.js";
/**
 * 启动自检：返回未被守卫标记覆盖的入口清单，形如 "exact /api"、"fallback"、
 * "method register"。空 = 全部覆盖。只报告，不修复、不抛错。
 *
 * handler 与 resource 两种路由都检查；fallback 既认函数也认 `{ resource }` 对象。
 */
export declare function assertGuarded(server: WrappableServer): string[];
//# sourceMappingURL=self-check.d.ts.map