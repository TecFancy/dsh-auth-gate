import type { IncomingMessage, ServerResponse } from "node:http";
import { type UsersLoadResult, type UsersSnapshot } from "../../../entities/user/index.js";
import {
  checkRequestOrigin,
  formField,
  methodNotAllowed,
  parseCookieHeader,
  parseFormBody,
} from "../../../shared/http/index.js";
import type { PasswordChangeRequest } from "../../../shared/protocol/index.js";
import { type Admission, type LoginRateLimiter } from "../../../shared/rate-limit/index.js";
import { type Session, type SessionStore } from "../../../entities/session/index.js";
import { runAdmitted } from "./password-change.submit.js";
import { handlePasswordChangePage, respondFormError, sendJson } from "../ui/password-change.ssr.js";

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

/** 每次请求的日志安全上下文：错误消息里出现任一请求明文即整段打码。 */
export interface ChangeContext {
  ip: string;
  subject: string;
  /** 现口令明文：只用于锁内复核（A6），绝不入日志。 */
  current: string;
  secrets: readonly string[];
  /** 本次尝试的受理句柄（P2：check→await→record 之间不再留并发窗口）。 */
  admission: Admission;
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

  // 请求字段**不 trim 不截断**：口令按原始码点判定。
  const current = formField<PasswordChangeRequest>(params, "current");
  const newPassword = formField<PasswordChangeRequest>(params, "password");
  const code = formField<PasswordChangeRequest>(params, "code");
  const subject = locateSession(deps, req)?.subject;
  if (subject === undefined) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  const ip = clientIpOf(deps, req);
  const admitted = deps.limiter.admit(ip, subject, "password-change");
  if (!admitted.admitted) {
    deps.logger.info("rate limit exceeded");
    res.setHeader("retry-after", String(admitted.retryAfterSeconds));
    sendJson(res, 429, { error: "locked", retryAfter: admitted.retryAfterSeconds });
    return;
  }
  const ctx: ChangeContext = {
    ip,
    subject,
    current,
    secrets: [current, newPassword, code],
    admission: admitted.admission,
  };
  try {
    await runAdmitted(deps, res, ctx, params, newPassword, code);
  } finally {
    admitted.admission.settle("abandon"); // 已结算时是空操作；503/异常只释放占位
  }
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

/**
 * 会话定位：只认 cookie（M5），Bearer 不参与；store/token 无效或类别不在白名单 → undefined。
 * 白名单（G12 allow-list）只放行正式会话与「只能改密」的受限会话；bootstrap 会话与
 * 将来新增的 kind 默认都不许改密。旧行没有 `kind`，会话层语义按 full 处理。
 */
function locateSession(deps: PasswordChangeDeps, req: IncomingMessage): Session | undefined {
  const store = deps.sessions();
  const token = parseCookieHeader(req.headers.cookie, deps.cookieName);
  if (store === undefined || token === undefined || token === "") return undefined;
  const session = store.getByToken(token);
  return ["full", "password-change-only"].includes(session?.kind ?? "full") ? session : undefined;
}

/** D19：注入的解析器（受信反代 IP 头）优先，缺省回退 socket 地址。 */
function clientIpOf(deps: PasswordChangeDeps, req: IncomingMessage): string {
  return deps.clientIp?.(req) ?? req.socket.remoteAddress ?? "";
}
