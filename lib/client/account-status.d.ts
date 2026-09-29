import type { AccountStatusView } from "./admin-types.ts";
/**
 * 会话状态探针：`null` = 首次响应返回前（调用方自己渲染 loading）。
 * `credentials: "same-origin"` 保证带 cookie；卸载即 abort，回调里再看一眼 signal，
 * 避免卸载后 setState。任何失败（网络/解析/中止之外的异常）→ `{authenticated:false}`。
 */
export declare function useAccountStatus(): AccountStatusView | null;
//# sourceMappingURL=account-status.d.ts.map