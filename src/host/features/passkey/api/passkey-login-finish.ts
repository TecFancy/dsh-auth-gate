/**
 * passkey 登录 finish 端点（隐藏表单 POST）的实现：限速 → 会话存储检查 → **先删后验**地
 * 消费 ceremony → 字段校验 → 全局凭据查找（未命中做等量工作）→ 库验签 + 业务策略 →
 * 注入 `issueSession` 签发 302。
 *
 * 401 恒为同一张登录卡片 + 同一常量文案；原因码只进日志，绝不回显断言内容。会话的
 * 受限/正式分支由注入的 `issueSession` 决定，这里不重复实现。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../../../entities/user/index.js";
import {
  methodNotAllowed,
  parseFormBody,
  resolvePublicHost,
  validateNext,
} from "../../../shared/http/index.js";
import type { LoginRateLimiter } from "../../../shared/rate-limit/index.js";
import { clearCeremonyCookie, readCeremonyId } from "../model/ceremony-cookie.js";
import type { CeremonyRecord, CeremonyStore } from "../model/ceremony-store.js";
import {
  findPasskeyCredential,
  PasskeyCounterStore,
  readPasskeyAssertion,
  type PasskeyCredentialMatch,
  type PasskeyLoginSettings,
} from "../model/passkey-login.js";
import {
  runDummyVerification,
  verifyPasskeyAssertion,
  type AssertionVerdict,
} from "./passkey-assertion-verify.js";
import {
  sendPasskeyFailure,
  sendPasskeyLocked,
  sendPasskeyUnavailable,
  type PasskeyFailureContext,
} from "./passkey-login-failures.js";

/** finish 端点需要的依赖子集（`PasskeyLoginDeps` 在此基础上只多一个 `register`）。 */
export interface PasskeyLoginFinishDeps {
  readonly sessions: () => SessionStore | undefined;
  readonly cookieSecure: boolean;
  readonly ceremony: CeremonyStore;
  readonly settings: PasskeyLoginSettings;
  readonly publicHost: string;
  readonly loadUsers: () => Promise<UsersLoadResult>;
  readonly clientIp: (req: IncomingMessage) => string;
  readonly limiter: LoginRateLimiter;
  readonly issueSession: (
    res: ServerResponse,
    store: SessionStore,
    username: string,
    next: string,
    user: UserRecord,
    extraSetCookie: string[],
  ) => Promise<void>;
  readonly logger: {
    error(message: unknown): void;
    warn(message: unknown): void;
    info(message: unknown): void;
  };
  /** 时钟（epoch ms）；留给后续审计/节流用，当前实现不读它。 */
  readonly now: () => number;
}

/** 一次已通过传输层检查的登录请求。 */
interface LoginRequest {
  readonly params: URLSearchParams;
  readonly store: SessionStore;
  readonly ip: string;
  readonly context: PasskeyFailureContext;
}

/**
 * finish 主流程：405 → 415/413 → 429（先于 ceremony）→ 503（先于 consume）→ 消费 ceremony
 * → 断言字段校验 → 用户文件 → 校验 → 签发。所有响应写完才返回。
 */
export async function handlePasskeyLogin(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    methodNotAllowed(res, "POST");
    return;
  }
  let params: URLSearchParams;
  try {
    params = await parseFormBody(req);
  } catch (error) {
    respondFormError(res, error);
    return;
  }
  const ip = deps.clientIp(req);
  const context = failureContext(deps, req, params);
  const lockout = deps.limiter.check(ip, undefined);
  if (!lockout.allowed) {
    sendPasskeyLocked(res, context, lockout.retryAfterSeconds);
    deps.logger.info("passkey login rate limited");
    return;
  }
  // 503 在 consume 之前：会话层未就绪不得烧掉用户的在途 ceremony（可原样重试）。
  const store = deps.sessions();
  if (store === undefined) {
    sendPasskeyUnavailable(res);
    deps.logger.error("passkey login failed: session store unavailable");
    return;
  }
  await finishLogin(deps, counters, req, res, { params, store, ip, context });
}

