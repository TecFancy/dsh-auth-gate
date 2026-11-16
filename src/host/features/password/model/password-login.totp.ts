/**
 * `POST /auth/login` 的 TOTP 挑战提交分支（M4 T6），从 `password-login.ts` 拆出守住 250 行上限。
 *
 * 这条路径**不经过密码校验**：只要手里有合法的挑战 cookie（HMAC 签名、5 分钟有效）加一个正确
 * 验证码，就能直接换会话。因此它是 passkey-only 策略必须单独拦的第二条入口 - `handlePasswordLogin`
 * 在分流之前就按 `passwordLoginDisabled` 拒绝，本文件因此只在口令可用时被调用。
 */
import type { ServerResponse } from "node:http";
import { totpChallengePageHtml } from "../../../shared/login-page/index.js";
import { loginPath } from "../../../shared/protocol/index.js";
import { buildSetCookie } from "../../../entities/session/index.js";
import { issueLoginSession } from "./session-issue.js";
import { INVALID_TOTP_CODE, sendTotpLockout } from "../ui/login-failure-pages.js";
import { CHALLENGE_COOKIE } from "./challenge-cookie.js";
import { loadUsersOr503, requireStore } from "./login-store.js";
import type { PasswordLoginDeps } from "./password-login.js";

/** TOTP 挑战提交：限速 → 用户文件 → 恒时验证 → 防重放 → 禁用检查 → 发会话。 */
export async function handleTotpSubmit(
  deps: PasswordLoginDeps,
  host: string,
  res: ServerResponse,
  username: string,
  code: string,
  next: string,
  ip: string,
): Promise<void> {
  const lockout = deps.limiter.check(ip, username);
  if (!lockout.allowed) {
    sendTotpLockout(res, { host, next, username }, lockout.retryAfterSeconds);
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
