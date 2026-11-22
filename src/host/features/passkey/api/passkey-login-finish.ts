/**
 * passkey 登录 finish 端点：受理（限速占位）→ 存储检查 → **先删后验**地消费 ceremony →
 * 字段校验 → 凭据查找（未命中做等量工作）→ 验签 + 策略 → 注入 `issueSession` 签发 302。
 * 401 恒为同一张卡片与常量文案；原因码只进日志。受限/正式会话由注入实现决定。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "../../../entities/session/index.js";
import type { UserRecord, UsersLoadResult } from "../../../entities/user/index.js";
import {
  methodNotAllowed,
  parseFormBody,
  setPasskeyPermissionsPolicy,
} from "../../../shared/http/index.js";
import {
  combineAdmissions,
  type Admission,
  type LoginRateLimiter,
} from "../../../shared/rate-limit/index.js";
import { clearCeremonyCookie, readCeremonyId } from "../model/ceremony-cookie.js";
import type { CeremonyStore } from "../model/ceremony-store.js";
import {
  findPasskeyCredential,
  PasskeyCounterStore,
  readPasskeyAssertion,
  type PasskeyCredentialMatch,
  type PasskeyLoginSettings,
} from "../model/passkey-login.js";
import { runDummyVerification, verifyPasskeyAssertion } from "./passkey-assertion-verify.js";
import { completeLogin, rejectLogin } from "./passkey-login-complete.js";
import {
  challengeOf,
  failureContext,
  loadUsersOr503,
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
  /**
   * 口令登录是否被策略关闭（`passkey: "required"`）：只影响失败卡的形状与文案 - passkey-only
   * 下那张卡上没有口令表单，也不能再写「改用密码」。
   */
  readonly passwordLoginDisabled?: boolean | undefined;
  readonly logger: {
    error(message: unknown): void;
    warn(message: unknown): void;
    info(message: unknown): void;
  };
}

/** 一次已通过传输层检查的登录请求。 */
interface LoginRequest {
  readonly params: URLSearchParams;
  readonly store: SessionStore;
  readonly context: PasskeyFailureContext;
  readonly loaded: UsersLoadResult;
  readonly admission: Admission;
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
  setPasskeyPermissionsPolicy(res);
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
  const context = failureContext(deps.publicHost, req, params, deps.passwordLoginDisabled);
  // 受理即占位（P1.3）：并发的断言尝试不能全部先看到「未锁定」。
  const admitted = deps.limiter.admit(ip, undefined, "passkey");
  if (!admitted.admitted) {
    sendPasskeyLocked(res, context, admitted.retryAfterSeconds);
    deps.logger.info("passkey login rate limited");
    return;
  }
  try {
    await runLogin(deps, counters, req, res, { params, context, admission: admitted.admission });
  } finally {
    admitted.admission.settle("abandon"); // 已结算时是空操作
  }
}

/** 受理之后的存储检查与 ceremony 消费；503 出口不结算失败（不烧在途 ceremony）。 */
async function runLogin(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  req: IncomingMessage,
  res: ServerResponse,
  input: { params: URLSearchParams; context: PasskeyFailureContext; admission: Admission },
): Promise<void> {
  // 503 在 consume 之前：会话层/用户存储未就绪不得烧掉用户的在途 ceremony（可原样重试）。
  const store = deps.sessions();
  if (store === undefined) {
    sendPasskeyUnavailable(res);
    deps.logger.error("passkey login failed: session store unavailable");
    return;
  }
  // 用户快照也在 consume 之前读：瞬时读盘失败不该把 ceremony 烧掉（§5.6）。
  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return;
  await finishLogin(deps, counters, req, res, { ...input, store, loaded });
}

/** 消费 ceremony 并校验断言（先删后验：重放与并发只剩第一次能看到记录）。 */
async function finishLogin(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  req: IncomingMessage,
  res: ServerResponse,
  input: LoginRequest,
): Promise<void> {
  const { params, store, context, loaded, admission } = input;
  const ceremony = deps.ceremony.consume(readCeremonyId(req.headers.cookie) ?? "");
  const clearCookie = clearCeremonyCookie(deps.cookieSecure);
  if (ceremony?.kind !== "login") {
    rejectLogin(
      deps,
      res,
      undefined,
      context,
      "ceremony missing or expired",
      clearCookie,
      admission,
    );
    return;
  }
  const assertion = readPasskeyAssertion(params);
  if (assertion === undefined) {
    rejectLogin(deps, res, undefined, context, "malformed assertion", clearCookie, admission);
    return;
  }
  const match = findPasskeyCredential(loaded.snapshot, assertion.id);
  if (match === undefined || match.user.disabled) {
    await runDummyVerification({
      settings: deps.settings,
      assertion,
      challenge: challengeOf(ceremony),
    });
    const reason = match === undefined ? "unknown credential" : "disabled user";
    rejectLogin(deps, res, match?.username, context, reason, clearCookie, admission);
    return;
  }
  const storedCounter = counters.stored(match.record);
  // 解析出用户名后补一道账号闸：只占过 IP 的话，换 IP 就能绕开该账号的失败计数。
  const accountGate = deps.limiter.admitAccount(match.username, "passkey");
  if (!accountGate.admitted) {
    sendPasskeyLocked(res, context, accountGate.retryAfterSeconds);
    deps.logger.info("passkey login rate limited");
    return;
  }
  const attempt = combineAdmissions(admission, accountGate.admission);
  await verifyAndComplete(deps, counters, res, {
    attempt,
    match,
    assertion,
    challenge: challengeOf(ceremony),
    storedCounter,
    store,
    context,
    clearCookie,
  });
}

/** 验签 + 并发计数器复核 + 签发；`finally` 兜底释放账号占位（验证抛错也不泄漏）。 */
async function verifyAndComplete(
  deps: PasskeyLoginFinishDeps,
  counters: PasskeyCounterStore,
  res: ServerResponse,
  input: {
    readonly attempt: Admission;
    readonly match: PasskeyCredentialMatch;
    readonly assertion: NonNullable<ReturnType<typeof readPasskeyAssertion>>;
    readonly challenge: string;
    readonly storedCounter: number;
    readonly store: SessionStore;
    readonly context: PasskeyFailureContext;
    readonly clearCookie: string;
  },
): Promise<void> {
  const { attempt, match, assertion, challenge, storedCounter, store, context, clearCookie } =
    input;
  try {
    const verdict = await verifyPasskeyAssertion({
      settings: deps.settings,
      match,
      assertion,
      challenge,
      storedCounter,
    });
    if (!verdict.ok) {
      rejectLogin(deps, res, match.username, context, verdict.reason, clearCookie, attempt);
      return;
    }
    // 并发断言：验证期间同一凭据已被推进过 ⇒ 这一条基于过期计数器，按重放拒绝（P2 L13）。
    // 判定与下面的 advance 之间没有 await，Node 单线程下是原子的。
    if (!counters.isCurrent(match.record, storedCounter)) {
      rejectLogin(
        deps,
        res,
        match.username,
        context,
        "counter advanced concurrently",
        clearCookie,
        attempt,
      );
      return;
    }
    await completeLogin(deps, counters, res, {
      admission: attempt,
      match,
      verdict,
      store,
      next: context.next,
      clearCookie,
    });
  } finally {
    attempt.settle("abandon"); // 已结算时是空操作；验证抛错也释放账号占位
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
