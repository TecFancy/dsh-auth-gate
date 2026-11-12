/**
 * `POST /auth/passkey/register`（注册 finish）：校验 attestation，并在**锁内**复核全局唯一性、
 * 每用户上限与 userHandle 后写盘（plan §5.4 的 TOCTOU 要求）。
 *
 * 顺序：门禁（含读 users，**先于** consume）→ consume ceremony（kind/userId 必须匹配）
 * → 库校验 → `BE=0 && BS=1` 拒绝 → 锁内复核 + 追加 → 200 摘要。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
/** 注册 finish：门禁 → consume ceremony → 校验 → 写盘 → 200。 */
export declare function handleRegisterFinish(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=passkey-register-finish.d.ts.map