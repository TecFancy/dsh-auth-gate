import { type PasskeyAssertion, type PasskeyCredentialMatch, type PasskeyLoginSettings } from "../model/passkey-login.js";
/** 拒绝原因码（只进日志，不进响应）。 */
export type AssertionRejection = "user-handle-mismatch" | "counter-regression" | "verification-failed" | "backup-state-mismatch";
/** 校验结论：成功带上库返回的新计数器与可选的放行告警。 */
export type AssertionVerdict = {
    readonly ok: true;
    readonly newCounter: number;
    readonly warn: "counter-regression" | undefined;
} | {
    readonly ok: false;
    readonly reason: AssertionRejection;
};
/** `verifyPasskeyAssertion` 的输入。 */
export interface AssertionVerificationInput {
    readonly settings: PasskeyLoginSettings;
    readonly match: PasskeyCredentialMatch;
    readonly assertion: PasskeyAssertion;
    /** ceremony 里的 challenge（base64url），即 `expectedChallenge`。 */
    readonly challenge: string;
    /** 进程内生效的计数器（`PasskeyCounterStore.stored`）。 */
    readonly storedCounter: number;
}
/**
 * 校验一条登录断言：userHandle 属于该用户 → 计数器策略 → 库验签 → BE/BS 与记录一致。
 * 任何一步失败都返回原因码（不抛异常）；库的异常（含重放计数器、非法 CBOR/DER）归为
 * `verification-failed`。
 */
export declare function verifyPasskeyAssertion(input: AssertionVerificationInput): Promise<AssertionVerdict>;
/**
 * 未知（或已禁用）凭据的等量工作：用固定 dummy 公钥把同一条断言完整验一遍，结果丢弃。
 * 抛错也丢弃；调用方无论如何都回同一个 401。
 */
export declare function runDummyVerification(input: {
    readonly settings: PasskeyLoginSettings;
    readonly assertion: PasskeyAssertion;
    readonly challenge: string;
}): Promise<void>;
//# sourceMappingURL=passkey-assertion-verify.d.ts.map