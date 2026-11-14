import type { PasskeySettingsResult } from "../model/passkey-form.ts";
/** `GET /auth/passkey/settings`（admin）：403 → `forbidden`（非 admin 静默不渲染）。 */
export declare function fetchPasskeySettings(signal: AbortSignal): Promise<PasskeySettingsResult>;
/** `POST /auth/passkey/settings`（admin）：写回条件 UI 开关（`"1"` / `"0"`）。 */
export declare function updatePasskeySettings(enabled: boolean, signal: AbortSignal): Promise<PasskeySettingsResult>;
//# sourceMappingURL=passkey-settings.d.ts.map