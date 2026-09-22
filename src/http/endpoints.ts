import type { IncomingMessage, ServerResponse } from "node:http";
import { parseCookieHeader, validateNext } from "../shared/index.js";
import { buildSetCookie, type SessionStore } from "../session/index.js";

/**
 * token 与 password 两个认证面共用的端点件（核心机制层 http/，与 gate、session 并列）。
 *
 * 两个认证面的 deps 结构上都满足 `AuthHttpDeps`：这里只声明本模块真实需要的字段，
 * 不依赖任何一方的完整 deps 形状，也不 import 任何 features/ slice。
 */
export interface AuthHttpDeps {
  /** 会话访问器（M16：domain 异步就绪，端点内每次现取；undefined = 会话通道不可用）。 */
  readonly sessions: () => SessionStore | undefined;
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
  readonly logoutOrder: number;
  readonly logger: { info(message: unknown): void };
}

/** 兜底：未注册的 `/auth/*` 一律 404，不落到 SPA fallback（M20）。 */
export function authCatchAll(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

/** POST /auth/logout 路由入口：非 POST 405，其余交给 logout。 */
export function handleLogout(
  deps: AuthHttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
): void | Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }
  return logout(deps, req, res);
}

/** POST /auth/logout：next 仅从 query 取（M22），不解析 body、不要求 content-type。 */
async function logout(
  deps: AuthHttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const next = validateNext(queryOf(req).get("next") ?? "/");
  const store = deps.sessions();
  const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
  if (store !== undefined && token !== undefined && token !== "") {
    await store.revokeByToken(token); // 无会话/无 cookie 静默成功
  }
  res.setHeader("cache-control", "no-store");
  res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure));
  res.writeHead(302, { location: next });
  res.end();
  deps.logger.info("logout");
}

/** GET /auth/status：只认 cookie（M5，Bearer 不参与）。 */
export function handleStatus(deps: AuthHttpDeps, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    methodNotAllowed(res, "GET");
    return;
  }
  const store = deps.sessions();
  const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
  const authenticated =
    store !== undefined &&
    token !== undefined &&
    token !== "" &&
    store.getByToken(token) !== undefined;
  res.setHeader("cache-control", "no-store");
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ authenticated, logoutOrder: deps.logoutOrder }));
}

/** 只取 query（M22：logout 的 next 不走 body），node:http 无内置 req.query。 */
export function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

export function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(405, { allow, "content-type": "text/plain" });
  res.end("method not allowed");
}
