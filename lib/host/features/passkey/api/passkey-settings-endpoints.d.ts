/**
 * `GET/POST /auth/passkey/settings`（admin）：登录页条件 UI（passkey 自动填充）开关。
 *
 * GET 返回当前值；POST 只接受 `conditionalUi` = `"1"` / `"0"`（其它值 400），写回宿主
 * settings 服务。**持久化失败只记日志、仍回 200**：开关是可用性偏好，不是安全边界，
 * 写盘失败不该让管理员看到「保存失败」而反复重试。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
/** `GET /auth/passkey/settings`：门禁（GET）→ admin 校验 → 200 当前值。 */
export declare function handlePasskeySettingsGet(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
/** `POST /auth/passkey/settings`：门禁（POST + 表单）→ admin 校验 → 取值校验 → 写回 → 200。 */
export declare function handlePasskeySettingsPost(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=passkey-settings-endpoints.d.ts.map