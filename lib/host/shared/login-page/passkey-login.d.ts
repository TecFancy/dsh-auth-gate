/** `LoginPageOptions.passkey` 的形状：功能是否启用 + 条件 UI（autofill）开关。 */
export interface PasskeyLoginOptions {
    readonly enabled: boolean;
    readonly conditionalUi: boolean;
}
/** 登录页按钮文案（脚本只在特性检测通过后显示按钮，文案本身始终在 DOM 里）。 */
export declare const PASSKEY_BUTTON_TEXT = "Sign in with a passkey";
/**
 * passkey 失败的唯一文案（编译进页面；绝不反射任何请求/服务端文本）。
 * 失败后仍可使用口令登录，所以文案同时给出「用密码」这条退路。
 */
export declare const PASSKEY_ERROR_TEXT = "Passkey sign-in failed. Use your password or try again.";
/**
 * 新增的按钮样式（沿用 `CARD_STYLE` 的 CSS 变量与节奏；预算 +0.5 KiB）。
 * 口令主按钮是实心深色，passkey 是次级描边按钮：两者视觉层级明确，且不新增颜色。
 */
export declare const PASSKEY_STYLE = "\n.passkey{width:100%;height:44px;margin-top:12px;border:1px solid var(--ctl);border-radius:10px;background:none;color:var(--ink);font:inherit;font-weight:600;cursor:pointer}\n.passkey:focus-visible{outline:2px solid var(--focus)}\n#passkey-error{margin:12px 0 0}\n@media (hover:hover) and (pointer:fine){.passkey:hover{border-color:var(--ctl-hover)}}\n";
/**
 * 密码卡末尾注入的内联脚本。条件 UI 关闭时整段条件分支不注入（页面更小、行为更直白）；
 * 未开启条件 UI 的环境只保留按钮路径。
 */
export declare function passkeyLoginScript(conditionalUi: boolean): string;
/**
 * 密码表单之后的 passkey 片段：默认隐藏的按钮 + 固定错误槽 + 隐藏表单。
 * 表单字段名与协议类型 `PasskeyAssertionRequest` 一一对应；`next` 走 escapeHtml。
 */
export declare function passkeyLoginFragment(next: string, options: PasskeyLoginOptions): string;
//# sourceMappingURL=passkey-login.d.ts.map