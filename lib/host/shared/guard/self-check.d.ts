import { type WrappableServer } from "./guard.js";
/**
 * 启动自检：返回未被守卫标记覆盖的入口清单，形如 "exact /api"、"fallback"、
 * "method register"。空 = 全部覆盖。只报告，不修复、不抛错。
 */
export declare function assertGuarded(server: WrappableServer): string[];
//# sourceMappingURL=self-check.d.ts.map