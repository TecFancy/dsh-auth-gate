import { type LoginPageOptions } from "./login-page.js";
/** 卡片副标题：一句话说清「为什么没有密码框」。 */
export declare const PASSKEY_ONLY_HINT = "This instance requires a passkey. Use your device's biometrics or security key to sign in.";
/** 无 JS 时的说明（`<noscript>` 里）。 */
export declare const PASSKEY_ONLY_NOSCRIPT = "Passkey sign-in needs JavaScript. Enable it in this browser, or ask the instance owner to restore password sign-in.";
/** 失败文案：passkey-only 下没有「改用密码」这条退路，不能复用口令卡的文案。 */
export declare const PASSKEY_ONLY_ERROR_TEXT = "Passkey sign-in failed. Try again.";
/** 浏览器不支持 WebAuthn 时的说明（脚本特性检测失败后由 `<noscript>` 之外的静态块承担）。 */
export declare const PASSKEY_ONLY_UNSUPPORTED = "This browser does not support passkeys. Try a current version of Chrome, Safari, Edge or Firefox.";
/**
 * WebAuthn 配置失效时的诊断页（`passkey: "required"` 但 `publicHost`/RP ID/origin 不成立）。
 *
 * 这是 issue #133 第 4 点的落点：**配置坏了不恢复口令登录**，而是给一张能诊断的卡。`reason`
 * 是 `PasskeyDisabledReason` 的固定取值（不含配置原文），直接显示给运维看。
 */
export declare function passkeyOnlyUnavailablePageHtml(reason: string, options?: LoginPageOptions): string;
/**
 * passkey-only 登录卡：提示 + 隐藏按钮 + `<noscript>` + 固定错误槽 + 隐藏表单。
 *
 * `error` 只由调用方传本文件的常量（失败页复用同一张卡）。
 */
export declare function passkeyOnlyLoginPageHtml(next: string, error?: string, options?: LoginPageOptions): string;
//# sourceMappingURL=passkey-only-login-page.d.ts.map