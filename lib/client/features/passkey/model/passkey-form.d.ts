import { type AccountTranslate } from "../../../shared/i18n/index.ts";
/** 添加表单字段（`label` / 当前口令 / 可选 TOTP 码）。 */
export type PasskeyField = "label" | "password" | "code";
export type PasskeyFormValues = Record<PasskeyField, string>;
/** 表单初值：提交成功后清回这一份。 */
export declare const EMPTY_PASSKEY_FORM: PasskeyFormValues;
/** 名称长度上限（与 host 侧 `label` ≤ 64 字符的校验一致）。 */
export declare const PASSKEY_LABEL_MAX = 64;
/** 失败视图：已翻译消息 + 需标红的字段。 */
export interface PasskeyFailureView {
    message: string;
    fields: PasskeyField[];
}
/** 列表结果：401 登录态已死、403 受限会话、503/网络/解析失败、卸载中止。 */
export type PasskeyListResult = {
    kind: "ok";
    passkeys: PasskeySummaryView[];
} | {
    kind: "unauthorized";
} | {
    kind: "forbidden";
} | {
    kind: "failure";
} | {
    kind: "aborted";
};
/** 列表行（client 视图）：契约 `PasskeySummary` 的逐字段白名单解析结果。 */
export interface PasskeySummaryView {
    idPrefix: string;
    label: string;
    createdAt: number;
    lastUsedAt: number;
    backupEligible: boolean;
    backupState: boolean;
    transports: string[];
}
/** 添加/删除结果：成功 / 映射出的失败 / 已中止。 */
export type PasskeyMutationResult = {
    kind: "ok";
} | {
    kind: "failure";
    failure: PasskeyFailureView;
} | {
    kind: "aborted";
};
/** 设置读写结果（admin 开关）。 */
export type PasskeySettingsResult = {
    kind: "ok";
    conditionalUiEnabled: boolean;
} | {
    kind: "forbidden";
} | {
    kind: "failure";
} | {
    kind: "aborted";
};
/**
 * 本地校验闭表：label → password（code 可选，不校验）。
 * `label` 用 `trim()` 判空与长度（名称两端空白无意义），口令字段不 trim。
 */
export declare function validatePasskeyForm(values: PasskeyFormValues, t: AccountTranslate): PasskeyFailureView | null;
/**
 * 状态码矩阵 → 文案键（与 host 的 `PasskeyAdminErrorBody` 对齐）：
 * 400 bad_request、401 unauthorized、403 forbidden、404 not_found、429 locked(+retryAfter)、
 * 503 unavailable，其余一律 generic。`reason` 只用于区分「最后一枚凭据」这类策略拒绝。
 */
export declare function describePasskeyFailure(status: number, body: unknown, t: AccountTranslate): PasskeyFailureView;
/** 401 且错误码是 `invalid_totp` 时把焦点指向验证码框（口令正确、码错）。 */
export declare function isInvalidTotp(status: number, body: unknown): boolean;
//# sourceMappingURL=passkey-form.d.ts.map