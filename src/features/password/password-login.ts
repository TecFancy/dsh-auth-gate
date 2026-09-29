import type { IncomingMessage, ServerResponse } from "node:http";
import {
  validateNext,
  parseFormBody,
  parseCookieHeader,
  resolvePublicHost,
  totpChallengePageHtml,
} from "../../shared/index.js";
import { DUMMY_HASH } from "./password.js";
import { LoginRateLimiter, loginPath, type UsersLoadResult } from "../../shared/index.js";
import { buildSetCookie, type SessionStore } from "../../session/index.js";
import { issueLoginSession } from "./session-issue.js";
import {
  INVALID_TOTP_CODE,
  sendInvalidCredentials,
  sendLockout,
  sendTotpLockout,
} from "./login-failure-pages.js";
import {
  buildChallengeValue,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  parseChallengeValue,
} from "./challenge-cookie.js";

export interface PasswordLoginDeps {
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number; // 秒
  /** 仅用于"文件缺失"warn 消息（P23）。 */
  usersPath: string;
  loadUsers: () => Promise<UsersLoadResult>;
  /** 与 verifyPassword 同形 `(password, storedHash)`：index.ts 直接注入 verifyPassword。 */
  verify: (password: string, storedHash: string) => Promise<boolean>;
  limiter: LoginRateLimiter;
  /**
   * 客户端标识（D19）：index.ts 注入「读受信反代写入的 IP 头 + 归一化」的解析器；
   * 缺省回退 `socket.remoteAddress`（历史行为）。同主机反代下不注入 ⇒ 所有客户端共用
   * 一个锁定桶（issue #74：任何一台设备错几次密码就把整台实例锁在门外）。
   */
  clientIp?: ((req: IncomingMessage) => string) | undefined;
  /** TOTP 模式（M4 T4）：off 忽略 secret；optional 有 secret 才两段式；required 全员两段式。 */
  totpMode: "off" | "optional" | "required";
  /** 注入的 TOTP 校验（index.ts 从 features/totp 装配；命中返回匹配 counter）。 */
  verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
  /** 注入的防重放守卫（index.ts 装配单例）。 */
  replayCheck: (username: string, counter: number, code: string) => boolean;
  /** 注入的当前时间（ms epoch；测试注入固定时钟）。 */
  now: () => number;
  /** 挑战 cookie HMAC 密钥（进程级，apply() 生成；D10）。 */
  challengeMacKey: Uint8Array;
  /**
   * 反钓鱼身份块的 host（D14）：配置优先，缺省/空串回退请求头 Host。
   * 半外壳反代（Caddy `header_up Host 127.0.0.1:3080`）下必须显式配置，否则会渲染回环地址。
   */
  publicHost?: string | undefined;
  /**
   * 可选：dsh launch-token 桥（0.1.2-alpha 起 client-connection 的页面 token 门）。
   * 登录成功后 302 到 `launchTokenBridge()` 的相对 `/?token=`（浏览器自动 mint dsh
   * cookie，沿用当前 origin）；返回 undefined / 抛错 / 未配置 → 原 302(next)。
   * 桥失败绝不阻塞登录成功。
   */
  launchTokenBridge?: () => Promise<string | undefined>;
  logger: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  };
}

/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;

/**
 * POST /auth/login（password 模式，P14 + M4 T6）。完成全部响应写出（415/413/401/429/503/302）。
 * 流程顺序冻结：body → 挑战 cookie 分流 → 限速 → 用户文件 → 恒时验证 → 会话/挑战。
 * 挑战提交路径（有合法挑战 cookie + body 含 code）：验证 TOTP → 发会话；
 * 否则走密码路径：验证通过后按 totpMode 决定直接发会话或发挑战 cookie。
 * 不吞不带 `status` 的流异常。
 */
export async function handlePasswordLogin(
  deps: PasswordLoginDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let params: URLSearchParams;
  try {
    params = await parseFormBody(req);
  } catch (error) {
    respondFormError(res, error);
    return;
  }
  const next = validateNext(params.get("next") ?? "/");
  const ip = deps.clientIp?.(req) ?? req.socket.remoteAddress ?? "";
  const host = resolvePublicHost(deps.publicHost, req.headers.host);
  const challenge = parseChallengeValue(
    parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE),
    deps.now(),
    deps.challengeMacKey,
  );
  const code = params.get("code") ?? "";

  // 挑战分流（M4 T6）：off 模式完全忽略 TOTP（残留/伪造挑战 cookie 不进入第二段，
  // 带 code 的 POST 落回密码路径（与「off = 忽略 secret」单出口，T4）。
  if (challenge !== undefined && code !== "" && deps.totpMode !== "off") {
    await handleTotpSubmit(deps, host, res, challenge, code, next, ip);
    return;
  }
  await handlePasswordSubmit(deps, res, params, next, ip, host);
}

