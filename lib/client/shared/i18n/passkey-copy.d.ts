/**
 * `auth` 词典的 passkey 分片：键名集中常量 + zh/en 两套文案。
 *
 * 与 account / admin 分片同命名域：`account-copy.ts` 把两套词典合并进 `ACCOUNT_DICT_*`，
 * `index.tsx` 注册时自动带上，因此本文件不需要（也不能）改 client 入口。
 * 键名统一 `account.passkey.*` 前缀，避免与 account / admin 的既有键冲突。
 */
/** passkey 区块用到的词典键（集中常量，避免散落字符串）。 */
export declare const PASSKEY_KEYS: {
    readonly title: "account.passkey.title";
    readonly intro: "account.passkey.intro";
    readonly loading: "account.passkey.loading";
    readonly empty: "account.passkey.empty";
    readonly unavailable: "account.passkey.unavailable";
    readonly unauthorized: "account.passkey.unauthorized";
    readonly unsupported: "account.passkey.unsupported";
    readonly colLabel: "account.passkey.colLabel";
    readonly colCreated: "account.passkey.colCreated";
    readonly colLastUsed: "account.passkey.colLastUsed";
    readonly colBackup: "account.passkey.colBackup";
    readonly colActions: "account.passkey.colActions";
    readonly neverUsed: "account.passkey.neverUsed";
    readonly backupEligible: "account.passkey.backupEligible";
    readonly backupState: "account.passkey.backupState";
    readonly deviceBound: "account.passkey.deviceBound";
    readonly add: "account.passkey.add";
    readonly adding: "account.passkey.adding";
    readonly label: "account.passkey.label";
    readonly labelPlaceholder: "account.passkey.labelPlaceholder";
    readonly password: "account.passkey.password";
    readonly passwordHint: "account.passkey.passwordHint";
    readonly code: "account.passkey.code";
    readonly codeHint: "account.passkey.codeHint";
    readonly remove: "account.passkey.remove";
    readonly removing: "account.passkey.removing";
    readonly removeConfirm: "account.passkey.removeConfirm";
    readonly cancel: "account.passkey.cancel";
    readonly successAdd: "account.passkey.successAdd";
    readonly successRemove: "account.passkey.successRemove";
    readonly labelRequired: "account.passkey.labelRequired";
    readonly labelTooLong: "account.passkey.labelTooLong";
    readonly passwordRequired: "account.passkey.passwordRequired";
    readonly invalidCredentials: "account.passkey.invalidCredentials";
    readonly invalidTotp: "account.passkey.invalidTotp";
    readonly forbidden: "account.passkey.forbidden";
    readonly notFound: "account.passkey.notFound";
    readonly badRequest: "account.passkey.badRequest";
    readonly locked: "account.passkey.locked";
    readonly lockedPlain: "account.passkey.lockedPlain";
    readonly generic: "account.passkey.generic";
    readonly settingsTitle: "account.passkey.settingsTitle";
    readonly settingsIntro: "account.passkey.settingsIntro";
    readonly settingsLabel: "account.passkey.settingsLabel";
    readonly settingsSaved: "account.passkey.settingsSaved";
    readonly settingsError: "account.passkey.settingsError";
};
/** 中文词典。 */
export declare const PASSKEY_DICT_ZH: Record<string, string>;
/** 英文词典（键集合与中文一致）。 */
export declare const PASSKEY_DICT_EN: Record<string, string>;
//# sourceMappingURL=passkey-copy.d.ts.map