/**
 * 登录失败页渲染（D20）：把「错凭据 / 锁定」两类失败从 `text/plain` 裸文本改为登录卡片
 * HTML（error slot），让浏览器表单能看见错误而不是落进空白页。状态码保持 401 / 429 不变
 * （P9/P14），文案只允许常量或由 `retry-after` 整数生成的模板，绝不读 query、绝不反射
 * 请求文本（防开放重定向式任意文案）。
 */
import type { ServerResponse } from "node:http";
import { loginPath, passwordLoginPageHtml, totpChallengePageHtml } from "../../shared/index.js";

/** 未知用户 / 错口令 / 禁用三态共用的唯一常量（P9 反枚举）。 */
export const INVALID_CREDENTIALS = "Invalid username or password.";

/**
 * TOTP 第二段拒绝的唯一常量（D21）：错码、重放码、账号已无 secret 三态共用。
 * 不复用 `INVALID_CREDENTIALS`：走到这一步口令是对的，说「用户名或密码错」会指向错误的
 * 手因；也不能细分重放/过期/漂移，否则等于给攻击者一个反馈探针。
 */
export const INVALID_TOTP_CODE = "Invalid or expired code.";

/**
 * 锁定文案（429）：按「这个网络」而非「你的账号」陈述，桶按客户端 IP（#82）时不会指控错人；
 * 不显示剩余次数，也不承诺自助重置（本产品没有）。
 */
export function lockoutMessage(retryAfterSeconds: number): string {
  const unit = retryAfterSeconds === 1 ? "second" : "seconds";
  return (
    "Too many sign-in attempts from this network. " +
    `Try again in ${retryAfterSeconds} ${unit}. ` +
    "There is no password reset, so ask the instance owner if you are stuck."
  );
}

export interface FailurePageContext {
  /** 反钓鱼身份块 host（D14）。 */
  host: string;
  /** 校验过的 next（登录成功后的目标）。 */
  next: string;
  /** 用户刚提交的用户名（已 trim）；无条件回填，避免「只有真用户才回填」的枚举侧通道。 */
  username: string;
}

/** 401 错凭据：HTML 卡片 + error slot（用户名回填、密码必然为空）。 */
export function sendInvalidCredentials(res: ServerResponse, ctx: FailurePageContext): void {
  sendHtml(
    res,
    401,
    passwordLoginPageHtml(ctx.next, INVALID_CREDENTIALS, {
      host: ctx.host,
      username: ctx.username,
    }),
  );
}

/** 429 密码段：同一张卡片 + 锁定文案（静态秒数；按钮保持可用，无 JS 也能重试）。 */
export function sendLockout(
  res: ServerResponse,
  ctx: FailurePageContext,
  retryAfterSeconds: number,
): void {
  res.setHeader("retry-after", String(retryAfterSeconds));
  sendHtml(
    res,
    429,
    passwordLoginPageHtml(ctx.next, lockoutMessage(retryAfterSeconds), {
      host: ctx.host,
      username: ctx.username,
    }),
  );
}

/** 429 TOTP 段：挑战卡 + 锁定文案（挑战 cookie 保留，窗口过后可继续同一账号）。 */
export function sendTotpLockout(
  res: ServerResponse,
  ctx: FailurePageContext,
  retryAfterSeconds: number,
): void {
  res.setHeader("retry-after", String(retryAfterSeconds));
  sendHtml(
    res,
    429,
    totpChallengePageHtml(ctx.next, lockoutMessage(retryAfterSeconds), {
      host: ctx.host,
      who: ctx.username,
      resetHref: loginPath(ctx.next, "password"),
    }),
  );
}

/** 统一写出：no-store 必须在 writeHead 之前（headers sent 之后再 setHeader 会抛 ERR_HTTP_HEADERS_SENT）。 */
function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}
