import {
  CARD_STYLE,
  EYE_CLOSED_SVG,
  EYE_OPEN_SVG,
  EYE_SCRIPT,
  SUBMIT_SCRIPT,
  TOTP_SCRIPT,
} from "./login-page-assets.js";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** host 只做安全帽：防超长头撑爆页面；视觉截断交给 CSS（ellipsis + title 全文）。 */
const HOST_MAX_LENGTH = 253;

export interface LoginPageOptions {
  /** 当前实例的 origin/host（反钓鱼身份块）；空串或缺省时不渲染该行。 */
  host?: string | undefined;
  /** 已通过第一段的账号名（仅 TOTP 段拿得到），渲染为 "Signing in as ..."。 */
  who?: string | undefined;
  /** 「换一个账号」回退链接（仅 TOTP 段）；服务端需在该 GET 上清掉挑战 cookie。 */
  resetHref?: string | undefined;
  /**
   * 失败页回填的用户名（D20）：未知用户 / 错口令 / 禁用三态**同样回填**，
   * 否则「只有真用户才回填」本身就是账号存在性预言机。密码字段永不回填。
   */
  username?: string | undefined;
}

interface FieldSpec {
  id: string;
  label: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  type: "text" | "password";
  /** M2 §4.4 / M3 P13 冻结要求：token 字段与 password 表单的密码字段需要它。 */
  autofocus?: boolean;
  /** 表单级错误时标记该字段（密码/令牌/验证码），配 aria-describedby 指向错误槽。 */
  invalid?: boolean;
  /** 回填值（走 escapeHtml；仅非空时渲染 value，密码字段一律不设）。 */
  value?: string | undefined;
  /** 附加 HTML 属性字符串（原样拼入 input 标签；调用方保证转义）。 */
  attrs?: string;
  /** 额外 class（如 TOTP 的 code）。 */
  className?: string | undefined;
}

interface LoginCardOptions {
  /** 文档标题（<title>）。 */
  title: string;
  /** kicker 文案（<h1>）：Sign in / Two-factor。 */
  kicker: string;
  /** 副标题/hint 文案；缺省不渲染。 */
  hint?: string | undefined;
  /** 每个字段：id/label/name/autocomplete/placeholder/type。 */
  fields: FieldSpec[];
  submitLabel: string;
  next: string;
  /** 显式允许 undefined：公开函数透传 `error?: string`（exactOptionalPropertyTypes）。 */
  error?: string | undefined;
  options?: LoginPageOptions | undefined;
  /** 仅 TOTP 段注入的内联增强脚本。 */
  script?: string | undefined;
}

/** 渲染公共卡片骨架（kicker/host/错误槽/hint/表单/页脚），全部动态文本 HTML-escape。 */
function renderLoginCard(spec: LoginCardOptions): string {
  const opts = spec.options ?? {};
  const host = (opts.host ?? "").trim().slice(0, HOST_MAX_LENGTH);
  const hostHtml =
    host === ""
      ? ""
      : `<p class="host" title="${escapeHtml(host)}" dir="ltr"><span class="mark" aria-hidden="true"></span>${escapeHtml(host)}</p>`;
  const whoHtml =
    opts.who === undefined || opts.who === ""
      ? ""
      : `<p class="who">Signing in as ${escapeHtml(opts.who)}</p>`;
  const errorHtml =
    spec.error === undefined
      ? ""
      : `<p class="error" id="err" role="alert">${escapeHtml(spec.error)}</p>`;
  const hintHtml = spec.hint === undefined ? "" : `<p class="hint">${escapeHtml(spec.hint)}</p>`;
  const fieldsHtml = spec.fields
    .map((field) => {
      const autofocusAttr = field.autofocus === true ? " autofocus" : "";
      const classAttr = field.className === undefined ? "" : ` class="${field.className}"`;
      const invalidAttr =
        spec.error !== undefined && field.invalid === true
          ? ' aria-invalid="true" aria-describedby="err"'
          : "";
      const extraAttr = field.attrs === undefined ? "" : ` ${field.attrs}`;
      const valueAttr =
        field.value === undefined || field.value === ""
          ? ""
          : ` value="${escapeHtml(field.value)}"`;
      const input = `<input id="${field.id}"${classAttr} type="${field.type}" name="${field.name}"${valueAttr} autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required${autofocusAttr}${invalidAttr}${extraAttr}>`;
      if (field.type === "password") {
        return `<div class="field"><label for="${field.id}">${field.label}</label><span class="pw">${input}<button type="button" class="eye" data-toggle="${field.id}" aria-label="Show password" aria-pressed="false"><span class="eye-open">${EYE_OPEN_SVG}</span><span class="eye-closed" hidden>${EYE_CLOSED_SVG}</span></button></span></div>`;
      }
      return `<div class="field"><label for="${field.id}">${field.label}</label>${input}</div>`;
    })
    .join("");
  const resetHtml =
    opts.resetHref === undefined
      ? ""
      : `<a class="back" href="${escapeHtml(opts.resetHref)}">Use a different account</a>`;
  // 失败页标题前缀（可达性）：整页导航后已填充的 role="alert" 常不被读屏播报
  // （APG/MDN/ARIA19 一致），GOV.UK 的做法是让 <title> 先说 "Error:"。
  const docTitle = spec.error === undefined ? spec.title : `Error: ${spec.title}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>${CARD_STYLE}</style>
</head>
<body>
<main class="card">
<div class="head">
<h1 class="kicker">${escapeHtml(spec.kicker)}</h1>${hostHtml}${whoHtml}
</div>
<form method="post" action="/auth/login">
<input type="hidden" name="next" value="${escapeHtml(spec.next)}">
${errorHtml}${hintHtml}${fieldsHtml}
<button type="submit">${escapeHtml(spec.submitLabel)}</button>
</form>
${resetHtml}
<p class="meta"><a href="https://github.com/TecFancy/dsh-auth-gate" target="_blank" rel="noopener">Secured by dsh-auth-gate</a></p>
</main>
${spec.script ?? EYE_SCRIPT}
</body>
</html>
`;
}