/** TOTP 挑战提交：限速 → 用户文件 → 恒时验证 → 防重放 → 禁用检查 → 发会话。 */
async function handleTotpSubmit(
  deps: PasswordLoginDeps,
  host: string,
  res: ServerResponse,
  username: string,
  code: string,
  next: string,
  ip: string,
): Promise<void> {
  const lockout = lockoutSeconds(deps, ip, username);
  if (lockout !== undefined) {
    sendTotpLockout(res, { host, next, username }, lockout);
    deps.logger.info("rate limit exceeded");
    return;
  }
  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return;
  const user = loaded.snapshot.users.get(username);
  if (user?.totpSecret === undefined) {
    deps.limiter.recordFailure(ip, username);
    rejectTotp(deps, host, res, next, username);
    return;
  }

  // disabled 检查放在恒时验证之后（对齐 P9 密码路径：禁用用户仍跑真实验证，
  // 不给禁用账号计时侧信道）；码已匹配时防重放已登记，fail-closed 可接受。
  const matched = deps.verifyTotp(user.totpSecret, code, deps.now());
  const replay = matched !== undefined && deps.replayCheck(username, matched, code);
  if (matched === undefined || !replay || user.disabled) {
    deps.limiter.recordFailure(ip, username);
    rejectTotp(deps, host, res, next, username);
    return;
  }

  // 先取 store 再清桶：session store 不可用（503）时不 recordSuccess，
  // 已积累的失败计数保留（T8 限速连续）。
  const store = requireStore(deps, res);
  if (store === undefined) return;
  deps.limiter.recordSuccess(ip, username);
  // 清挑战 cookie + 发会话（M4 T6：一次性，防重放再收窄）；set-cookie 用数组
  // （Node 重复 setHeader 会覆盖，必须同一次写两个 cookie）。
  // P2 ④：带 must_change_password 标记 → 受限会话（302 /auth/password，忽略 next）。
  await issueLoginSession(deps, res, store, username, next, user, [
    buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure),
  ]);
}

/** 密码提交：限速 → 用户文件 → 恒时验证 → 按 totpMode 发会话或发挑战 cookie。 */
async function handlePasswordSubmit(
  deps: PasswordLoginDeps,
  res: ServerResponse,
  params: URLSearchParams,
  next: string,
  ip: string,
  host: string,
): Promise<void> {
  // 用户名 trim（手机键盘/剪贴板常带尾空格，`alice ` 永远对不上）；密码不 trim
  // （首尾空格可以是密码的一部分）。trim 发生在查用户与 DUMMY_HASH 之前，计时均一不变。
  const username = (params.get("username") ?? "").trim();
  const password = params.get("password") ?? "";
  const accountKey = username === "" ? undefined : username;

  const lockout = lockoutSeconds(deps, ip, accountKey);
  if (lockout !== undefined) {
    sendLockout(res, { host, next, username }, lockout);
    deps.logger.info("rate limit exceeded");
    return;
  }

  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return; // 系统错误不计失败
  if (
    await rejectedInvalid(deps, res, loaded, username, password, ip, accountKey, { host, next })
  ) {
    return;
  }

  const user = loaded.snapshot.users.get(username);
  const needsTotp = user?.totpSecret !== undefined && deps.totpMode !== "off";
  if (deps.totpMode === "required" && user?.totpSecret === undefined) {
    // required 模式：无 secret 的用户（含未知用户）统一 401（防枚举，与密码错误同响应）。
    // 只计失败、不先 recordSuccess（正确密码不得重置该账号/IP 的历史失败，P1.1）。
    deps.limiter.recordFailure(ip, accountKey);
    sendInvalidCredentials(res, { host, next, username });
    deps.logger.info("login rejected");
    return;
  }
  if (needsTotp) {
    // 两段式第一段通过：密码已证明，清失败桶后再发挑战（有意选择：TOTP 错码从 0 计，
    // 合法密码不应继承错密锁定；T8 仍在同一 limiter 上生效）
    deps.limiter.recordSuccess(ip, accountKey);
    // 发挑战 cookie，302 回挑战页（GET 渲染 TOTP 输入）
    const expires = deps.now() + CHALLENGE_TTL_SECONDS * 1000;
    res.setHeader("cache-control", "no-store");
    res.setHeader(
      "set-cookie",
      buildSetCookie(
        CHALLENGE_COOKIE,
        buildChallengeValue(username, expires, deps.challengeMacKey),
        CHALLENGE_TTL_SECONDS,
        deps.cookieSecure,
      ),
    );
    res.writeHead(302, { location: loginPath(next) });
    res.end();
    return;
  }
  const store = requireStore(deps, res);
  if (store === undefined) return;
  deps.limiter.recordSuccess(ip, accountKey); // P10：验证通过即清零失败桶（spec §4.7 步骤 7）
  // P2 ④：带 must_change_password 标记 → 受限会话（TTL 15 分钟、302 /auth/password）；
  // 无标记 → 正式会话（回归：既有 P14 行为不变）。
  await issueLoginSession(deps, res, store, username, next, user);
}

