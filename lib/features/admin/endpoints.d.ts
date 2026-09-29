import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminDeps, AdminRoutes } from "./deps.js";
/** 装配两条管理路由（index.ts 注册为 `/auth/users` 与 `/auth/users/password`）。 */
export declare function makeAdminRoutes(deps: AdminDeps): AdminRoutes;
/** `GET /auth/users`：405 → 401 → 403（非 admin / 受限会话）→ 200 列表。**不产生审计**（§5 噪声）。 */
export declare function handleUsers(deps: AdminDeps, req: IncomingMessage, res: ServerResponse): void | Promise<void>;
/**
 * `POST /auth/users/password`：顺序冻结（§2），不得重排：
 * 405 → 415/413 → Origin → 401 → admin 403 → 受限会话 403 → 限流桶 → 现读 users
 * → 目标名 → 404 → `self` 403 → 策略 → 条件式 TOTP → 锁内写盘 → 吊销目标会话
 * → 清目标限流桶 → `200 {ok,sessionsRevoked}` + 审计。
 * `target` **只认 body**（query 里的同名字段一律忽略）；`confirm` 由客户端校验，服务端不读。
 */
export declare function handleResetPassword(deps: AdminDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=endpoints.d.ts.map