import { CARD_STYLE, EYE_CLOSED_SVG, EYE_OPEN_SVG, EYE_SCRIPT, SUBMIT_SCRIPT, TOTP_SCRIPT, } from "./login-page-assets.js";
import { escapeHtml } from "./html-escape.js";
import { PASSKEY_STYLE, passkeyLoginFragment, passkeyLoginScript, } from "./passkey-login.js";
import { LOGIN_PATH } from "../protocol/index.js";
/** host 只做安全帽：防超长头撑爆页面；视觉截断交给 CSS（ellipsis + title 全文）。 */
const HOST_MAX_LENGTH = 253;
/** 可选的页面片段：缺省/空串时一个字节都不注入，旧页面因此保持逐字不变。 */
function blockHtml(value) {
    return value === undefined || value === "" ? "" : `${value}\n`;
}
/** 渲染公共卡片骨架（kicker/host/错误槽/hint/表单/页脚），全部动态文本 HTML-escape。 */
function renderLoginCard(spec) {
    const opts = spec.options ?? {};
    const host = (opts.host ?? "").trim().slice(0, HOST_MAX_LENGTH);
    const hostHtml = host === ""
        ? ""
        : `<p class="host" title="${escapeHtml(host)}" dir="ltr"><span class="mark" aria-hidden="true"></span>${escapeHtml(host)}</p>`;
    const whoHtml = opts.who === undefined || opts.who === ""
        ? ""
        : `<p class="who">Signing in as ${escapeHtml(opts.who)}</p>`;
    // P1.1：原因提示（改密后跳回登录页时说明"为什么"）。排在 error 之前：两者同时出现
    // （理论上不会）时先读原因再读失败信息，比"先报错再祝贺"顺。
    const noticeHtml = opts.notice === undefined || opts.notice === ""
        ? ""
        : `<p class="notice" role="status">${escapeHtml(opts.notice)}</p>`;
    const errorHtml = spec.error === undefined
        ? ""
        : `<p class="error" id="err" role="alert">${escapeHtml(spec.error)}</p>`;
    const hintHtml = spec.hint === undefined ? "" : `<p class="hint">${escapeHtml(spec.hint)}</p>`;
    const fieldsHtml = spec.fields
        .map((field) => {
        const autofocusAttr = field.autofocus === true ? " autofocus" : "";
        const classAttr = field.className === undefined ? "" : ` class="${field.className}"`;
        const invalidAttr = spec.error !== undefined && field.invalid === true
            ? ' aria-invalid="true" aria-describedby="err"'
            : "";
        const extraAttr = field.attrs === undefined ? "" : ` ${field.attrs}`;
        const valueAttr = field.value === undefined || field.value === ""
            ? ""
            : ` value="${escapeHtml(field.value)}"`;
        const input = `<input id="${field.id}"${classAttr} type="${field.type}" name="${field.name}"${valueAttr} autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required${autofocusAttr}${invalidAttr}${extraAttr}>`;
        if (field.type === "password") {
            return `<div class="field"><label for="${field.id}">${field.label}</label><span class="pw">${input}<button type="button" class="eye" data-toggle="${field.id}" aria-label="Show password" aria-pressed="false"><span class="eye-open">${EYE_OPEN_SVG}</span><span class="eye-closed" hidden>${EYE_CLOSED_SVG}</span></button></span></div>`;
        }
        return `<div class="field"><label for="${field.id}">${field.label}</label>${input}</div>`;
    })
        .join("");
    const resetHtml = opts.resetHref === undefined
        ? ""
        : `<a class="back" href="${escapeHtml(opts.resetHref)}">Use a different account</a>`;
    // 缺省时逐字保持旧页面：不注入空行/空样式，既有页面快照断言不受影响。
    const styleHtml = spec.style ?? "";
    // 失败页标题前缀（可达性）：整页导航后已填充的 role="alert" 常不被读屏播报
    // （APG/MDN/ARIA19 一致），GOV.UK 的做法是让 <title> 先说 "Error:"。
    const docTitle = spec.error === undefined ? spec.title : `Error: ${spec.title}`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>${CARD_STYLE}${styleHtml}</style>
</head>
<body>
<main class="card">
<div class="head">
<h1 class="kicker">${escapeHtml(spec.kicker)}</h1>${hostHtml}${whoHtml}
</div>
<form method="post" action="${LOGIN_PATH}">
<input type="hidden" name="next" value="${escapeHtml(spec.next)}">
${noticeHtml}${errorHtml}${hintHtml}${fieldsHtml}
<button type="submit">${escapeHtml(spec.submitLabel)}</button>
</form>
${blockHtml(spec.afterForm)}${resetHtml}
<p class="meta"><a href="https://github.com/TecFancy/dsh-auth-gate" target="_blank" rel="noopener">Secured by dsh-auth-gate</a></p>
</main>
${spec.script ?? EYE_SCRIPT}
</body>
</html>
`;
}
/** token 模式登录页：单字段（共享访问令牌），恒时校验由端点负责。 */
export function loginPageHtml(next, error, options) {
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
export function passwordLoginPageHtml(next, error, options) {
    const username = options?.username ?? "";
    // passkey 入口默认不渲染（缺省/未启用时页面与旧版逐字相同）；条件 UI 开启时
    // 用户名框加 `webauthn` autocomplete 提示，凭据才会出现在浏览器的自动填充里。
    const passkey = options?.passkey;
    const passkeyEnabled = passkey?.enabled === true;
    const conditionalUi = passkeyEnabled && passkey?.conditionalUi === true;
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
                autocomplete: conditionalUi ? "username webauthn" : "username",
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
        script: EYE_SCRIPT + SUBMIT_SCRIPT + (passkeyEnabled ? passkeyLoginScript(conditionalUi) : ""),
        style: passkeyEnabled ? PASSKEY_STYLE : undefined,
        afterForm: passkey === undefined ? undefined : passkeyLoginFragment(next, passkey),
    });
}
/** TOTP 挑战页（M4 T6）：单验证码字段，两段式登录第二段。 */
export function totpChallengePageHtml(next, error, options) {
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
                attrs: 'inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocapitalize="off" spellcheck="false"',
            },
        ],
        submitLabel: "Verify",
        next,
        error,
        options,
        script: TOTP_SCRIPT,
    });
}
//# sourceMappingURL=login-page.js.map