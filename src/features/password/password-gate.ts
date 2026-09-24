import type { IncomingMessage } from "node:http";
import { loginPath, parseCookieHeader } from "../../shared/index.js";
import type { Gate, GateDecision, GuardKind } from "../../gate/index.js";
import { AUTH_PATH_PREFIX, isNavigationRequest, isPublicStaticPath } from "../../gate/index.js";
import type { Session, SessionStore } from "../../session/index.js";
import { isRestrictedSession, RESTRICTED_REDIRECT_PATH } from "./restricted-session.js";

export interface PasswordGateOptions {
  /** 会话访问器（M16 同形）：每次 decide 现取；undefined = 会话通道不可用。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
}

/**
 * password 模式门（P12 + P2 ④ kind 感知）：白名单（`/auth` 前缀 + 公开只读静态路径）
 * → 会话 cookie → Bearer 会话 token → deny。门内零 KDF、零文件 IO（**绝不读 users.yaml**）、
 * 同步返回；Bearer 通道按会话查表（可吊销可过期）。
 *
 * `session.kind === "password-change-only"` 的受限会话只放行 `/auth` 前缀，且：
 * `GET /auth/login` → 302 改密页、`POST /auth/login` → 403；其余（含 `/auth/users*`）
 * 放行进 handler，由 handler 按 kind 细分（管理面回 403）。宿主 `/api`、静态、`/plugins`
 * 与 WS 一律 deny（导航 302 `/auth/password`，API 401，WS 拒握手）。
 */
export class PasswordGate implements Gate {
  private readonly sessions: () => SessionStore | undefined;
  private readonly cookieName: string;

  constructor(options: PasswordGateOptions) {
    this.sessions = options.sessions;
    this.cookieName = options.cookieName;
  }

  decide(req: IncomingMessage, kind: GuardKind, pathname: string): GateDecision {
    if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
      return this.decideAuthPath(req, kind, pathname);
    }
    const session = this.sessionOf(req);
    if (isRestrictedSession(session)) return denyRestricted(req, kind);
    if (isPublicStaticPath(kind, pathname)) return "allow";
    if (session !== undefined) return "allow";
    return denyAnonymous(req, pathname);
  }

  /** `/auth` 前缀内：只有受限会话需要细分；其余一律交 handler（method 矩阵在 handler）。 */
  private decideAuthPath(req: IncomingMessage, kind: GuardKind, pathname: string): GateDecision {
    if (!isRestrictedSession(this.sessionOf(req))) return "allow";
    if (kind === "upgrade") return { deny: { upgrade: true } };
    if (pathname !== "/auth/login") {
      // `/auth/password`、`/auth/status`、`/auth/logout`、`/auth/users*`：放行进 handler。
      // `/auth/users*` 由管理面 handler 回 403（**不是** gate 302，否则导航会跳走）。
      return "allow";
    }
    return req.method === "GET"
      ? { deny: { redirect: RESTRICTED_REDIRECT_PATH } }
      : { deny: { status: 403 } };
  }

  /** 会话解析：cookie → Bearer；store 不可用 / 无凭证 / 已吊销 / 已过期 → undefined。 */
  private sessionOf(req: IncomingMessage): Session | undefined {
    const store = this.sessions();
    if (store === undefined) return undefined;
    const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
    if (cookie !== undefined && cookie !== "") {
      const row = store.getByToken(cookie);
      if (row !== undefined) return row;
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const bearer = match?.[1];
    return bearer === undefined ? undefined : store.getByToken(bearer);
  }
}

/** 受限会话被拒的宿主路径：导航 → 302 改密页；WS → 拒握手；其余（API）→ 401。 */
function denyRestricted(req: IncomingMessage, kind: GuardKind): GateDecision {
  if (kind === "upgrade") return { deny: { upgrade: true } };
  return isNavigationRequest(req)
    ? { deny: { redirect: RESTRICTED_REDIRECT_PATH } }
    : { deny: { status: 401 } };
}

/** 未认证（无会话/会话失效）：导航 → 302 登录页 + next；其余 → 字符串 deny（401）。 */
function denyAnonymous(req: IncomingMessage, pathname: string): GateDecision {
  return isNavigationRequest(req) ? { deny: { redirect: loginPath(pathname) } } : "deny";
}
