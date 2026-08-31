import type { ServerResponse } from "node:http";
import { buildSetCookie, type SessionStore } from "../../session/index.js";

/** issueSession 所需 deps 子集（结构化类型；PasswordEndpointsDeps 天然兼容）。 */
export interface IssueSessionDeps {
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number;
  launchTokenBridge?: (host: string) => Promise<string | undefined>;
  logger: {
    warn(message: unknown): void;
    info(message: unknown): void;
  };
}

/** 发会话（P14）：subject=username，每次登录新会话；成功 → 302 + set-cookie。
 * host 供 launch-token 桥生成带 token 的登录 URL（0.1.2-alpha 起的 dsh 页面 token 门）；
 * 桥失败/未配置 → 保持原 302(next)，绝不阻塞登录成功。 */
export async function issueSession(
  deps: IssueSessionDeps,
  res: ServerResponse,
  store: SessionStore,
  username: string,
  next: string,
  extraSetCookie?: string[],
  host?: string,
): Promise<void> {
  const { token: sessionToken } = await store.create(username, deps.sessionTtl * 1000);
  res.setHeader("cache-control", "no-store");
  const cookies = [
    ...(extraSetCookie ?? []),
    buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure),
  ];
  res.setHeader("set-cookie", cookies);
  let location = next;
  if (host !== undefined && host !== "" && deps.launchTokenBridge !== undefined) {
    try {
      location = (await deps.launchTokenBridge(host)) ?? next;
    } catch {
      deps.logger.warn("launch-token bridge failed; falling back to plain redirect");
    }
  }
  res.writeHead(302, { location });
  res.end();
  deps.logger.info("session issued");
}
