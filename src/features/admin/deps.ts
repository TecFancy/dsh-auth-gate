import type { IncomingMessage } from "node:http";
import type { LoginRateLimiter, UserRecord, UsersSnapshot } from "../../shared/index.js";
import type { HttpHandler } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";
import type { AdminAuditLogger } from "./audit.js";

/**
 * 管理面注入面（T-1 冻结，2026-09-24 仅 `verifyTotp` 由 boolean 修订为 `number | undefined`）：
 * 与 lead 的 `src/index.ts` 接线一一对应。features 之间禁止互相 import：
 * 本切片只消费 `session/`、`shared/`、`gate/`、`http/`。
 */
export interface AdminDeps {
  sessions: () => SessionStore | undefined;
  cookieName: string;
  /** 每请求现读（绝不信会话缓存）。 */
  loadUsers: () => Promise<UsersSnapshot>;
  /** 锁内 RMW（index.ts 绑 `mutateUsersFile(usersPath, m)`）。 */
  mutateUsers: (m: (snapshot: UsersSnapshot) => void | Promise<void>) => Promise<void>;
  hash: (password: string) => Promise<string>;
  verify: (password: string, hash: string) => Promise<boolean>;
  /** 返回**命中的 counter**（P1 同形）；undefined = 码不对/过期。 */
  verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
  /** 登录侧同一 `TotpReplayGuard` 单例；false = 同窗重放。 */
  replayCheck: (username: string, counter: number, code: string) => boolean;
  clientIp: (req: IncomingMessage) => string;
  /** 未配置时 Origin 通道恒不可用（只信 `Sec-Fetch-Site: same-origin`）。 */
  publicHost: string;
  /** **新独立桶**（不与登录桶、自助改密桶共用）。 */
  limiter: LoginRateLimiter;
  /** true = 全部吊销成功；false = 抛错/存储不可用（注入方不抛异常）。 */
  revokeSubject: (subject: string) => Promise<boolean>;
  /** 清目标登录桶 + 目标自助改密桶。 */
  clearRateBuckets: (subject: string) => void;
  now: () => number;
  logger: AdminAuditLogger;
}

/** 两条管理路由 handler（index.ts 注册 `/auth/users` 与 `/auth/users/password`）。 */
export interface AdminRoutes {
  users: HttpHandler;
  resetPassword: HttpHandler;
}

/** 重置请求的已解析输入（`target` 只认 body；`confirm` 由客户端校验，服务端不读）。 */
export interface ResetInput {
  actor: UserRecord;
  password: string;
  code: string;
  /** 打码白名单：[password, code]。日志侧只允许出现替换后的占位符（§5）。 */
  secrets: readonly string[];
}
