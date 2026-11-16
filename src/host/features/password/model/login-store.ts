/**
 * 口令登录两条分支（密码提交 / TOTP 挑战提交）共用的两个 503 出口。
 *
 * 拆成独立文件是因为两个分支分处 `password-login.ts` 与 `password-login.totp.ts`（各自守 250 行
 * 上限），而这两个出口的语义必须完全一致：**不计失败、不清桶**，让用户原样重试。
 */
import type { ServerResponse } from "node:http";
import type { UsersLoadResult } from "../../../entities/user/index.js";
import type { SessionStore } from "../../../entities/session/index.js";

/** 两个出口只需要 deps 的这几样（结构匹配 `PasswordLoginDeps`）。 */
export interface LoginStoreDeps {
  readonly sessions: () => SessionStore | undefined;
  readonly loadUsers: () => Promise<UsersLoadResult>;
  readonly logger: { error(message: unknown): void };
}

/** 会话存储不可用 → 503（不计失败、不清桶，T8）；可用则返回 store。 */
export function requireStore(deps: LoginStoreDeps, res: ServerResponse): SessionStore | undefined {
  const store = deps.sessions();
  if (store !== undefined) return store;
  res.setHeader("cache-control", "no-store");
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("session store unavailable");
  deps.logger.error("login failed: session store unavailable");
  return undefined;
}

/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
export async function loadUsersOr503(
  deps: LoginStoreDeps,
  res: ServerResponse,
): Promise<UsersLoadResult | undefined> {
  try {
    return await deps.loadUsers();
  } catch (error) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("user store unavailable");
    deps.logger.error(
      `user store unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}
