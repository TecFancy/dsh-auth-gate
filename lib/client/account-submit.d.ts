import { type AccountTranslate } from "./account-copy.ts";
/** 四个字段：契约 §1 只收 current/password/code，confirm 只在客户端比对。 */
export type FieldName = "current" | "password" | "confirm" | "code";
export type FormValues = Record<FieldName, string>;
export declare const EMPTY_VALUES: FormValues;
/** 失败视图：消息 + 逐条策略规则 + 需要标红的字段。 */
export interface FailureView {
    message: string;
    rules: string[];
    fields: FieldName[];
}
/** 客户端校验：两次新密码一致只在这里判（契约 §1：不进请求体）。值不 trim。 */
export declare function validate(values: FormValues, t: AccountTranslate): FailureView | null;
/** 提交结果：成功 / 契约 §1 映射出的失败 / 已中止（卸载后连响应体都不再解析）。 */
export type PasswordSubmitResult = {
    kind: "ok";
} | {
    kind: "failure";
    failure: FailureView;
} | {
    kind: "aborted";
};
/** 发一次改密请求并按响应矩阵翻译；中途 abort 则立刻收手。 */
export declare function submitPassword(values: FormValues, signal: AbortSignal, t: AccountTranslate): Promise<PasswordSubmitResult>;
//# sourceMappingURL=account-submit.d.ts.map