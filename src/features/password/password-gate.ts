import type { IncomingMessage } from "node:http";
import { parseCookieHeader } from "../../shared/index.js";
import type { Gate, GuardKind } from "../../gate/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";

export interface PasswordGateOptions {
  /** 会话访问器（M16 同形）：每次 decide 现取；undefined = 会话通道不可用。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
}

/**
 * password 模式门（P12）：白名单 → 会话 cookie → Bearer 会话 token → deny。
 * 门内零 KDF、零文件 IO、同步返回；Bearer 通道按会话查表（可吊销可过期）。
 */
export class PasswordGate implements Gate {
  private readonly sessions: () => SessionStore | undefined;
  private readonly cookieName: string;

  constructor(options: PasswordGateOptions) {
    this.sessions = options.sessions;
    this.cookieName = options.cookieName;
  }

  decide(req: IncomingMessage, _kind: GuardKind, pathname: string): "allow" | "deny" {
    if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
      return "allow";
    }
    const store = this.sessions();
    if (store === undefined) return "deny";
    const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
    if (cookie !== undefined && cookie !== "" && store.getByToken(cookie) !== undefined) {
      return "allow";
    }
    const authorization = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (match !== null) {
      const bearer = match[1];
      if (bearer !== undefined && store.getByToken(bearer) !== undefined) return "allow";
    }
    return "deny";
  }
}
