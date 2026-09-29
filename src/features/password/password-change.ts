import type { IncomingMessage, ServerResponse } from "node:http";
import {
  checkPasswordPolicy,
  checkRequestOrigin,
  parseCookieHeader,
  parseFormBody,
  type LoginRateLimiter,
  type UserRecord,
  type UsersLoadResult,
  type UsersSnapshot,
} from "../../shared/index.js";
import { type Session, type SessionStore } from "../../session/index.js";
import { methodNotAllowed } from "../../http/index.js";
import { DUMMY_HASH } from "./password.js";
import {
  handlePasswordChangePage,
  respondChanged,
  respondFormError,
  sendJson,
  sendUnavailable,
} from "./password-change.ssr.js";

export interface PasswordChangeDeps {
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  /** 仅用于「users 文件缺失」warn 文案（P7 同款）。 */
  usersPath: string;
  /**
   * 写盘前的判定读（A7 §4.2）：只用于「用户存在 / 禁用 / 旧哈希」判定，**不是**锁内权威读；
   * mutator 收到的快照才来自 `mutateUsersFile` 的锁内新鲜读。
   */
  loadUsers: () => Promise<UsersLoadResult>;
  /** 锁内 read-modify-write（index.ts 注入 `(m) => mutateUsersFile(usersPath, m)`）。 */
  mutateUsers: (mutator: (snapshot: UsersSnapshot) => void | Promise<void>) => Promise<void>;
  /** 现口令验证（index.ts 注入 verifyPassword）；也用于锁内复核（A6 §10）。 */
  verify: (password: string, storedHash: string) => Promise<boolean>;
  /** 新口令哈希（index.ts 注入 hashPassword）。 */
  hash: (password: string) => Promise<string>;
  /** 改密独立限速桶（index.ts 新建，与登录 limiter 不同实例）。 */
  limiter: LoginRateLimiter;
  /** 客户端 IP（D19）；缺省回退 socket.remoteAddress。 */
  clientIp?: ((req: IncomingMessage) => string) | undefined;
  /**
   * 配置的对外来源（P2 §6）：`Origin` 精确匹配用；**未配置时不得拿 `Host` 兜底**，
   * 只信 `Sec-Fetch-Site: same-origin`（checkRequestOrigin 的既有语义）。
   */
  publicHost?: string | undefined;
  totpMode: "off" | "optional" | "required";
  verifyTotp: (secretB32: string, code: string, nowMs: number) => number | undefined;
  /** 防重放（index.ts 注入同一 replayGuard 单例）：同窗 counter 已用过 → false。 */
  replayCheck: (username: string, counter: number, code: string) => boolean;
  /** 写盘成功后撤销该 subject 的全部会话（含当前；index.ts 注入，内部 try/catch）。 */
  revoke: (subject: string) => Promise<void>;
  now: () => number;
  logger: { error(m: unknown): void; info(m: unknown): void; warn(m: unknown): void };
}

/** 失败日志常量串（不反射请求内容，§1 审计要求）。 */
const REJECTED = "password change rejected";

/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;

/** 每次请求的日志安全上下文：错误消息里出现任一请求明文即整段打码。 */
interface ChangeContext {
  ip: string;
  subject: string;
  /** 现口令明文：只用于锁内复核（A6），绝不入日志。 */
  current: string;
  secrets: readonly string[];
}

/**
 * `/auth/password`（P1 §1 + P2 §1/§6）。GET 走 SSR 自足页；POST 处理顺序冻结：
 * method 405（allow: GET, POST）→ parseFormBody(415/413) → Origin/Sec-Fetch-Site(403)
 * → 会话 cookie(401) → 限速桶(429) → 读 users(503) → 恒时验证旧口令(401) → TOTP(401)
 * → 策略(400) → hash → 锁内写盘(503) → recordSuccess + 撤销全部会话
 * → 清 cookie +（nav=1 时 302 登录页，否则既有 200 JSON）。
 * 顺序硬约束：写盘成功后才撤销会话；写盘失败绝不允许出现「全被踢但密码没改」。
 * Origin 放在 415/413 之后、401 之前：畸形 body 不必先做 CSRF 判定，缺来源的脚本
 * 得到 403 而不是假 401。
 */
