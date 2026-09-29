import type { IncomingMessage } from "node:http";
import { makeAdminRoutes, type AdminRoutes } from "./features/admin/index.js";
import { hashPassword, verifyPassword } from "./features/password/index.js";
import { verifyTotpCode } from "./features/totp/index.js";
import { LoginRateLimiter, loadUsersFile, mutateUsersFile } from "./shared/index.js";
import type { SessionStore } from "./session/index.js";

/**
 * P2 管理面的 root 侧装配（从 `src/index.ts` 拆出，守住 250 行文件上限）：
 * 新独立限流桶 + 锁内写盘 + 吊销探针 + 双桶清理，全部在这里注入 `features/admin`。
 *
 * 三条口径：
 * - **现读**：权限判定与目标判定都走 `loadUsersFile`（每请求现读，绝不信会话缓存）；
 * - **单例**：`replayCheck` 必须是登录侧那个 `TotpReplayGuard` 单例（同码不能在两处各用一次）；
 * - **限流桶互相独立**：登录桶/自助改密桶/管理桶三者互不影响，管理成功只清目标的登录桶
 *   与自助改密桶（`clearAccount` **不动 IP 桶**，清 IP 桶等于给攻击者发豁免）。
 */
export interface AdminWiringInput {
  readonly sessions: () => SessionStore | undefined;
  readonly cookieName: string;
  readonly usersPath: string;
  readonly publicHost: string;
  readonly clientIp: (req: IncomingMessage) => string;
  /** 登录限速器（清目标账号桶用）。 */
  readonly limiter: LoginRateLimiter;
  /** P1 自助改密限速器（清目标账号桶用）。 */
  readonly passwordChangeLimiter: LoginRateLimiter;
  readonly replayCheck: (username: string, counter: number, code: string) => boolean;
  readonly log: { info(message: unknown): void; error(message: unknown): void };
}

export function makeAdminWiring(input: AdminWiringInput): AdminRoutes {
  return makeAdminRoutes({
    sessions: input.sessions,
    cookieName: input.cookieName,
    // 管理面每请求现读 users.yaml（绝不信会话缓存 / /auth/status）。
    loadUsers: async () => (await loadUsersFile(input.usersPath)).snapshot,
    mutateUsers: (mutator) => mutateUsersFile(input.usersPath, mutator),
    hash: hashPassword,
    verify: verifyPassword,
    verifyTotp: (secretB32, code, nowMs) => verifyTotpCode(secretB32, code, nowMs),
    replayCheck: input.replayCheck,
    clientIp: input.clientIp,
    publicHost: input.publicHost,
    limiter: new LoginRateLimiter(),
    // D22：写盘已成功 ⇒ 吊销失败不得改变 200 语义，只置 sessionsRevoked:false。
    revokeSubject: (subject) => revokeSubjectNow(input.sessions, subject, input.log),
    clearRateBuckets: (subject) => {
      input.limiter.clearAccount(subject);
      input.passwordChangeLimiter.clearAccount(subject);
    },
    now: Date.now,
    logger: input.log,
  });
}

/**
 * 管理重置用的吊销探针（P2 §2）：返回「是否全部吊销成功」而**不抛**。
 * 与 P1 自助改密的 revoker 分开实现：那边在 200 语义下静默吞错，这边要把真假
 * 落到响应的 `sessionsRevoked` 与审计字段里，所以必须把结果带出来。
 */
async function revokeSubjectNow(
  sessions: () => SessionStore | undefined,
  subject: string,
  log: { error(message: unknown): void; info(message: unknown): void },
): Promise<boolean> {
  const store = sessions();
  if (store === undefined) {
    log.error(`sessions not revoked after admin reset: ${subject} (session store unavailable)`);
    return false;
  }
  try {
    const revoked = await store.revokeBySubject(subject);
    log.info(`sessions revoked after admin reset: ${subject} (${revoked} sessions)`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.error(`sessions not revoked after admin reset: ${subject} (${reason})`);
    return false;
  }
}
