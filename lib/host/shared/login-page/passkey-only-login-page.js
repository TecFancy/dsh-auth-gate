/**
 * passkey-only 登录页（`passkey: "required"`）：卡片里没有口令表单，只有通行密钥入口。
 *
 * 三条约束与口令卡同源：
 * - **无 JS 时不能是一张空卡**：按钮默认 `hidden`，由脚本在特性检测通过后显示；因此必须配
 *   `<noscript>` 说明「本实例要求通行密钥且需要 JavaScript」，否则关掉 JS 的用户看到的是
 *   一句提示加一片空白，不知道发生了什么。
 * - **零新增 CSS**：复用 `CARD_STYLE` 与 `PASSKEY_STYLE`（页面样式预算 6 KiB 已用掉 6121
 *   字节）。按钮因此沿用 `.passkey` 的描边次级样式，而不是口令卡的主按钮样式 - 这是预算
 *   换来的取舍，不是疏忽。
 * - **文案不反射请求**：错误槽只接受本文件的常量。
 */
import { PASSKEY_LOGIN_PATH } from "../protocol/index.js";
import { PASSKEY_STYLE, passkeyLoginScript } from "./passkey-login.js";
import { escapeHtml } from "./html-escape.js";
import { renderLoginCard } from "./login-page.js";
/** 卡片副标题：一句话说清「为什么没有密码框」。 */
export const PASSKEY_ONLY_HINT = "This instance requires a passkey. Use your device's biometrics or security key to sign in.";
/** 无 JS 时的说明（`<noscript>` 里）。 */
export const PASSKEY_ONLY_NOSCRIPT = "Passkey sign-in needs JavaScript. Enable it in this browser, or ask the instance owner to restore password sign-in.";
/** 失败文案：passkey-only 下没有「改用密码」这条退路，不能复用口令卡的文案。 */
export const PASSKEY_ONLY_ERROR_TEXT = "Passkey sign-in failed. Try again.";
/** 浏览器不支持 WebAuthn 时的说明（脚本特性检测失败后由 `<noscript>` 之外的静态块承担）。 */
export const PASSKEY_ONLY_UNSUPPORTED = "This browser does not support passkeys. Try a current version of Chrome, Safari, Edge or Firefox.";
/**
 * WebAuthn 配置失效时的诊断页（`passkey: "required"` 但 `publicHost`/RP ID/origin 不成立）。
 *
 * 这是 issue #133 第 4 点的落点：**配置坏了不恢复口令登录**，而是给一张能诊断的卡。`reason`
 * 是 `PasskeyDisabledReason` 的固定取值（不含配置原文），直接显示给运维看。
 */
export function passkeyOnlyUnavailablePageHtml(reason, options) {
    return renderLoginCard({
        title: "Sign in - dsh-auth-gate",
        kicker: "Sign in",
        hint: "This instance requires a passkey, but passkey sign-in is not available right now.",
        fields: [],
        submitLabel: "",
        next: "/",
        form: false,
        error: `Passkey configuration is unusable (${reason}). Password sign-in stays disabled. Ask the instance owner to fix the WebAuthn configuration or set passkey back to "optional".`,
        options,
    });
}
/**
 * passkey-only 登录卡：提示 + 隐藏按钮 + `<noscript>` + 固定错误槽 + 隐藏表单。
 *
 * `error` 只由调用方传本文件的常量（失败页复用同一张卡）。
 */
export function passkeyOnlyLoginPageHtml(next, error, options) {
    return renderLoginCard({
        title: "Sign in - dsh-auth-gate",
        kicker: "Sign in",
        hint: PASSKEY_ONLY_HINT,
        fields: [],
        submitLabel: "",
        next,
        form: false,
        ...(error === undefined ? {} : { error }),
        options,
        style: PASSKEY_STYLE,
        afterForm: passkeyOnlyFragment(next),
        script: passkeyLoginScript(false),
    });
}
/** 按钮 + 无 JS 说明 + 错误槽 + 隐藏表单（字段名与 `PasskeyAssertionRequest` 一一对应）。 */
function passkeyOnlyFragment(next) {
    return `<button type="button" class="passkey" id="passkey-btn" hidden>Sign in with a passkey</button>
<noscript><p class="error">${PASSKEY_ONLY_NOSCRIPT}</p></noscript>
<p class="error" id="passkey-error" role="alert" hidden>${PASSKEY_ONLY_ERROR_TEXT}</p>
<form id="passkey-form" method="post" action="${PASSKEY_LOGIN_PATH}" hidden>
<input type="hidden" name="id" value="">
<input type="hidden" name="client_data_json" value="">
<input type="hidden" name="authenticator_data" value="">
<input type="hidden" name="signature" value="">
<input type="hidden" name="user_handle" value="">
<input type="hidden" name="next" value="${escapeHtml(next)}">
</form>`;
}
