/**
 * 登录页的 passkey 入口（M6 PR2b）：按钮 + 隐藏表单 + 固定错误槽 + 渐进增强脚本。
 *
 * 设计约束（`docs/plans/passkey-login-plan_zh.md` §5.7）：
 * - 无 JS 时密码登录完全不受影响：按钮与表单默认 `hidden`，由脚本在特性检测通过后显示；
 * - 登录完成走**普通表单 POST**（302/cookie/失败卡片与口令登录同形），只有取 options 这一步用 fetch；
 * - 页面上不出现任何请求文本：失败提示是编译进页面的常量，脚本只切换 `hidden`；
 * - 零第三方资源，脚本与样式全部内联；脚本里不含 `</script>` 序列。
 */
import { PASSKEY_LOGIN_PATH, PASSKEY_OPTIONS_PATH } from "../protocol/index.js";
import { escapeHtml } from "./html-escape.js";

/** `LoginPageOptions.passkey` 的形状：功能是否启用 + 条件 UI（autofill）开关。 */
export interface PasskeyLoginOptions {
  readonly enabled: boolean;
  readonly conditionalUi: boolean;
}

/** 登录页按钮文案（脚本只在特性检测通过后显示按钮，文案本身始终在 DOM 里）。 */
export const PASSKEY_BUTTON_TEXT = "Sign in with a passkey";

/**
 * passkey 失败的唯一文案（编译进页面；绝不反射任何请求/服务端文本）。
 * 失败后仍可使用口令登录，所以文案同时给出「用密码」这条退路。
 */
export const PASSKEY_ERROR_TEXT = "Passkey sign-in failed. Use your password or try again.";

/**
 * 新增的按钮样式（沿用 `CARD_STYLE` 的 CSS 变量与节奏；预算 +0.5 KiB）。
 * 口令主按钮是实心深色，passkey 是次级描边按钮：两者视觉层级明确，且不新增颜色。
 */
export const PASSKEY_STYLE = `
.passkey{width:100%;height:44px;margin-top:12px;border:1px solid var(--ctl);border-radius:10px;background:none;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}
.passkey:focus-visible{outline:2px solid var(--focus)}
#passkey-error{margin:12px 0 0}
@media (hover:hover) and (pointer:fine){.passkey:hover{border-color:var(--ctl-hover)}}
`;

/**
 * 脚本公共段（按钮路径）。`return` 出现在 IIFE 里：不支持 WebAuthn 时直接退出，
 * 让按钮保持 SSR 的 `hidden`，不留下任何「能点但会失败」的入口。
 */
const PASSKEY_CORE_SCRIPT = `
  var btn = document.getElementById("passkey-btn");
  var form = document.getElementById("passkey-form");
  var err = document.getElementById("passkey-error");
  if (!btn || !form || !err) return;
  var cred = window.PublicKeyCredential;
  if (!cred || !navigator.credentials || !navigator.credentials.get) return;
  var controller = null;
  function put(name, value) {
    var input = form.querySelector('input[name="' + name + '"]');
    if (input) input.value = value || "";
  }
  function encode(value) {
    var bytes = new Uint8Array(value);
    var binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  }
  function decode(value) {
    var text = value.replace(/-/g, "+").replace(/_/g, "/");
    while (text.length % 4) text += "=";
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function fail() {
    err.hidden = false;
    btn.disabled = false;
    btn.hidden = false;
  }
  function finish(assertion) {
    var response = assertion.response;
    put("id", assertion.rawId ? encode(assertion.rawId) : assertion.id);
    put("client_data_json", encode(response.clientDataJSON));
    put("authenticator_data", encode(response.authenticatorData));
    put("signature", encode(response.signature));
    put("user_handle", response.userHandle ? encode(response.userHandle) : "");
    form.submit();
  }
  function loadOptions() {
    return fetch("${PASSKEY_OPTIONS_PATH}", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    }).then(function (response) {
      if (!response.ok) throw new Error("passkey options request failed");
      return response.json();
    });
  }
  function assert(options, mediation, signal) {
    var request = {
      publicKey: {
        challenge: decode(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: [],
      },
    };
    if (mediation) {
      request.mediation = mediation;
      request.signal = signal;
    }
    return navigator.credentials.get(request);
  }
  function cancelled(error) {
    return !!error && error.name === "AbortError";
  }
  btn.hidden = false;
  btn.addEventListener("click", function () {
    if (controller) controller.abort();
    err.hidden = true;
    btn.disabled = true;
    loadOptions()
      .then(function (options) {
        return assert(options).then(finish);
      })
      .catch(function (error) {
        if (cancelled(error)) {
          btn.disabled = false;
          btn.hidden = false;
          return;
        }
        fail();
      });
  });
`;

/**
 * 条件 UI 段（仅在 `conditionalUi` 开启时拼进同一个 IIFE）：页面加载后取一次 options
 * 并以 `mediation: "conditional"` 调 `get`，让凭据出现在用户名/密码框的自动填充里。
 * 用户改走口令提交时 `abort()`；不支持、拒绝（AbortError）或其他失败一律静默回退。
 */
const PASSKEY_CONDITIONAL_SCRIPT = `
  var passwordForm = document.querySelector("form:not(#passkey-form)");
  if (passwordForm && typeof cred.isConditionalMediationAvailable === "function") {
    cred.isConditionalMediationAvailable().then(function (available) {
      if (!available) return;
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      controller = ctl;
      passwordForm.addEventListener("submit", function () {
        if (ctl) ctl.abort();
      });
      return loadOptions().then(function (options) {
        return assert(options, "conditional", ctl ? ctl.signal : undefined).then(finish);
      });
    }).catch(function () {});
  }
`;

/**
 * 密码卡末尾注入的内联脚本。条件 UI 关闭时整段条件分支不注入（页面更小、行为更直白）；
 * 未开启条件 UI 的环境只保留按钮路径。
 */
export function passkeyLoginScript(conditionalUi: boolean): string {
  const conditional = conditionalUi ? PASSKEY_CONDITIONAL_SCRIPT : "";
  return `<script>(function () {${PASSKEY_CORE_SCRIPT}${conditional}\n})();</script>`;
}

/**
 * 密码表单之后的 passkey 片段：默认隐藏的按钮 + 固定错误槽 + 隐藏表单。
 * 表单字段名与协议类型 `PasskeyAssertionRequest` 一一对应；`next` 走 escapeHtml。
 */
export function passkeyLoginFragment(next: string, options: PasskeyLoginOptions): string {
  if (!options.enabled) return "";
  return `<button type="button" class="passkey" id="passkey-btn" hidden>${PASSKEY_BUTTON_TEXT}</button>
<p class="error" id="passkey-error" role="alert" hidden>${PASSKEY_ERROR_TEXT}</p>
<form id="passkey-form" method="post" action="${PASSKEY_LOGIN_PATH}" hidden>
<input type="hidden" name="id" value="">
<input type="hidden" name="client_data_json" value="">
<input type="hidden" name="authenticator_data" value="">
<input type="hidden" name="signature" value="">
<input type="hidden" name="user_handle" value="">
<input type="hidden" name="next" value="${escapeHtml(next)}">
</form>`;
}
