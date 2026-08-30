import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "../../gate/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";
import { parseCookieHeader } from "../../shared/index.js";

/**
 * 恒时比较：双方 sha256 Buffer 摘要后 timingSafeEqual（M17：timingSafeEqual 只接受
 * Buffer/TypedArray：hex 字符串直接 TypeError；Buffer 摘要双方恒 32 字节，无长度侧信道）。
 */
export function safeEqual(input: string, stored: string): boolean {
  const inputDigest = createHash("sha256").update(input).digest();
  const storedDigest = createHash("sha256").update(stored).digest();
  return timingSafeEqual(inputDigest, storedDigest);
}

export interface TokenGateOptions {
  /** 每次 decide 调用的凭证解析器（index.ts 注入 credentials.resolve 闭包）。 */
  resolveToken: () => Promise<string | undefined>;
  /** 会话访问器（M16）：每次 decide 现取（domain 异步就绪；undefined = cookie 通道不可用。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
}

/** 共享 token 门（M2）：白名单 → 会话 cookie → Bearer，恒时校验，fail-closed。 */
export class TokenGate implements Gate {
  private readonly resolveToken: () => Promise<string | undefined>;
  private readonly sessions: () => SessionStore | undefined;
  private readonly cookieName: string;

  constructor(options: TokenGateOptions) {
    this.resolveToken = options.resolveToken;
    this.sessions = options.sessions;
    this.cookieName = options.cookieName;
  }

  async decide(
    req: IncomingMessage,
    _kind: GuardKind,
    pathname: string,
  ): Promise<"allow" | "deny"> {
    if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
      return "allow";
    }
    const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
    if (cookie !== undefined && cookie !== "") {
      const store = this.sessions();
      if (store?.getByToken(cookie) !== undefined) return "allow";
    }
    const authorization = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (match !== null) {
      const bearer = match[1];
      try {
        const stored = await this.resolveToken();
        if (bearer !== undefined && stored !== undefined && safeEqual(bearer, stored)) {
          return "allow";
        }
      } catch {
        return "deny"; // fail-closed 双保险（index.ts 的 resolver 已自行 catch 并记日志）
      }
    }
    return "deny";
  }
}
