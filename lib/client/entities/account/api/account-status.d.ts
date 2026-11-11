import { type StatusResponse } from "../../../shared/api/index.ts";
/**
 * `GET /auth/status` 的「关于我」视图：线上形状 `StatusResponse`（跨半边契约 D31）去掉本视图
 * 不用的 `logoutOrder`（由 client 入口单独读）与 `mustChangePassword`。
 *
 * **加法兼容**：身份字段是 PR1 才有的（旧服务端只回 `authenticated`/`logoutOrder`），
 * 任一身份字段缺失即视为「不渲染管理块」，其余行为一字不变（契约 §1.1 / §3.3）。
 * `passkeyEnabled` 线上恒在（配置透传），但旧服务端没有它：视图里因此是可选的，
 * 缺失即 `undefined`（「不知道」，调用方不得据此推断关闭）。
 */
export type AccountStatusView = Omit<StatusResponse, "logoutOrder" | "mustChangePassword" | "passkeyEnabled"> & {
    passkeyEnabled?: boolean | undefined;
};
/**
 * `/auth/status` 响应体 → 视图对象。**加法兼容**（契约 §1.1/§3.3）：
 * 身份字段缺失、类型不符或取值不在白名单内，一律留 `undefined`；只有
 * `authenticated === true` 才可能让调用方继续渲染登录后的 UI。
 * `passkeyEnabled` 同理：旧服务端没有该键、或值不是布尔 → `undefined`（不推断为关闭）。
 */
export declare function parseAccountStatus(body: unknown): AccountStatusView;
/**
 * 会话状态探针：`null` = 首次响应返回前（调用方自己渲染 loading）。
 * `credentials: "same-origin"` 保证带 cookie；卸载即 abort，回调里再看一眼 signal，
 * 避免卸载后 setState。任何失败（网络/解析/中止之外的异常）→ `{authenticated:false}`。
 */
export declare function useAccountStatus(): AccountStatusView | null;
//# sourceMappingURL=account-status.d.ts.map