/** TOTP 拒绝路径（P1.3）：401 + 挑战页 HTML（error slot 固定常量文案，浏览器表单可见；
 * 不读 query error=，避免开放重定向式任意文案；挑战 cookie 保留，可重试）。
 * 文案取 `INVALID_TOTP_CODE`（D21）：走到这一步口令是对的，不能复用凭据常量。 */
function rejectTotp(
  deps: PasswordLoginDeps,
  host: string,
  res: ServerResponse,
  next: string,
  username: string,
): void {
  deps.logger.info("login rejected");
  res.setHeader("cache-control", "no-store");
  res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
  res.end(
    totpChallengePageHtml(next, INVALID_TOTP_CODE, {
      host,
      who: username,
      resetHref: loginPath(next, "password"),
    }),
  );
}

/** 会话存储不可用 → 503（不计失败、不清桶，T8）；可用则返回 store。 */
function requireStore(deps: PasswordLoginDeps, res: ServerResponse): SessionStore | undefined {
  const store = deps.sessions();
  if (store !== undefined) return store;
  res.setHeader("cache-control", "no-store");
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("session store unavailable");
  deps.logger.error("login failed: session store unavailable");
  return undefined;
}

/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
async function loadUsersOr503(
  deps: PasswordLoginDeps,
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

/** 恒时验证 + 拒绝路径（P9：未知/错口令/禁用统一 401 + 计失败）；返回是否已拒绝。 */
async function rejectedInvalid(
  deps: PasswordLoginDeps,
  res: ServerResponse,
  loaded: UsersLoadResult,
  username: string,
  password: string,
  ip: string,
  accountKey: string | undefined,
  page: { host: string; next: string },
): Promise<boolean> {
  if (loaded.missing && !warnedMissing) {
    warnedMissing = true;
    deps.logger.warn(`users file not found: ${deps.usersPath} (all password logins rejected)`);
  }
  const user = loaded.snapshot.users.get(username);
  const ok = await deps.verify(password, user?.passwordHash ?? DUMMY_HASH);
  if (ok && user !== undefined && !user.disabled) return false;
  deps.limiter.recordFailure(ip, accountKey);
  // D20：401 保状态码，body 换成登录卡片（error slot），否则浏览器只看到空白纯文本页。
  sendInvalidCredentials(res, { host: page.host, next: page.next, username });
  deps.logger.info("login rejected");
  return true;
}

/** 限速门（P10）：锁定 → 返回 retry-after 秒数（调用方渲染 429），放行 → undefined。 */
function lockoutSeconds(
  deps: PasswordLoginDeps,
  ip: string,
  accountKey: string | undefined,
): number | undefined {
  const check = deps.limiter.check(ip, accountKey);
  return check.allowed ? undefined : check.retryAfterSeconds;
}

/** 415/413 响应（M19 复刻：413 先写 `connection: close`，不调 req.destroy）；无 status 的异常向上抛。 */
function respondFormError(res: ServerResponse, error: unknown): void {
  const failed = error as { status?: number; message?: string };
  if (typeof failed.status !== "number") throw error;
  res.setHeader("cache-control", "no-store");
  if (failed.status === 413) res.setHeader("connection", "close");
  res.writeHead(failed.status, { "content-type": "text/plain" });
  res.end(failed.message ?? "bad request");
}
