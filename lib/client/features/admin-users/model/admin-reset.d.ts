import type { AdminUserRow } from "../../../shared/api/index.ts";
/**
 * 管理重置表单与结果的 client 侧类型（契约 §2）。只放类型与常量，不放逻辑。
 *
 * 线上形状（列表行、请求体、响应体、错误体）在跨半边契约 `src/protocol/`（D31），经
 * `shared/api` 进来；这里只剩表单状态和解析后的结果，它们不上线，host 不认识。
 */
/** 管理重置表单字段（`confirm` 只在客户端比对，不进请求体，契约 §1.3）。 */
export type AdminField = "target" | "password" | "confirm" | "code";
export type AdminResetValues = Record<AdminField, string>;
/** 表单初值：提交成功后必须清回这一份（契约 §3.8）。 */
export declare const EMPTY_ADMIN_RESET: AdminResetValues;
/** 失败视图：已翻译消息 + 逐条策略文案 + 需标红的字段。 */
export interface AdminFailureView {
    message: string;
    rules: string[];
    fields: AdminField[];
}
/**
 * 列表结果（评审修正 A2）：
 * - 403 `forbidden` → `denied`：这张 cookie 不是 admin / 不是 full 会话 → **静默**不渲染管理块；
 * - 401 `unauthorized` → `unauthorized`：整页登录态已死 → 必须提示 `admin.unauthorized`，
 *   不能静默消失（否则上方的自助改密表单会继续按过期 status 显示"已登录"）；
 * - 503 / 网络 / 解析失败 → `failure`（提示 `admin.unavailable`）；
 * - 卸载中止 → `aborted`（回调里必须原样收手）。
 */
export type AdminUsersResult = {
    kind: "ok";
    users: AdminUserRow[];
} | {
    kind: "denied";
} | {
    kind: "unauthorized";
} | {
    kind: "failure";
} | {
    kind: "aborted";
};
/** 重置结果：`sessionsRevoked:false` 仍算成功（服务端写盘已成功，契约 §1.3）。 */
export type AdminResetResult = {
    kind: "ok";
    sessionsRevoked: boolean;
} | {
    kind: "failure";
    failure: AdminFailureView;
} | {
    kind: "aborted";
};
//# sourceMappingURL=admin-reset.d.ts.map