export async function handlePasswordChange(
  deps: PasswordChangeDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    handlePasswordChangePage(deps, req, res);
    return;
  }
  if (req.method !== "POST") {
    methodNotAllowed(res, "GET, POST");
    return;
  }
  let params: URLSearchParams;
  try {
    params = await parseFormBody(req);
  } catch (error) {
    respondFormError(res, error);
    return;
  }
  if (!originAccepted(deps, req, res)) return;

  const { current, newPassword, code } = requestOf(params);
  const subject = locateSession(deps, req)?.subject;
  if (subject === undefined) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const ctx: ChangeContext = {
    ip: clientIpOf(deps, req),
    subject,
    current,
    secrets: [current, newPassword, code],
  };

  const lockout = lockoutSeconds(deps, ctx.ip, subject);
  if (lockout !== undefined) {
    deps.logger.info("rate limit exceeded");
    res.setHeader("retry-after", String(lockout));
    sendJson(res, 429, { error: "locked", retryAfter: lockout });
    return;
  }

  // 读失败（含文件损坏/权限）不计失败：系统错误不该把用户锁在门外。
  const loaded = await loadUsersOr503(deps, res, ctx);
  if (loaded === undefined) return;

  const user = await authenticateCurrent(deps, loaded.snapshot.users.get(subject), current);
  if (user === undefined) {
    reject(deps, res, ctx, 401, { error: "invalid_credentials" });
    return;
  }
  // TOTP 在策略/写盘之前（§4.1-3，有意为之）：策略不过也会烧掉当前 30 s 窗，
  // 用户需等下一枚验证码；后置校验会扩大码重放面，故不重排。
  if (!totpAccepted(deps, user, ctx, code)) {
    reject(deps, res, ctx, 401, { error: "invalid_totp" });
    return;
  }

  const policy = await checkPasswordPolicy(newPassword, {
    oldPasswordHash: user.passwordHash,
    verifyOld: deps.verify,
  });
  if (!policy.ok) {
    reject(deps, res, ctx, 400, { error: "policy", rules: policy.rules });
    return;
  }

  const hashed = await hashOr503(deps, res, ctx, newPassword);
  if (hashed === undefined) return;
  if (!(await writeNewHash(deps, res, ctx, hashed))) return;

  deps.limiter.recordSuccess(ctx.ip, subject);
  // 写盘已成功：撤销失败绝不改变 200/302 语义（口令确实改了），只进 error 日志。
  // TODO(auth-p2): 撤销失败不重试 ⇒「新口令已生效但旧 cookie 仍可用」窗口由会话 TTL 兜底。
  await deps.revoke(subject);
  // P2 §1 响应整形：SSR 无 JS 表单的隐藏字段，精确匹配 nav=1（绝不用 Accept 子串判定）。
  respondChanged(deps, res, params.get("nav") === "1");
  deps.logger.info("password changed");
}

/** 请求字段（**不 trim 不截断**：口令按原始码点判定）。 */
function requestOf(params: URLSearchParams): {
  current: string;
  newPassword: string;
  code: string;
} {
  return {
    current: params.get("current") ?? "",
    newPassword: params.get("password") ?? "",
    code: params.get("code") ?? "",
  };
}

/**
 * P2 §6：Origin / Sec-Fetch-Site 同源校验（fail-closed）；拒绝 → 403 JSON，不计限速。
 * `checkRequestOrigin` 按结构读 `headers` / `socket`，直接透传 `req` 即可。
 */
function originAccepted(
  deps: PasswordChangeDeps,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const verdict = checkRequestOrigin(req, deps.publicHost ?? "");
  if (verdict.ok) return true;
  sendJson(res, 403, { error: "bad_origin" });
  return false;
}

/** 会话定位：只认 cookie（M5），Bearer 不参与；store/token 无效一律 undefined。 */
function locateSession(deps: PasswordChangeDeps, req: IncomingMessage): Session | undefined {
  const store = deps.sessions();
  const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
  if (store === undefined || token === undefined || token === "") return undefined;
  return store.getByToken(token);
}

/** D19：注入的解析器（受信反代 IP 头）优先，缺省回退 socket 地址。 */
function clientIpOf(deps: PasswordChangeDeps, req: IncomingMessage): string {
  return deps.clientIp?.(req) ?? req.socket.remoteAddress ?? "";
}

/** 恒时验证旧口令（P9 同款）：未知用户跑 DUMMY_HASH，禁用用户也跑真实验证；通过才返回用户。 */
async function authenticateCurrent(
  deps: PasswordChangeDeps,
  candidate: UserRecord | undefined,
  current: string,
): Promise<UserRecord | undefined> {
  const ok = await deps.verify(current, candidate?.passwordHash ?? DUMMY_HASH);
  return ok && candidate !== undefined && !candidate.disabled ? candidate : undefined;
}

