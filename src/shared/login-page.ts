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
import {
  CARD_STYLE,
  SHIELD_SVG,
  EYE_OPEN_SVG,
  EYE_CLOSED_SVG,
  USER_ICON_SVG,
  LOCK_ICON_SVG,
  EYE_SCRIPT,
  CURSOR_SCRIPT,
} from "./login-assets.js";

/** 登录页文案字典：按浏览器语言返回中文或英文（默认英文）。 */
function loginStrings(lang: string | undefined) {
  const zh = lang === "zh";
  return {
    htmlLang: zh ? "zh" : "en",
    tokenTitle: zh ? "解锁" : "Unlock",
    tokenSubtitle: zh ? "请输入访问令牌继续" : "Enter your access token to continue",
    tokenLabel: zh ? "访问令牌" : "Access token",
    tokenPlaceholder: zh ? "粘贴令牌" : "Paste your token",
    tokenSubmit: zh ? "解锁" : "Unlock",
    passwordTitle: zh ? "登录" : "Sign in",
    passwordSubtitle: zh ? "欢迎回来，请登录以继续" : "Welcome back - sign in to continue",
    usernameLabel: zh ? "用户名" : "Username",
    usernamePlaceholder: zh ? "请输入用户名" : "Enter your username",
    passwordLabel: zh ? "密码" : "Password",
    passwordPlaceholder: zh ? "请输入密码" : "Enter your password",
    signInSubmit: zh ? "登录" : "Sign in",
    securedBy: "Secured by dsh-auth-gate",
    brandText: zh ? "探索未至之境" : "Into the Unknown",
  };
}

/**
 * 品牌标语片段（复刻 DeepSeek 官网 hero 排版：46px / 0.4em 字距 / #152443）。
 * 悬停动效由全局 blend 光标（.cursor-ring + data-cursor="blend"）承担。
 * 圆形光标以 mix-blend-mode: difference 扫过每个字符时逐字反色。
 */
function buildSloganHtml(brandText: string): string {
  return `<span class="slogan-text">${escapeHtml(brandText)}</span>`;
}

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
  }[];
  submitLabel: string;
  next: string;
  /** 品牌标语（完整 HTML 片段：静态内容 + 已转义文本，不含用户输入）。 */
  sloganHtml: string;
  htmlLang?: string | undefined;
  securedBy?: string | undefined;
  brandText?: string | undefined;
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
      const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" aria-label="${field.label}" required${autofocusAttr}>`;
      const icon = field.type === "password" ? LOCK_ICON_SVG : USER_ICON_SVG;
      const iconHtml = `<span class="field-icon">${icon}</span>`;
      if (field.type === "password") {
        return `<label class="field"><span class="input-wrap pw-wrap">${iconHtml}${input}<button type="button" class="eye" data-toggle="${field.id}" aria-label="Toggle password visibility" aria-pressed="false"><span class="eye-open">${EYE_OPEN_SVG}</span><span class="eye-closed" hidden>${EYE_CLOSED_SVG}</span></button></span></label>`;
      }
      return `<label class="field"><span class="input-wrap">${iconHtml}${input}</span></label>`;
    })
    .join("");
  return `<!doctype html>
<html lang="${options.htmlLang ?? "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${options.title}</title>
<style>${CARD_STYLE}</style>
</head>
<body>
<div class="bg" aria-hidden="true"></div>
<main class="card">
<div class="brand">${SHIELD_SVG}</div>
<p class="slogan slogan-${options.htmlLang === "zh" ? "zh" : "en"}" data-cursor="blend">${options.sloganHtml}</p>
<p class="subtitle">${options.subtitle}</p>
<form method="post" action="/auth/login">
<input type="hidden" name="next" value="${escapeHtml(options.next)}">
${errorHtml}${fieldsHtml}
<button type="submit">${options.submitLabel}</button>
</form>
</main>
<footer><a href="https://github.com/TecFancy/dsh-auth-gate" target="_blank" rel="noopener">${options.securedBy ?? "Secured by dsh-auth-gate"}</a></footer>
<div class="cursor-ring" aria-hidden="true"></div>
${EYE_SCRIPT}
${CURSOR_SCRIPT}
</body>
</html>
`;
}

/**
 * token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。
 */
export function loginPageHtml(next: string, error?: string, lang?: string): string {
  const s = loginStrings(lang);
  return renderLoginCard({
    title: s.tokenTitle,
    subtitle: s.tokenSubtitle,
    fields: [
      {
        id: "token",
        label: s.tokenLabel,
        name: "token",
        autocomplete: "current-password",
        placeholder: s.tokenPlaceholder,
        type: "password",
        autofocus: true,
      },
    ],
    submitLabel: s.tokenSubmit,
    sloganHtml: buildSloganHtml(s.brandText),
    htmlLang: s.htmlLang,
    securedBy: s.securedBy,
    brandText: s.brandText,
    next,
    error,
  });
}

/** password 模式登录页（P13）：username + password 两字段，同款卡片样式。 */
export function passwordLoginPageHtml(next: string, error?: string, lang?: string): string {
  const s = loginStrings(lang);
  return renderLoginCard({
    title: s.passwordTitle,
    subtitle: s.passwordSubtitle,
    fields: [
      {
        id: "username",
        label: s.usernameLabel,
        name: "username",
        autocomplete: "username",
        placeholder: s.usernamePlaceholder,
        type: "text",
      },
      {
        id: "password",
        label: s.passwordLabel,
        name: "password",
        autocomplete: "current-password",
        placeholder: s.passwordPlaceholder,
        type: "password",
        autofocus: true,
      },
    ],
    submitLabel: s.signInSubmit,
    sloganHtml: buildSloganHtml(s.brandText),
    htmlLang: s.htmlLang,
    securedBy: s.securedBy,
    brandText: s.brandText,
    next,
    error,
  });
}
