import { type AccountTranslate } from "./account-copy.ts";
/**
 * 管理块（PR2）的 `auth` 词典分片：键名集中常量 + zh/en 两套文案。
 *
 * 与 account 分片同命名域（`index.tsx` 把两套词典合并注册），管理块只通过注入的 `t` 读键。
 * 键与文案对齐 CONTRACT-pr2 §4 全表 + §9/A4 的 2 个新增键（冻结键集 = 42）；
 * 策略规则名复用 `account-copy.ts` 的 `ruleText`，本文件不新造规则文案。
 */
/** 管理块 translate：与自助改密同形（宿主只注入一个 `t` seat）。 */
export type AdminTranslate = AccountTranslate;
/** 管理块词典键（集中常量，避免散落字符串）。 */
export declare const ADMIN_KEYS: {
    readonly title: "admin.title";
    readonly intro: "admin.intro";
    readonly selfHint: "admin.selfHint";
    readonly loading: "admin.loading";
    readonly unavailable: "admin.unavailable";
    readonly empty: "admin.empty";
    readonly colUser: "admin.colUser";
    readonly colRole: "admin.colRole";
    readonly colState: "admin.colState";
    readonly colTotp: "admin.colTotp";
    readonly roleAdmin: "admin.roleAdmin";
    readonly roleUser: "admin.roleUser";
    readonly you: "admin.you";
    readonly stateDisabled: "admin.stateDisabled";
    readonly stateMustChange: "admin.stateMustChange";
    readonly stateOk: "admin.stateOk";
    readonly totpOn: "admin.totpOn";
    readonly totpOff: "admin.totpOff";
    readonly target: "admin.target";
    readonly targetPlaceholder: "admin.targetPlaceholder";
    readonly password: "admin.password";
    readonly confirm: "admin.confirm";
    readonly code: "admin.code";
    readonly codeHint: "admin.codeHint";
    readonly policyHint: "admin.policyHint";
    readonly submit: "admin.submit";
    readonly submitting: "admin.submitting";
    readonly successRevoked: "admin.successRevoked";
    readonly successKept: "admin.successKept";
    readonly targetRequired: "admin.targetRequired";
    readonly passwordRequired: "admin.passwordRequired";
    readonly mismatch: "admin.mismatch";
    readonly codeRequired: "admin.codeRequired";
    readonly forbidden: "admin.forbidden";
    readonly badTarget: "admin.badTarget";
    readonly notFound: "admin.notFound";
    readonly policyIntro: "admin.policyIntro";
    readonly invalidTotp: "admin.invalidTotp";
    readonly unauthorized: "admin.unauthorized";
    readonly locked: "admin.locked";
    readonly lockedPlain: "admin.lockedPlain";
    readonly generic: "admin.generic";
};
/** 中文词典（键序与 §4 表一致，A4 的 2 键插在语义位置）。 */
export declare const ADMIN_DICT_ZH: Record<string, string>;
/** 英文词典（键序与中文一致）。 */
export declare const ADMIN_DICT_EN: Record<string, string>;
/**
 * 用一套词典兜底成 translate：缺键先回落英文词典，两边都缺时回空串，
 * **绝不把键名当文案显示**（§4 表注）。
 */
export declare function translateAdminFrom(dict: Record<string, string>): AdminTranslate;
//# sourceMappingURL=admin-copy.d.ts.map