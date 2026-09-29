/**
 * PR2 客户端管理块的**冻结类型面**（契约 §2，lead 所有）。
 *
 * 只放类型与常量，不放逻辑。客户端半区禁止 import host 半区（`slice:check` 铁律），
 * 所以这里的形状是对服务端 `AdminUserView` / `/auth/status` 的**手写镜像**；
 * 漂移由 jsdom 集成测试与真机 E2E 兜住，不靠 import 共享。
 */

/** 与 `users.yaml` 的 role 同集合（镜像，不 import 服务端）。 */
export type UserRole = "admin" | "user";

/** 会话类别（PR1 / D25）：受限会话只能改密，不进管理面。 */
export type SessionKind = "full" | "password-change-only";

/**
 * `GET /auth/status` 的「关于我」投影。
 *
 * **加法兼容**：追加字段是 PR1 才有的（旧服务端只回 `authenticated`/`logoutOrder`），
 * 任一身份字段缺失即视为「不渲染管理块」，其余行为一字不变（契约 §1.1 / §3.3）。
 * 可选字段显式带 `| undefined`（`exactOptionalPropertyTypes`）。
 */
export interface AccountStatusView {
  authenticated: boolean;
  name?: string | undefined;
  role?: UserRole | undefined;
  /** 账号是否被禁用：§9-A1 渲染门要求 `=== false`（禁用 admin 不挂管理块）。 */
  disabled?: boolean | undefined;
  totpEnabled?: boolean | undefined;
  sessionKind?: SessionKind | undefined;
}

/** `GET /auth/users` 的单行投影，与服务端 `AdminUserView` 同形同键集。 */
export interface AdminUserRow {
  name: string;
  role: UserRole;
  disabled: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

/** 管理重置表单字段（`confirm` 只在客户端比对，不进请求体，契约 §1.3）。 */
export type AdminField = "target" | "password" | "confirm" | "code";

export type AdminResetValues = Record<AdminField, string>;

/** 表单初值：提交成功后必须清回这一份（契约 §3.8）。 */
export const EMPTY_ADMIN_RESET: AdminResetValues = {
  target: "",
  password: "",
  confirm: "",
  code: "",
};

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
export type AdminUsersResult =
  | { kind: "ok"; users: AdminUserRow[] }
  | { kind: "denied" }
  | { kind: "unauthorized" }
  | { kind: "failure" }
  | { kind: "aborted" };

/** 重置结果：`sessionsRevoked:false` 仍算成功（服务端写盘已成功，契约 §1.3）。 */
export type AdminResetResult =
  | { kind: "ok"; sessionsRevoked: boolean }
  | { kind: "failure"; failure: AdminFailureView }
  | { kind: "aborted" };
