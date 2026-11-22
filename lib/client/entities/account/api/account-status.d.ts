import { type StatusResponse } from "../../../shared/api/index.ts";
/**
 * `GET /auth/status` 的「关于我」视图：线上形状 `StatusResponse`（跨半边契约 D31）去掉本视图
 * 不消费的 `mustChangePassword`。
 *
 * **加法兼容**：身份字段是 PR1 才有的（旧服务端只回 `authenticated`/`logoutOrder`），
 * 任一身份字段缺失即视为「不渲染管理块」，其余行为一字不变（契约 §1.1 / §3.3）。
 * `passkeyEnabled` 线上恒在（配置透传），但旧服务端没有它：视图里因此是可选的，
 * 缺失即 `undefined`（「不知道」，调用方不得据此推断关闭）。
 */
export type AccountStatusView = Omit<StatusResponse, "logoutOrder" | "mustChangePassword" | "passkeyEnabled" | "passwordLoginDisabled"> & {
    /** 「退出登录」按钮的槽位 order；缺失/非整数为 `undefined`（入口保留默认值）。 */
    logoutOrder?: number | undefined;
    passkeyEnabled?: boolean | undefined;
    /** 口令登录是否被策略关闭（`passkey: "required"`）；旧服务端缺该键 → `undefined`。 */
    passwordLoginDisabled?: boolean | undefined;
};
/** 会话探针结果：`ok`（200 体，含未认证）/ `failure`（网络、5xx、非 JSON）/ `aborted`。 */
export type AccountStatusResult = {
    kind: "ok";
    status: AccountStatusView;
} | {
    kind: "failure";
} | {
    kind: "aborted";
};
/** hook 的状态：首次响应前 loading；探针失败是**独立**的 failure，不塌缩成「未登录」。 */
export type AccountStatusState = {
    kind: "loading";
} | {
    kind: "ok";
    status: AccountStatusView;
} | {
    kind: "failure";
};
/**
 * `/auth/status` 响应体 → 视图对象。**逐字段白名单解析**（C8）：身份字段缺失、类型不符或
 * 取值不在白名单内，一律留 `undefined`；只有 `authenticated === true` 才可能让调用方继续渲染
 * 登录后的 UI。`passkeyEnabled` 同理：旧服务端没有该键、或值不是布尔 → `undefined`（不推断关闭）。
 */
export declare function parseAccountStatus(body: unknown): AccountStatusView;
/**
 * 共享的 `/auth/status` 探针（C9）：插件入口的 logout-order 探针、账户区状态 hook 与登出按钮
 * 在**同一次页面加载**里只发一个请求；每个调用方的 signal 只退订自己（最后一个退订才 abort）。
 */
export declare function requestAccountStatus(signal?: AbortSignal): Promise<AccountStatusResult>;
/** 会话状态探针：挂载/重试时经共享探针读一次；卸载即退订（不会卸载后 setState）。 */
export declare function useAccountStatus(): {
    state: AccountStatusState;
    retry: () => void;
};
