import type { IncomingMessage, ServerResponse } from "node:http";
import {
  loginPath,
  parseCookieHeader,
  passwordLoginPageHtml,
  resolvePublicHost,
  totpChallengePageHtml,
  validateNext,
} from "../../shared/index.js";
import { LoginRateLimiter, mutateUsersFile, type UsersSnapshot } from "../../shared/index.js";
import { AUTH_PATH_PREFIX, type HttpHandler } from "../../gate/index.js";
import {
  authCatchAll,
  handleLogout,
  handleStatus,
  methodNotAllowed,
  queryOf,
} from "../../http/index.js";
import { handlePasswordLogin, type PasswordLoginDeps } from "./password-login.js";
import { handlePasswordChange, type PasswordChangeDeps } from "./password-change.js";
import { hashPassword } from "./password.js";
import { buildSetCookie, type SessionStore } from "../../session/index.js";
import { CHALLENGE_COOKIE, parseChallengeValue } from "./challenge-cookie.js";
import { resolveLoginNotice } from "./login-notice.js";

/** 改密端点的接线（§5）：写盘 / 哈希 / 独立限速桶 / 防重放 / 撤销会话，由 index.ts 注入。 */
export interface PasswordChangeWiring {
  /** 写盘入口：`(m) => mutateUsersFile(usersPath, m)`（锁内 CAS，唯一变更通道）。 */
  mutateUsers: (mutator: (snapshot: UsersSnapshot) => void | Promise<void>) => Promise<void>;
  /** 新口令哈希：index.ts 注入 hashPassword。 */
  hash: (password: string) => Promise<string>;
  /** 独立限速桶：与登录 limiter 不同实例、不同桶（P1 §1 限速）。 */
  limiter: LoginRateLimiter;
  /** 防重放：必须是 index.ts 登录侧那个 replayGuard 单例（D22 反退化断言）。 */
  replayCheck: (username: string, counter: number, code: string) => boolean;
  /** 写盘成功后撤销该 subject 全部会话（内部 try/catch，不改 200 语义）。 */
  revoke: (subject: string) => Promise<void>;
}

/**
 * 装配改密接线（§5 + §1.1-4）：独立限速桶 + 锁内写盘 + 新口令哈希 + 撤销会话。
 * 放在本切片而不是 root：root 侧只保留「接线」语义，撤销的 try/catch 也留在这里，
 * 端点永不看到 revoke 异常，写盘成功后的 200 语义不受影响。
 * 只接收 root 才有的四样东西；TOTP 校验函数 / clientIp / now / totpMode 等仍经
 * `registerPasswordEndpoints` 的登录 deps 流入，本切片不 import totp 切片（features 禁止互引）。
 */
export function makePasswordChangeWiring(
  usersPath: string,
  auth: { sessions: SessionStore | undefined },
  replayCheck: (username: string, counter: number, code: string) => boolean,
  log: { error(message: unknown): void; info(message: unknown): void },
): PasswordChangeWiring {
  return {
    mutateUsers: (mutator) => mutateUsersFile(usersPath, mutator),
    hash: hashPassword,
    limiter: new LoginRateLimiter(),
    replayCheck,
    // 会话访问器在调用时刻现取（domain 异步就绪，与登录侧同语义）。
    revoke: makeSessionRevoker(() => auth.sessions, log),
  };
}

/**
 * 撤销该 subject 的全部会话（含当前）。口令确实改成功了，撤销失败绝不改变 200 语义：
 * 错误只进 error 日志（含 subject 与失败原因），调用方仍回 200 {"ok":true}。
 * TODO(auth-p2): 撤销失败不重试，因此「新口令已生效但旧 cookie 仍可用」的窗口由会话 TTL 兜底。
 */