/**
 * TOTP 门（§4）：off 忽略 secret；optional 有 secret 必填；**required 无 secret 也拒绝**
 * （不给无第二因子的存量会话留改密通道，对齐登录路径）。任何失败都计失败（§4.1-1）。
 */
function totpAccepted(
  deps: PasswordChangeDeps,
  user: UserRecord,
  ctx: ChangeContext,
  code: string,
): boolean {
  if (deps.totpMode === "off") return true;
  const secret = user.totpSecret;
  if (secret === undefined) return deps.totpMode !== "required";
  const counter = deps.verifyTotp(secret, code, deps.now());
  return counter !== undefined && deps.replayCheck(ctx.subject, counter, code);
}

/** 4xx 拒绝统一口径：计失败 + 常量日志 + JSON body（明文永不入日志）。 */
function reject(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
  status: number,
  body: unknown,
): void {
  deps.limiter.recordFailure(ctx.ip, ctx.subject);
  deps.logger.info(REJECTED);
  sendJson(res, status, body);
}

/** 读取用户文件；失败 → 503 + error 日志并返回 undefined（不计失败）。 */
async function loadUsersOr503(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
): Promise<UsersLoadResult | undefined> {
  try {
    const loaded = await deps.loadUsers();
    if (loaded.missing && !warnedMissing) {
      warnedMissing = true;
      deps.logger.warn(`users file not found: ${deps.usersPath} (all password changes rejected)`);
    }
    return loaded;
  } catch (error) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("user store unavailable");
    deps.logger.error(`user store unavailable: ${safeError(error, ctx.secrets)}`);
    return undefined;
  }
}

/** 新口令哈希；失败 → 503（同写盘失败口径：计失败 + error 日志）。 */
async function hashOr503(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
  newPassword: string,
): Promise<string | undefined> {
  try {
    return await deps.hash(newPassword);
  } catch (error) {
    deps.limiter.recordFailure(ctx.ip, ctx.subject);
    deps.logger.error(`password change failed: ${safeError(error, ctx.secrets)}`);
    sendUnavailable(res);
    return undefined;
  }
}

/**
 * 锁内写盘（唯一变更入口）；失败 → recordFailure + 503，**绝不吊销会话**。
 * 锁内复核（A6 §10）：mutator 在 `mutateUsersFile` 的新鲜快照上重新验证现口令，
 * 因此 CAS 冲突后的重跑是安全的：他人并发改过口令时宁可 503，也不覆盖写入。
 * mutator 内不得再调 `mutateUsersFile`（A8 自死锁）。
 */
async function writeNewHash(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
  hashed: string,
): Promise<boolean> {
  try {
    await deps.mutateUsers(async (snapshot) => {
      const record = snapshot.users.get(ctx.subject);
      if (record === undefined) {
        throw new Error(`user not found in users snapshot: ${ctx.subject}`);
      }
      if (!(await deps.verify(ctx.current, record.passwordHash))) {
        throw new Error(`users file changed concurrently: ${ctx.subject}`);
      }
      record.passwordHash = hashed;
      // B1（§10）：自助改密成功即清 must_change_password（P2 登录门不再立刻拦一次）。
      // 写盘侧对 false 不落盘，删除即「无该字段」；CLI `user passwd` 有意不清（运维重置通道）。
      if (record.mustChangePassword === true) delete record.mustChangePassword;
    });
    return true;
  } catch (error) {
    deps.limiter.recordFailure(ctx.ip, ctx.subject);
    deps.logger.error(`password change failed: ${safeError(error, ctx.secrets)}`);
    sendUnavailable(res);
    return false;
  }
}

/** 限速门（P10）：锁定 → retry-after 秒数；放行 → undefined。 */
function lockoutSeconds(deps: PasswordChangeDeps, ip: string, subject: string): number | undefined {
  const check = deps.limiter.check(ip, subject);
  return check.allowed ? undefined : check.retryAfterSeconds;
}

/**
 * 依赖抛出的 message 落盘前做**子串替换**：长度 ≥ 4 的请求明文（current/password/code）
 * 逐段换成 `[redacted]`，其余运维上下文原样保留（整段打码会把
 * `users file is locked by another process` 这类无关信息一起吞掉，N2）。
 * 1-3 字符的短 secret 不参与替换：它们几乎必然误伤正常文案，且单独出现不构成泄漏。
 */
function safeError(error: unknown, secrets: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  return message;
}
