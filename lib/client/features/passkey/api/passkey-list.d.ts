import type { PasskeyListResult, PasskeySummaryView } from "../model/passkey-form.ts";
/** 解析 200 body；`passkeys` 不是数组视为形状非法（整表 failure）。 */
export declare function parsePasskeyList(body: unknown): PasskeySummaryView[] | undefined;
/**
 * `GET /auth/passkey`：401 → `unauthorized`（登录态已死）；403 → `forbidden`（受限会话）；
 * 非 200 / 形状非法 / 网络抛错 → `failure`；中止 → `aborted`。
 */
export declare function fetchPasskeys(signal: AbortSignal): Promise<PasskeyListResult>;
//# sourceMappingURL=passkey-list.d.ts.map