/** 消费 ceremony 并校验断言（先删后验：重放与并发只剩第一次能看到记录）。 */
async function finishLogin(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  req: IncomingMessage,
  res: ServerResponse,
  input: LoginRequest,
): Promise<void> {
  const { params, store, ip, context } = input;
  const ceremony = deps.ceremony.consume(readCeremonyId(req.headers.cookie) ?? "");
  const clearCookie = clearCeremonyCookie(deps.cookieSecure);
  if (ceremony?.kind !== "login") {
    rejectLogin(deps, res, ip, undefined, context, "ceremony missing or expired", clearCookie);
    return;
  }
  const assertion = readPasskeyAssertion(params);
  if (assertion === undefined) {
    rejectLogin(deps, res, ip, undefined, context, "malformed assertion", clearCookie);
    return;
  }
  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return;
  const match = findPasskeyCredential(loaded.snapshot, assertion.id);
  if (match === undefined || match.user.disabled) {
    await runDummyVerification({
      settings: deps.settings,
      assertion,
      challenge: challengeOf(ceremony),
    });
    const reason = match === undefined ? "unknown credential" : "disabled user";
    rejectLogin(deps, res, ip, match?.username, context, reason, clearCookie);
    return;
  }
  const verdict = await verifyPasskeyAssertion({
    settings: deps.settings,
    match,
    assertion,
    challenge: challengeOf(ceremony),
    storedCounter: counters.stored(match.record),
  });
  if (!verdict.ok) {
    rejectLogin(deps, res, ip, match.username, context, verdict.reason, clearCookie);
    return;
  }
  await completeLogin(deps, counters, res, {
    match,
    verdict,
    store,
    ip,
    next: context.next,
    clearCookie,
  });
}

/** 成功路径：推进进程内计数器 → 清失败桶 → 注入 issueSession（受限语义由注入实现继承）。 */
async function completeLogin(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  res: ServerResponse,
  input: {
    readonly match: PasskeyCredentialMatch;
    readonly verdict: Extract<AssertionVerdict, { ok: true }>;
    readonly store: SessionStore;
    readonly ip: string;
    readonly next: string;
    readonly clearCookie: string;
  },
): Promise<void> {
  const { match, verdict, store, ip, next, clearCookie } = input;
  if (verdict.warn !== undefined) {
    deps.logger.warn(
      `passkey login: counter regression allowed for ${match.username} ` +
        `(credential ${match.record.credentialId.slice(0, 8)})`,
    );
  }
  counters.advance(match.record, verdict.newCounter);
  deps.limiter.recordSuccess(ip, match.username);
  await deps.issueSession(res, store, match.username, next, match.user, [clearCookie]);
  deps.logger.info(
    `passkey login succeeded: ${match.username} (credential ${match.record.credentialId.slice(0, 8)})`,
  );
}

/** 统一拒绝：计失败（已知用户按用户名桶，未知/伪凭据只按 IP）+ 401 卡片。 */
function rejectLogin(
  deps: PasskeyLoginFinishDeps,
  res: ServerResponse,
  ip: string,
  username: string | undefined,
  context: PasskeyFailureContext,
  reason: string,
  clearCookie: string,
): void {
  deps.limiter.recordFailure(ip, username);
  deps.logger.warn(`passkey login rejected: ${reason}`);
  sendPasskeyFailure(res, context, clearCookie);
}

/** 失败页上下文：反钓鱼 host 来自配置（回退请求头 Host）+ 消毒后的 next。 */
function failureContext(
  deps: PasskeyLoginFinishDeps,
  req: IncomingMessage,
  params: URLSearchParams,
): PasskeyFailureContext {
  return {
    host: resolvePublicHost(deps.publicHost, req.headers.host),
    next: validateNext(params.get("next") ?? "/"),
  };
}

/** ceremony 的 32 字节 challenge → 库要的 base64url（与 options 响应里的值逐字一致）。 */
function challengeOf(ceremony: CeremonyRecord): string {
  return Buffer.from(ceremony.challenge).toString("base64url");
}

/** 用户文件不可用 → 503（与口令登录同形；不算失败、不消费 ceremony 之后的状态）。 */
async function loadUsersOr503(
  deps: PasskeyLoginFinishDeps,
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

/** 415/413 响应（与口令登录同形：413 先写 `connection: close`）；无 status 的异常向上抛。 */
function respondFormError(res: ServerResponse, error: unknown): void {
  const failed = error as { status?: number; message?: string };
  if (typeof failed.status !== "number") throw error;
  res.setHeader("cache-control", "no-store");
  if (failed.status === 413) res.setHeader("connection", "close");
  res.writeHead(failed.status, { "content-type": "text/plain" });
  res.end(failed.message ?? "bad request");
}
