/**
 * `auth` 词典的 account 分片：键名集中常量 + zh/en 两套文案。
 *
 * `index.tsx` 把两套词典注册进 `auth` 命名域（与 logout 同一 ns），
 * `account-section.tsx` 只通过槽位注入的 `t` 读取本文件的键，不自己拼字符串。
 * 策略文案里的 14/256 字符镜像契约 §2（`PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH`）：
 * client bundle 不 import 服务端 shared 模块，半边保持解耦。
 */
/** 槽位注入的标准 `t` seat（host locale translate 的形）。 */
export type AccountTranslate = (key: string, params?: Record<string, unknown>) => string;
/** 本面板用到的词典键（集中常量，避免散落字符串）。 */
export declare const ACCOUNT_KEYS: {
    readonly nav: "account";
    readonly title: "account.title";
    readonly intro: "account.intro";
    readonly loading: "account.loading";
    readonly loginRequired: "account.loginRequired";
    readonly current: "account.current";
    readonly password: "account.password";
    readonly confirm: "account.confirm";
    readonly code: "account.code";
    readonly codeHint: "account.codeHint";
    readonly policyHint: "account.policyHint";
    readonly submit: "account.submit";
    readonly submitting: "account.submitting";
    readonly success: "account.success";
    readonly close: "account.close";
    readonly currentRequired: "account.currentRequired";
    readonly passwordRequired: "account.passwordRequired";
    readonly mismatch: "account.mismatch";
    readonly invalidCredentials: "account.invalidCredentials";
    readonly invalidTotp: "account.invalidTotp";
    readonly policyIntro: "account.policyIntro";
    readonly locked: "account.locked";
    readonly lockedPlain: "account.lockedPlain";
    readonly unavailable: "account.unavailable";
    readonly generic: "account.generic";
    readonly ruleMinLength: "account.rule.minLength";
    readonly ruleMaxLength: "account.rule.maxLength";
    readonly ruleUppercase: "account.rule.uppercase";
    readonly ruleLowercase: "account.rule.lowercase";
    readonly ruleDigit: "account.rule.digit";
    readonly ruleSpecial: "account.rule.special";
    readonly ruleSameAsOld: "account.rule.sameAsOld";
};
/** 规则名翻译；未知规则原样回显（不发明契约之外的文案）。 */
export declare function ruleText(rule: string, t: AccountTranslate): string;
/** host locale 的插值规则（`{name}`；缺参数时保留占位符不吞字）。 */
export declare function formatCopy(template: string, params?: Record<string, unknown>): string;
/** 用一套词典兜底成 translate（槽位未注入 `t` 时降级为英文，不显示键名）。 */
export declare function translateFrom(dict: Record<string, string>): AccountTranslate;
/** 中文词典。 */
export declare const ACCOUNT_DICT_ZH: Record<string, string>;
/** 英文词典。 */
export declare const ACCOUNT_DICT_EN: Record<string, string>;
//# sourceMappingURL=account-copy.d.ts.map