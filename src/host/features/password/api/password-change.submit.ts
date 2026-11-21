/**
 * `/auth/password` 的受理后流水线（P1 §1）：读 users → 恒时验证旧口令 → TOTP → 策略 →
 * hash → 锁内写盘 → 撤销会话 → 响应。从 `password-change.ts` 拆出，守住单文件行数上限；
 * 限速受理（admit/settle）留在入口文件，本文件只负责"每条出口结算一次"。
 */
import type { ServerResponse } from "node:http";
import {
  applyPasswordChange,
  checkPasswordPolicy,
  type UserRecord,
  type UsersLoadResult,
} from "../../../entities/user/index.js";
import { formField } from "../../../shared/http/index.js";
import type { PasswordChangeRequest } from "../../../shared/protocol/index.js";
import { DUMMY_HASH } from "../lib/password.js";
import { respondChanged, sendJson, sendUnavailable } from "../ui/password-change.ssr.js";
import type { ChangeContext, PasswordChangeDeps } from "./password-change.js";

/** 文件缺失告警只触发一次（插件单实例，等价进程级一次，P7）。 */
let warnedMissing = false;

/** 受理之后的验证与写盘；失败出口结算 failure，未结算的出口由 finally 释放占位。 */
export async function runAdmitted(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
  params: URLSearchParams,
  newPassword: string,
  code: string,
): Promise<void> {
  // 读失败（含文件损坏/权限）不计失败：系统错误不该把用户锁在门外。
  const loaded = await loadUsersOr503(deps, res, ctx);
  if (loaded === undefined) return;

  const user = await authenticateCurrent(deps, loaded.snapshot.users.get(ctx.subject), ctx.current);
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

  ctx.admission.settle("success");
  // 已认证面的成功也清 IP 桶（与登录路径不同）：用户证明的是"自己是这个账号"，
  // 继续用 IP 桶把他锁在自己的改密表单外面没有安全收益。登录路径的成功不清 IP（P2）。
  deps.limiter.recordSuccess(ctx.ip, ctx.subject, "password-change");
  // 写盘已成功：撤销失败绝不改变 200/302 语义（口令确实改了），只进 error 日志。
  // TODO(auth-p2): 撤销失败不重试 ⇒ 由会话扫描器（仅在 revokeSweepMs > 0 时运行）或会话 TTL 兜底；
  // 扫描关闭时只剩 TTL，因此 CLI 的提示语必须把这个前提说出来。
  await deps.revoke(ctx.subject);
  // P2 §1 响应整形：SSR 无 JS 表单的隐藏字段，精确匹配 nav=1（绝不用 Accept 子串判定）。
  respondChanged(deps, res, formField<PasswordChangeRequest>(params, "nav") === "1");
  deps.logger.info("password changed");
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

/**
 * 4xx 拒绝统一口径：计失败 + 常量日志 + JSON body（明文永不入日志）。
 * body 形状同 `sendJson`，即跨半边契约的 `PasswordChangeErrorBody`（D31）。
 */
function reject(
  deps: PasswordChangeDeps,
  res: ServerResponse,
  ctx: ChangeContext,
  status: number,
  body: Parameters<typeof sendJson>[2],
): void {
  ctx.admission.settle("failure");
  deps.logger.info("password change rejected");
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
    ctx.admission.settle("failure");
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
      // L5：落新哈希 + passwordChangedAt（供扫描器在「立即吊销失败 / 插件随后重启」时兜底：
      // 它吊销 `createdAt < passwordChangedAt` 的会话，变更后签发的会话不受影响）。
      Object.assign(record, applyPasswordChange(record, hashed, deps.now()));
      // B1（§10）：自助改密成功即清 must_change_password（P2 登录门不再立刻拦一次）。
      // 写盘侧对 false 不落盘，删除即「无该字段」；CLI `user passwd` 有意不清（运维重置通道）。
      if (record.mustChangePassword === true) delete record.mustChangePassword;
    });
    return true;
  } catch (error) {
    ctx.admission.settle("failure");
    deps.logger.error(`password change failed: ${safeError(error, ctx.secrets)}`);
    sendUnavailable(res);
    return false;
  }
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
