import type { ServerResponse } from "node:http";
import { buildSetCookie, type SessionStore } from "../../session/index.js";
import {
  RESTRICTED_REDIRECT_PATH,
  RESTRICTED_SESSION_KIND,
  RESTRICTED_SESSION_TTL_SECONDS,
} from "./restricted-session.js";

/** issueSession 所需 deps 子集（结构化类型；PasswordEndpointsDeps 天然兼容）。 */
export interface IssueSessionDeps {
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number;
  /** 可选：dsh launch-token 桥（0.1.2-alpha+）。返回相对 `/?token=` 或 undefined。 */
  launchTokenBridge?: () => Promise<string | undefined>;
  logger: {
    warn(message: unknown): void;
    info(message: unknown): void;
  };
}

/** issueSession 的调用选项（P2：受限会话复用同一 cookie 名/属性/路径）。 */
export interface IssueSessionOptions {
  /** 302 目标（调用方已消毒的站内相对路径）。受限会话忽略它，恒跳改密页。 */
  next: string;
  /** 与主 cookie 同批下发的额外 cookie（如清挑战 cookie）。 */
  extraSetCookie?: string[] | undefined;
  /**
   * true = 受限会话（CONTRACT §3）：`kind: "password-change-only"`、TTL 15 分钟、
   * 302 `/auth/password`（**忽略 `next`**）、**跳过 launch-token 桥**（不能把
   * 未改密的用户送回宿主）。cookie 名/属性/路径与正式会话完全一致。
   */
  restricted?: boolean;
}

/**
 * 发会话（P14）：subject=username，每次登录新会话；成功 → 302 + set-cookie。
 * 正式会话：桥命中 → 302 到相对 `/?token=`（浏览器自动 mint dsh cookie；相对地址
 * 沿用当前 origin，不依赖请求 Host）；桥失败/未配置 → 保持原 302(next)，绝不阻塞
 * 登录成功。受限会话不参与桥，302 恒为 `/auth/password`。
 */
export async function issueSession(
  deps: IssueSessionDeps,
  res: ServerResponse,
  store: SessionStore,
  username: string,
  options: IssueSessionOptions,
): Promise<void> {
  const restricted = options.restricted === true;
  const ttlSeconds = restricted ? RESTRICTED_SESSION_TTL_SECONDS : deps.sessionTtl;
  const kind = restricted ? RESTRICTED_SESSION_KIND : "full";
  const { token } = await store.create(username, ttlSeconds * 1000, kind);
  res.setHeader("cache-control", "no-store");
  const cookies = [
    ...(options.extraSetCookie ?? []),
    buildSetCookie(deps.cookieName, token, ttlSeconds, deps.cookieSecure),
  ];
  res.setHeader("set-cookie", cookies);
  let location = restricted ? RESTRICTED_REDIRECT_PATH : options.next;
  if (!restricted && deps.launchTokenBridge !== undefined) {
    try {
      location = (await deps.launchTokenBridge()) ?? location;
    } catch {
      deps.logger.warn("launch-token bridge failed; falling back to plain redirect");
    }
  }
  res.writeHead(302, { location });
  res.end();
  deps.logger.info(restricted ? "restricted session issued" : "session issued");
}

/**
 * 登录侧唯一签发入口：按用户记录的 `must_change_password` 决定受限与否。
 * **判定只看登录时刻读到的用户记录**；之后的每请求判定只信 `session.kind`
 * （gate 不读 users.yaml，见 restricted-session.ts）。
 */
export async function issueLoginSession(
  deps: IssueSessionDeps,
  res: ServerResponse,
  store: SessionStore,
  username: string,
  next: string,
  user: { mustChangePassword?: boolean | undefined } | undefined,
  extraSetCookie?: string[],
): Promise<void> {
  await issueSession(deps, res, store, username, {
    next,
    extraSetCookie,
    restricted: user?.mustChangePassword === true,
  });
}