function makeSessionRevoker(
  sessions: () => SessionStore | undefined,
  log: { error(message: unknown): void; info(message: unknown): void },
): (subject: string) => Promise<void> {
  return async (subject: string) => {
    const store = sessions();
    if (store === undefined) {
      log.error(
        `sessions not revoked after password change: ${subject} (session store unavailable)`,
      );
      return;
    }
    try {
      const revoked = await store.revokeBySubject(subject);
      log.info(`sessions revoked after password change: ${subject} (${revoked} sessions)`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error(`sessions not revoked after password change: ${subject} (${reason})`);
    }
  };
}

/**
 * 管理面两条路由的注入面（P2 ① ②）。**结构性类型**：features 之间禁止互相 import，
 * 因此这里不引用 `features/admin` 的类型；root（`src/index.ts`）把
 * `makeAdminRoutes(...)` 的返回值直接传进来，结构匹配即可。
 * 缺省 = 不注册管理路由（既有 harness 的对象字面量不必改动）；
 * token 模式也走缺省（契约 §1：管理路由只在 password 模式注册）。
 */
export interface AdminRouteSet {
  /** `GET /auth/users`（405 allow 在 handler 内）。 */
  readonly users: HttpHandler;
  /** `POST /auth/users/password`（同上）。 */
  readonly resetPassword: HttpHandler;
}

export interface PasswordEndpointsDeps extends PasswordLoginDeps {
  /** 注册路由（index.ts 传入包装后的 server.register；被守卫包装但被 gate 白名单放行）。 */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
  /** 「退出登录」按钮在通用设置页的槽位 order（经 /auth/status 透传 client）。 */
  logoutOrder: number;
  /**
   * 改密接线（§5）。缺省 → 不注册 `/auth/password`（加法式公共面：既有测试 harness
   * 的对象字面量不必改动）；index.ts 在 password 模式下**总是**注入，生产唯一路径
   * 不存在「静默不注册」的空间（反退化测试见 password-change.test.ts）。
   */
  passwordChange?: PasswordChangeWiring | undefined;
  /** 管理面接线（P2）。缺省 → 不注册 `/auth/users` 与 `/auth/users/password`。 */
  admin?: AdminRouteSet | undefined;
}

/**
 * 注册 prefix `/auth` 兜底 + 三个 exact 端点（password 模式，P16）+（接线存在时）
 * `/auth/password`（P1）+（接线存在时）`/auth/users`、`/auth/users/password`（P2）。
 * 路由模型 **1 prefix + 6 exact**（token 模式仍 3 exact，管理路由不注册）。
 * 返回合并 disposer。路由模型同 M15：webserver 无 method 路由，exact handler 内部按
 * `req.method` 分发。
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
  if (deps.passwordChange !== undefined) {
    const change = toPasswordChangeDeps(deps, deps.passwordChange);
    // 405（allow: GET, POST）在 handlePasswordChange 内（§1 处理顺序第 1 步）；此处是薄委托。
    track({
      kind: "exact",
      path: "/auth/password",
      handler: (req, res) => handlePasswordChange(change, req, res),
    });
  }
  if (deps.admin !== undefined) {
    // P2：405/401/403/... 顺序全在各自 handler 内（契约 §1、§2）；此处只挂两条 exact。
    track({ kind: "exact", path: "/auth/users", handler: deps.admin.users });
    track({ kind: "exact", path: "/auth/users/password", handler: deps.admin.resetPassword });
  }
  return () => {
    for (const disposer of [...disposers].reverse()) disposer();
  };
}

/** 端点 deps → 改密 deps：登录侧已有的字段直接复用，只有 4 个字段来自接线。 */
function toPasswordChangeDeps(
  deps: PasswordEndpointsDeps,
  wiring: PasswordChangeWiring,
): PasswordChangeDeps {
  return {
    sessions: deps.sessions,
    cookieName: deps.cookieName,
    cookieSecure: deps.cookieSecure,
    usersPath: deps.usersPath,
    loadUsers: deps.loadUsers,
    verify: deps.verify,
    clientIp: deps.clientIp,
    // P2 §6：自助改密的 POST 也要 Origin/Sec-Fetch-Site 校验，来源取运营侧配置。
    publicHost: deps.publicHost,
    totpMode: deps.totpMode,
    verifyTotp: deps.verifyTotp,
    replayCheck: wiring.replayCheck,
    now: deps.now,
    logger: deps.logger,
    mutateUsers: wiring.mutateUsers,
    hash: wiring.hash,
    limiter: wiring.limiter,
    revoke: wiring.revoke,
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
    const host = resolvePublicHost(deps.publicHost, req.headers.host);
    // P1.1 / D24：改密后客户端跳回本页说明原因。白名单解析（只认常量键），
    // 未知/注入值一律忽略；卡片文案永不来自请求文本。**只挂在密码卡上**：TOTP 挑战页
    // 的下一步是输验证码，"用新密码登录"那半句在那里是错的。
    const notice = resolveLoginNotice(queryOf(req).get("notice"));
    // 2026-09-17 重设计：TOTP 段提供「换一个账号」回退。GET ?stage=password 显式清掉
    // 挑战 cookie 并渲染密码页。只清 cookie、不放行任何凭据：下次提交仍需密码 + TOTP。
    // 注意顺序：set-cookie 必须早于 writeHead（Node 在 headers sent 之后 setHeader 会抛
    // ERR_HTTP_HEADERS_SENT，线上表现为连接被重置、客户端拿不到任何响应）。
    const resetStage = queryOf(req).get("stage") === "password";
    res.setHeader("cache-control", "no-store");
    if (resetStage) {
      res.setHeader("set-cookie", buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure));
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (resetStage) {
      res.end(passwordLoginPageHtml(next, undefined, { host, notice }));
      return;
    }
    // M4 T6：合法挑战 cookie → 渲染 TOTP 挑战页；否则密码页。
    // off 模式忽略 TOTP（T4）：残留/伪造 cookie 一律渲染密码页。
    const challenge = parseChallengeValue(
      parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE),
      deps.now(),
      deps.challengeMacKey,
    );
    const showTotp = challenge !== undefined && deps.totpMode !== "off";
    res.end(
      showTotp
        ? totpChallengePageHtml(next, undefined, {
            host,
            who: challenge,
            resetHref: loginPath(next, "password"),
          })
        : passwordLoginPageHtml(next, undefined, { host, notice }),
    );
    return;
  }
  if (req.method === "POST") {
    return handlePasswordLogin(deps, req, res);
  }
  methodNotAllowed(res, "GET, POST");
}
