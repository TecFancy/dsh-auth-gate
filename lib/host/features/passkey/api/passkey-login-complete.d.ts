/**
 * passkey 登录的"结算"半边：验签后的签发与统一拒绝。从 `passkey-login-finish.ts` 拆出，
 * 守住单文件行数上限；调用方负责受理与占位释放。
 */
import type { ServerResponse } from "node:http";
import type { SessionStore } from "../../../entities/session/index.js";
import type { Admission } from "../../../shared/rate-limit/index.js";
import { type PasskeyFailureContext } from "./passkey-login-failures.js";
import type { PasskeyCounterStore, PasskeyCredentialMatch } from "../model/passkey-login.js";
import type { AssertionVerdict } from "./passkey-assertion-verify.js";
import type { PasskeyLoginFinishDeps } from "./passkey-login-finish.js";
/** 成功路径：推进进程内计数器 → 清失败桶 → 注入 issueSession（受限语义由注入实现继承）。 */
export declare function completeLogin(deps: PasskeyLoginFinishDeps, counters: PasskeyCounterStore, res: ServerResponse, input: {
    readonly admission: Admission;
    readonly match: PasskeyCredentialMatch;
    readonly verdict: Extract<AssertionVerdict, {
        ok: true;
    }>;
    readonly store: SessionStore;
    readonly next: string;
    readonly clearCookie: string;
}): Promise<void>;
/** 统一拒绝：计失败（已知用户按用户名桶，未知/伪凭据只按 IP）+ 401 卡片。 */
export declare function rejectLogin(deps: PasskeyLoginFinishDeps, res: ServerResponse, username: string | undefined, context: PasskeyFailureContext, reason: string, clearCookie: string, admission: Admission): void;
