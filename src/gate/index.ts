/**
 * gate slice 公共面：跨 slice import 的唯一入口。
 * 守卫核心机制：Gate 决策词汇 + webServer 包装 + 启动自检。
 * 2026-09-13：由 `export *` 改为显式清单；新增导出必须在此登记。
 */
export { noopGate } from "./gate.js";
export type { Gate, GateDecision, GuardKind } from "./gate.js";
export {
  AUTH_PATH_PREFIX,
  denyForbidden,
  denyHttp,
  denyUpgrade,
  GUARDED,
  guardHttp,
  guardUpgrade,
  isGuarded,
  isProxyDeniedRequest,
  isPublicStaticPath,
  LOGIN_PATH,
  PROXY_MARKER_HEADER,
  PUBLIC_STATIC_PATHS,
  wrapServer,
} from "./guard.js";
export type {
  GuardLog,
  HttpHandler,
  UpgradeHandler,
  WrappableRoute,
  WrappableServer,
  WrappableUpgradeRoute,
} from "./guard.js";
export { assertGuarded } from "./self-check.js";
