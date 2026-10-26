import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpHandler } from "../../../shared/guard/index.js";
import { methodNotAllowed, queryOf, singleTokenParam } from "../../../shared/http/index.js";
import { safeEqual } from "../../../shared/crypto/index.js";
import { BOOTSTRAP_SESSION_KIND, SETUP_PATH } from "../../../shared/protocol/index.js";
import { buildSetCookie, type SessionStore } from "../../../entities/session/index.js";
import type { ConfiguredProbe } from "../model/probe.js";
import { redirectTo, redirectToLogin } from "../model/respond.js";

/** bootstrap 会话的最长寿命：窗口再长也没有意义，且它只放行 `/auth/*`。 */
const BOOTSTRAP_TTL_CAP_SECONDS = 3600;

export interface BootstrapEndpointDeps {
  /** 未配置探针（每次请求现算）。 */
  probe: ConfiguredProbe;
  /** 当前进程的 launch token（与登录后桥读到的是同一枚）。 */
  readLaunchToken: () => string | undefined;
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlSeconds: number;
  logger: {
    info(message: unknown): void;
    warn(message: unknown): void;
    error(message: unknown): void;
  };
}

/**
 * `GET /auth/bootstrap?token=<launchToken>`：校验 launch token、确认实例仍然未配置，
 * 然后签发一枚 `bootstrap` 会话并 302 到 `/auth/setup`。
 *
 * 这里是首次引导通道唯一的校验点：门只按请求形状重定向过来，不做校验也不做 IO。
 * 任何失败分支（形状不对、token 不对、已配置、探针 unknown、会话存储缺失、异常）都回到
 * `/auth/login?next=%2F` 且不下发 cookie，绝不放行未认证请求给 dsh。
 */
export function makeBootstrapEndpoint(deps: BootstrapEndpointDeps): HttpHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      methodNotAllowed(res, "GET");
      return;
    }
    try {
      const token = singleTokenParam(queryOf(req));
      if (token === undefined || !launchTokenMatches(deps.readLaunchToken(), token)) {
        redirectToLogin(res);
        return;
      }
      if ((await deps.probe.state()) !== "unconfigured") {
        redirectToLogin(res);
        return;
      }
      const store = deps.sessions();
      if (store === undefined) {
        deps.logger.error("bootstrap refused: session store unavailable");
        redirectToLogin(res);
        return;
      }
      const ttlSeconds = Math.min(deps.sessionTtlSeconds, BOOTSTRAP_TTL_CAP_SECONDS);
      const issued = await store.create(
        BOOTSTRAP_SESSION_KIND,
        ttlSeconds * 1000,
        BOOTSTRAP_SESSION_KIND,
      );
      res.setHeader(
        "set-cookie",
        buildSetCookie(deps.cookieName, issued.token, ttlSeconds, deps.cookieSecure),
      );
      deps.logger.info("bootstrap session issued");
      redirectTo(res, SETUP_PATH);
    } catch {
      // fail-closed：响应已写出就不补写，未写出则退回登录页。绝不记录 token 本身。
      if (res.headersSent !== true) redirectToLogin(res);
      deps.logger.warn("bootstrap failed: unexpected error while issuing the session");
    }
  };
}

/** 常量时间比对；任一侧为空一律不匹配（空 launch token 不是凭证）。 */
function launchTokenMatches(launch: string | undefined, token: string): boolean {
  return launch !== undefined && launch !== "" && safeEqual(token, launch);
}
