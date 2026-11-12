import { type AccountTranslate } from "../../../shared/i18n/index.ts";
import { type PasskeyFormValues, type PasskeyMutationResult } from "../model/passkey-form.ts";
/** 注册结果：成功 / 失败（含字段标红）/ 已中止 / 浏览器不支持。 */
export type RegisterPasskeyResult = {
    kind: "ok";
} | {
    kind: "failure";
    message: string;
    fields: ("label" | "password" | "code")[];
} | {
    kind: "unsupported";
} | {
    kind: "aborted";
};
/**
 * 注册一把新凭据：options（再认证）→ `navigator.credentials.create` → register。
 * 任一步失败都映射成同一种失败视图；用户取消/超时静默回退（`aborted`）。
 */
export declare function registerPasskey(values: PasskeyFormValues, signal: AbortSignal, t: AccountTranslate): Promise<RegisterPasskeyResult>;
/**
 * 删除一把凭据（按 `idPrefix` 前缀唯一匹配）。再认证凭据随请求一起发：
 * 删最后一把时服务端会强制校验，普通单删也带上（同一份表单，不区分路径）。
 */
export declare function removePasskey(idPrefix: string, values: PasskeyFormValues, signal: AbortSignal, t: AccountTranslate): Promise<PasskeyMutationResult>;
//# sourceMappingURL=passkey-mutate.d.ts.map