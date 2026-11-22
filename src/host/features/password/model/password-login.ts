import type { IncomingMessage, ServerResponse } from "node:http";
import {
  validateNext,
  parseFormBody,
  parseCookieHeader,
  resolvePublicHost,
} from "../../../shared/http/index.js";
import { loginPath } from "../../../shared/protocol/index.js";
import { DUMMY_HASH } from "../lib/password.js";
import { type Admission, LoginRateLimiter } from "../../../shared/rate-limit/index.js";
import { type UsersLoadResult } from "../../../entities/user/index.js";
import { buildSetCookie, type SessionStore } from "../../../entities/session/index.js";
import { issueLoginSession } from "./session-issue.js";
import {
  sendInvalidCredentials,
  sendLockout,
  sendPasswordLoginDisabled,
} from "../ui/login-failure-pages.js";
import {
  buildChallengeValue,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  parseChallengeValue,
} from "./challenge-cookie.js";
import { handleTotpSubmit } from "./password-login.totp.js";
import { loadUsersOr503, requireStore } from "./login-store.js";

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
  /**
   * 登录页 passkey 入口（`wirePasskey` 启用时注入；缺省 = 不渲染）。
   *
   * **必须是读取器而不是快照**：条件 UI 开关可以在设置页运行时改写，登录页每次渲染都要读
   * 当前值（2026-11-12 在隔离实例里实测到快照会让开关失效）。
   */
  passkey?: (() => { readonly enabled: boolean; readonly conditionalUi: boolean }) | undefined;
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
  /**
   * 口令登录是否被策略关闭（`passkey: "required"`，issue #133）。
   *
   * 为 `true` 时**两条**口令路径都在读 users.yaml 之前拒绝：密码分支与 TOTP 挑战分支。
   * 后者必须单独拦 - 它不经过密码校验，只要手里有合法的挑战 cookie（HMAC 签名、5 分钟有效）
   * 就能凭验证码直接换会话，是「先完成第一段、再开启 passkey-only、再提交旧挑战」的绕过口。
   *
   * 拒绝发生在读盘与 scrypt 之前，因此不做恒时验证也不产生账号枚举侧信道：所有输入同响应。
   */
  passwordLoginDisabled?: boolean | undefined;
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
  // passkey-only：两条口令路径都在读盘之前拒绝（见 deps.passwordLoginDisabled 的注释）。
  // 放在这里而不是各分支内部，是为了让「密码」与「TOTP 挑战」共用同一个出口，不会漏一条。
  if (deps.passwordLoginDisabled === true) {
    sendPasswordLoginDisabled(res, { host, next });
    deps.logger.info("password login rejected: passkey is required");
    return;
  }
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

interface SubmitInput {
  readonly username: string;
  readonly password: string;
  readonly next: string;
  readonly ip: string;
  readonly host: string;
  readonly accountKey: string | undefined;
}

/**
 * 密码提交：受理（限速检查 + 并发占位）→ 用户文件 → 恒时验证 → 按 totpMode 发会话或挑战 cookie。
 *
 * 受理与结算在同一同步段内完成，并发请求不能全部先看到「未锁定」（P1.3）；
 * 结算在 finally 里兜底，任何提前返回（503、异常）只释放占位、不记失败。
 */
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
  const input: SubmitInput = {
    username,
    password: params.get("password") ?? "",
    next,
    ip,
    host,
    accountKey: username === "" ? undefined : username,
  };
  const admitted = deps.limiter.admit(ip, input.accountKey, "login");
  if (!admitted.admitted) {
    sendLockout(res, { host, next, username }, admitted.retryAfterSeconds);
    deps.logger.info("rate limit exceeded");
    return;
  }
  try {
    await submitVerified(deps, res, input, admitted.admission);
  } finally {
    admitted.admission.settle("abandon"); // 已结算时是空操作
  }
}

/** 受理之后的验证与发出；每条出口都显式结算，未结算的出口由 finally 释放占位。 */
async function submitVerified(
  deps: PasswordLoginDeps,
  res: ServerResponse,
  input: SubmitInput,
  admission: Admission,
): Promise<void> {
  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return; // 系统错误不计失败
  const user = loaded.snapshot.users.get(input.username);
  const verified = await verifyCredential(deps, loaded, input.username, input.password);
  if (!verified || user === undefined || user.disabled) {
    admission.settle("failure");
    sendInvalidCredentials(res, { host: input.host, next: input.next, username: input.username });
    deps.logger.info("login rejected");
    return;
  }
  if (deps.totpMode === "required" && user.totpSecret === undefined) {
    // required 模式：无 secret 的用户（含未知用户）统一 401（防枚举，与密码错误同响应）。
    admission.settle("failure");
    sendInvalidCredentials(res, { host: input.host, next: input.next, username: input.username });
    deps.logger.info("login rejected");
    return;
  }
  if (user.totpSecret !== undefined && deps.totpMode !== "off") {
    // 两段式第一段通过：只清**口令域**的失败桶；TOTP 域的猜码计数保持（P1：第二因子必须有上限）。
    admission.settle("success");
    issueChallenge(deps, res, input.username, input.next);
    return;
  }
  const store = requireStore(deps, res);
  if (store === undefined) return;
  admission.settle("success"); // P10：验证通过即清口令域失败桶（spec §4.7 步骤 7）
  // P2 ④：带 must_change_password 标记 → 受限会话（TTL 15 分钟、302 /auth/password）；
  // 无标记 → 正式会话（回归：既有 P14 行为不变）。
  await issueLoginSession(deps, res, store, input.username, input.next, user);
}

/** 恒时验证（P9：未知/错口令/禁用统一 401 + 计失败由调用方结算）。 */
async function verifyCredential(
  deps: PasswordLoginDeps,
  loaded: UsersLoadResult,
  username: string,
  password: string,
): Promise<boolean> {
  if (loaded.missing && !warnedMissing) {
    warnedMissing = true;
    deps.logger.warn(`users file not found: ${deps.usersPath} (all password logins rejected)`);
  }
  const user = loaded.snapshot.users.get(username);
  return deps.verify(password, user?.passwordHash ?? DUMMY_HASH);
}

/** 发挑战 cookie，302 回挑战页（GET 渲染 TOTP 输入）。 */
function issueChallenge(
  deps: PasswordLoginDeps,
  res: ServerResponse,
  username: string,
  next: string,
): void {
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
