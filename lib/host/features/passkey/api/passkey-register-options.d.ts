/**
 * `POST /auth/passkey/register/options`（注册 begin）。
 *
 * 已登录 + **再认证**（当前口令，`totp !== "off"` 且用户有 secret 时还要验证码）后才签发
 * ceremony：会话本身不足以注册，这是「会话被劫 → 加后门 passkey」的唯一堵点（plan §5.7）。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
/** 注册 begin：门禁 → 再认证 → label 校验 → options + ceremony cookie。 */
export declare function handleRegisterOptions(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=passkey-register-options.d.ts.map