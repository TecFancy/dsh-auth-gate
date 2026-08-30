/**
 * gate slice 公共面：跨 slice import 的唯一入口。
 * 守卫核心机制：Gate 决策词汇 + webServer 包装 + 启动自检。
 * 首版用 `export *` 保证与重构前 API 面一致，后续可收紧为显式清单。
 */
export * from "./gate.js";
export * from "./guard.js";
export * from "./self-check.js";
//# sourceMappingURL=index.js.map