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

/**
 * 登录卡片样式（token/password 两版共用；零第三方资源、无外部字体）。
 * 视觉语言参考 DeepSeek 登录页：居中白卡片、渐变品牌图标、圆角输入框 +
 * focus ring、全宽主按钮、密码可见切换（渐进增强：无 JS 时按钮无副作用）。
 */
const CARD_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; background: #f7f8fa; margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
  .card { background: #fff; border: 1px solid #e4e6eb; border-radius: 16px; padding: 36px 32px 32px; width: 360px; max-width: 100%; box-shadow: 0 4px 24px rgb(0 0 0 / 6%); }
  .brand { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #4d6bfe, #7c5cff); color: #fff; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
  .brand svg { width: 26px; height: 26px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 6px; text-align: center; }
  .subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; text-align: center; }
  .field { display: block; margin-bottom: 16px; }
  .label { display: block; font-size: 13px; font-weight: 500; color: #4b5563; margin-bottom: 6px; }
  input { width: 100%; height: 44px; padding: 0 14px; border: 1px solid #8a919a; border-radius: 10px; font-size: 14px; color: #1f2329; background: #fff; outline: none; transition: border-color .15s, box-shadow .15s; }
  input:focus { border-color: #4d6bfe; box-shadow: 0 0 0 3px rgb(77 107 254 / 15%); }
  input::placeholder { color: #7d8590; }
  .pw-wrap { position: relative; }
  .pw-wrap input { padding-right: 44px; }
  .eye { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border: 0; background: none; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #6b7280; }
  .eye:hover { background: #f2f3f5; }
  .eye svg { width: 18px; height: 18px; }
  button[type=submit] { width: 100%; height: 44px; border: 0; border-radius: 10px; background: #4059e0; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 4px; transition: background .15s, transform .05s; }
  button[type=submit]:hover { background: #34479c; }
  button[type=submit]:active { transform: scale(.99); }
  .error { color: #b91c1c; font-size: 13px; font-weight: 500; margin: 0 0 16px; padding: 10px 12px; background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; text-align: left; }
  footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
  footer a { color: #6b7280; text-decoration: none; }
  footer a:hover { color: #4b5563; text-decoration: underline; }
  button[type=submit]:focus-visible, .eye:focus-visible { outline: none; box-shadow: 0 0 0 3px rgb(77 107 254 / 30%); }
  footer a:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { input, button[type=submit] { transition: none; } button[type=submit]:active { transform: none; } }
  @media (max-width: 420px) { .card { padding: 28px 20px; } }
`;

const SHIELD_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>';

const EYE_OPEN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_CLOSED_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/**
 * 密码可见切换（渐进增强：无 JS 时按钮无副作用，表单照常工作）。
 * 只依赖 data-toggle → 对应 input id；无第三方资源。
 */
const EYE_SCRIPT = `
<script>
(function () {
  var buttons = document.querySelectorAll("[data-toggle]");
  for (var i = 0; i < buttons.length; i++) (function (btn) {
    btn.addEventListener("click", function () {
      var input = document.getElementById(btn.getAttribute("data-toggle"));
      if (!input) return;
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      btn.querySelector(".eye-open").hidden = !show;
      btn.querySelector(".eye-closed").hidden = show;
    });
  })(buttons[i]);
})();
</script>
`;

interface LoginCardOptions {
  title: string;
  subtitle: string;
  /** 每个字段：id/label/name/autocomplete/placeholder/type；password 字段自动带眼睛。 */
  fields: {
    id: string;
    label: string;
    name: string;
    autocomplete: string;
    placeholder: string;
    type: "text" | "password";
    /** M2 §4.4 / M3 P13 冻结要求：token 字段与 password 表单的密码字段需要它。 */
    autofocus?: boolean;
    /** 附加 HTML 属性字符串（原样拼入 input 标签；调用方保证转义）。 */
    attrs?: string;
  }[];
  submitLabel: string;
  next: string;
  /** 显式允许 undefined：公开函数透传 `error?: string`（exactOptionalPropertyTypes）。 */
  error?: string | undefined;
}

/** 渲染公共卡片骨架（标题/品牌/表单/页脚），next 与 error 全部 HTML-escape。 */
function renderLoginCard(options: LoginCardOptions): string {
  const errorHtml =
    options.error === undefined ? "" : `<p class="error">${escapeHtml(options.error)}</p>`;
  const fieldsHtml = options.fields
    .map((field) => {
      const autofocusAttr = field.autofocus === true ? " autofocus" : "";
      const extraAttr = field.attrs === undefined ? "" : ` ${field.attrs}`;
      const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required${autofocusAttr}${extraAttr}>`;
      if (field.type === "password") {
        return `<label class="field"><span class="label">${field.label}</span><span class="pw-wrap">${input}<button type="button" class="eye" data-toggle="${field.id}" aria-label="Toggle password visibility" aria-pressed="false"><span class="eye-open">${EYE_OPEN_SVG}</span><span class="eye-closed" hidden>${EYE_CLOSED_SVG}</span></button></span></label>`;
      }
      return `<label class="field"><span class="label">${field.label}</span>${input}</label>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<style>${CARD_STYLE}</style>
</head>
<body>
<main class="card">
<div class="brand">${SHIELD_SVG}</div>
<h1>${options.title}</h1>
<p class="subtitle">${options.subtitle}</p>
<form method="post" action="/auth/login">
<input type="hidden" name="next" value="${escapeHtml(options.next)}">
${errorHtml}${fieldsHtml}
<button type="submit">${options.submitLabel}</button>
</form>
</main>
<footer><a href="https://github.com/TecFancy/dsh-auth-gate" target="_blank" rel="noopener">Secured by dsh-auth-gate</a></footer>
${EYE_SCRIPT}
</body>
</html>
`;
}

/**
 * token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。
 */
export function loginPageHtml(next: string, error?: string): string {
  return renderLoginCard({
    title: "Unlock",
    subtitle: "Enter your access token to continue",
    fields: [
      {
        id: "token",
        label: "Access token",
        name: "token",
        autocomplete: "current-password",
        placeholder: "Paste your token",
        type: "password",
        autofocus: true,
      },
    ],
    submitLabel: "Unlock",
    next,
    error,
  });
}

/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export function passwordLoginPageHtml(next: string, error?: string): string {
  return renderLoginCard({
    title: "Sign in",
    subtitle: "Welcome back - sign in to continue",
    fields: [
      {
        id: "username",
        label: "Username",
        name: "username",
        autocomplete: "username",
        placeholder: "Enter your username",
        type: "text",
      },
      {
        id: "password",
        label: "Password",
        name: "password",
        autocomplete: "current-password",
        placeholder: "Enter your password",
        type: "password",
        autofocus: true,
      },
    ],
    submitLabel: "Sign in",
    next,
    error,
  });
}

/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export function totpChallengePageHtml(next: string, error?: string): string {
  return renderLoginCard({
    title: "Verify",
    subtitle: "Enter the 6-digit code from your authenticator app",
    fields: [
      {
        id: "code",
        label: "Verification code",
        name: "code",
        autocomplete: "one-time-code",
        placeholder: "000000",
        type: "text",
        autofocus: true,
        attrs: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}"',
      },
    ],
    submitLabel: "Verify",
    next,
    error,
  });
}
