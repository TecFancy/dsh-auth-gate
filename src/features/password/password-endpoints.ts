import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseCookieHeader,
  passwordLoginPageHtml,
  totpChallengePageHtml,
  validateNext,
} from "../../shared/index.js";
import { AUTH_PATH_PREFIX, type HttpHandler } from "../../gate/index.js";
import {
  authCatchAll,
  handleLogout,
  handleStatus,
  methodNotAllowed,
  queryOf,
} from "../../http/index.js";
import { handlePasswordLogin, type PasswordLoginDeps } from "./password-login.js";
import { CHALLENGE_COOKIE, parseChallengeValue } from "./challenge-cookie.js";

export interface PasswordEndpointsDeps extends PasswordLoginDeps {
  /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
  /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
  logoutOrder: number;
}

/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式，P16）。返回合并 disposer。
 * 路由模型同 M15：webserver 无 method 路由，exact handler 内部按 `req.method` 分发。
 */
export function registerPasswordEndpoints(deps: PasswordEndpointsDeps): () => void {
  const disposers: (() => void)[] = [];
  const track = (route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): void => {
    disposers.push(deps.register(route));
  };
  track({ kind: "prefix", path: AUTH_PATH_PREFIX, handler: authCatchAll });
  track({ kind: "exact", path: "/auth/login", handler: (req, res) => handleLogin(deps, req, res) });
  track({
    kind: "exact",
    path: "/auth/logout",
    handler: (req, res) => handleLogout(deps, req, res),
  });
  track({
    kind: "exact",
    path: "/auth/status",
    handler: (req, res) => handleStatus(deps, req, res),
  });
  return () => {
    for (const disposer of [...disposers].reverse()) disposer();
  };
}

// TODO(auth-m5): login CSRF token - re-evaluated in T13/D8, still not added.
function handleLogin(
  deps: PasswordEndpointsDeps,
  req: IncomingMessage,
  res: ServerResponse,
): void | Promise<void> {
  if (req.method === "GET") {
    const next = validateNext(queryOf(req).get("next") ?? "/");
    res.setHeader("cache-control", "no-store");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    // M4 T6：合法挑战 cookie → 渲染 TOTP 挑战页；否则密码页。
    // off 模式忽略 TOTP（T4）：残留/伪造 cookie 一律渲染密码页。
    const challenge = parseChallengeValue(
      parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE),
      deps.now(),
      deps.challengeMacKey,
    );
    const showTotp = challenge !== undefined && deps.totpMode !== "off";
    res.end(showTotp ? totpChallengePageHtml(next) : passwordLoginPageHtml(next));
    return;
  }
  if (req.method === "POST") {
    return handlePasswordLogin(deps, req, res);
  }
  methodNotAllowed(res, "GET, POST");
}