/** token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。 */
export function loginPageHtml(next: string, error?: string, options?: LoginPageOptions): string {
  return renderLoginCard({
    title: "Sign in - dsh-auth-gate",
    kicker: "Sign in",
    hint: "Paste the access token issued by this instance's owner.",
    fields: [
      {
        id: "token",
        label: "Access token",
        name: "token",
        autocomplete: "current-password",
        placeholder: "Paste your token",
        type: "password",
        autofocus: true,
        invalid: true,
        attrs: 'spellcheck="false" autocapitalize="off"',
      },
    ],
    submitLabel: "Continue",
    next,
    error,
    options,
  });
}

/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export function passwordLoginPageHtml(
  next: string,
  error?: string,
  options?: LoginPageOptions,
): string {
  const username = options?.username ?? "";
  // 失败页焦点策略：用户名为空（空提交 / 手机上被 autofill 清掉）→ 焦点给用户名；
  // 否则给密码框（用户只需重敲密码，且 aria-describedby 会把错误一起读出来）。
  const focusUsername = error !== undefined && username.trim() === "";
  return renderLoginCard({
    title: "Sign in - dsh-auth-gate",
    kicker: "Sign in",
    hint: "Use the credentials issued by this instance's owner.",
    fields: [
      {
        id: "username",
        label: "Username",
        name: "username",
        autocomplete: "username",
        placeholder: "Enter your username",
        type: "text",
        autofocus: focusUsername,
        invalid: true,
        value: username,
        attrs: 'autocapitalize="off" spellcheck="false"',
      },
      {
        id: "password",
        label: "Password",
        name: "password",
        autocomplete: "current-password",
        placeholder: "Enter your password",
        type: "password",
        autofocus: !focusUsername,
        invalid: true,
      },
    ],
    submitLabel: "Continue",
    next,
    error,
    options,
    script: EYE_SCRIPT + SUBMIT_SCRIPT,
  });
}

/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export function totpChallengePageHtml(
  next: string,
  error?: string,
  options?: LoginPageOptions,
): string {
  return renderLoginCard({
    title: "Two-factor - dsh-auth-gate",
    kicker: "Two-factor",
    hint: "Enter the 6-digit code from your authenticator app.",
    fields: [
      {
        id: "code",
        label: "Verification code",
        name: "code",
        autocomplete: "one-time-code",
        placeholder: "000000",
        type: "text",
        autofocus: true,
        invalid: true,
        className: "code",
        attrs:
          'inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocapitalize="off" spellcheck="false"',
      },
    ],
    submitLabel: "Verify",
    next,
    error,
    options,
    script: TOTP_SCRIPT,
  });
}

/** 登录页 URL：带 next；`stage=password` 供 TOTP 段「换一个账号」回退（服务端清挑战 cookie）。 */
export function loginPath(next: string, stage?: "password"): string {
  const base = `/auth/login?next=${encodeURIComponent(next)}`;
  return stage === undefined ? base : `${base}&stage=${stage}`;
}
