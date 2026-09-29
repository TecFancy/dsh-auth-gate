import { describeAdminFailure } from "./admin-failure.ts";
import { type AdminTranslate } from "./admin-copy.ts";
import type { AdminFailureView, AdminResetResult, AdminResetValues, AdminUsersResult } from "./admin-types.ts";
/**
 * 管理面客户端 API（CONTRACT-pr2 §1.2 / §1.3 + §9）：列表读取 + 重置提交。
 *
 * 类型全部来自 `admin-types.ts`（冻结面）；失败映射在 `admin-failure.ts`（A12 预拆，此处按
 * 冻结面原样再导出）。不手写 `Origin`（同源 POST 由浏览器自动携带）、不做 `Accept` 子串匹配、
 * 不重排服务端已排好的顺序。
 */
export { describeAdminFailure };
/**
 * `GET /auth/users`（cookie only，无 Origin 要求）。
 * 403 → `denied`（静默降级）；401 → `unauthorized`（整页登录态已死，必须提示，§9/A2）；
 * 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`（abort 后不解析响应体）。
 */
export declare function fetchAdminUsers(signal: AbortSignal): Promise<AdminUsersResult>;
/**
 * 本地校验闭表（§9/A6）：target → password → confirm → code。
 * `code` 只在 `actorTotpEnabled === true` 时校验，且用 `trim()` 判空（口令字段不 trim）。
 * 第三个参数缺省 false，只传两个实参的调用方行为不变。
 */
export declare function validateAdminReset(values: AdminResetValues, t: AdminTranslate, actorTotpEnabled?: boolean): AdminFailureView | null;
/**
 * `POST /auth/users/password`：
 * **成功只认契约 §1.3 的唯一形状** `200 {ok:true}`（grok 实现期必修 1）：2xx 但缺 `ok:true`
 * （空 JSON、`{ok:false}`、中间层 HTML 拦截页）一律走失败映射，宁可报错也不谎报"已重置"
 * 再清空现场口令。`sessionsRevoked` 缺失/非布尔/解析失败按 `false`（§9/A8+A10）；
 * 中止 → `aborted`。
 */
export declare function submitAdminReset(values: AdminResetValues, options: {
    signal: AbortSignal;
    actorTotpEnabled: boolean;
}, t: AdminTranslate): Promise<AdminResetResult>;
//# sourceMappingURL=admin-api.d.ts.map