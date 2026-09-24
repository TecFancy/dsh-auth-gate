import { type AdminTranslate } from "./admin-copy.ts";
import type { AdminFailureView } from "./admin-types.ts";
/**
 * 状态码矩阵 → 文案键：
 * 400 bad_target / policy+rules、401 invalid_totp / unauthorized、403 forbidden、
 * 404 not_found、429 locked(+retryAfter)、其余（413/415/503 的 text/plain 与所有未列出组合，
 * 含缺 `error` 的 403/404/429）一律 generic。
 */
export declare function describeAdminFailure(status: number, body: unknown, t: AdminTranslate): AdminFailureView;
//# sourceMappingURL=admin-failure.d.ts.map