/**
 * `GET /auth/passkey`（自己的凭据列表）与 `POST /auth/passkey/remove`（删除）。
 *
 * 列表只出 `PasskeySummary`（id 前缀 + 展示字段），绝不返回 `publicKeyCose` 或
 * `passkeyUserHandle`。删除按 credentialId 前缀唯一匹配；`all=1` 清空。**删最后一把或
 * `all=1` 必须再认证**（口令 + 条件 TOTP 码），否则会话被劫即可把用户锁在门外。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
/** `GET /auth/passkey`：门禁（GET、无表单、不查限速桶）→ 200 列表（createdAt 升序）。 */
export declare function handlePasskeyList(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
/**
 * `POST /auth/passkey/remove`：门禁 → 目标解析（404 / 400）→ 条件再认证 → 锁内删除 → 200。
 * 再认证只在 `all=1` 或「删后该用户凭据数为 0」时要求；普通单删只凭会话。
 */
export declare function handlePasskeyRemove(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=passkey-manage-endpoints.d.ts.map