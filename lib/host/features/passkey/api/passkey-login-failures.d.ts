/**
 * passkey 登录的失败响应（401 卡片 / 429 卡片 / options 的 429 JSON / 503 纯文本）。
 *
 * 与口令登录的失败页纪律相同（D20/D21）：401 恒为同一张卡片 + 同一个常量文案，不区分
 * 「未知凭据 / 验签失败 / userHandle 或 BE 不一致」；429 按「这个网络」陈述，不显示剩余
 * 次数；任何响应都不读也不反射请求文本。
 */
import type { ServerResponse } from "node:http";
import type { UsersLoadResult } from "../../../entities/user/index.js";
/** 401 的唯一常量文案：未知凭据与各类校验失败共用。 */
export declare const PASSKEY_LOGIN_FAILED_MESSAGE = "Passkey sign-in failed. Try again or use your password.";
/** 429 固定文案（不插值秒数）：只陈述「这个网络」被限速。 */
export declare const PASSKEY_LOGIN_LOCKED_MESSAGE = "Too many sign-in attempts from this network. Try again later.";
/** 失败页上下文（反钓鱼身份块 + 已消毒的 next）。 */
export interface PasskeyFailureContext {
    readonly host: string;
    readonly next: string;
}
/** 401：登录卡片（error slot）并清掉已消费的 ceremony cookie（无会话 cookie）。 */
export declare function sendPasskeyFailure(res: ServerResponse, context: PasskeyFailureContext, clearCeremonyCookie: string): void;
/** 429：同一张卡片 + 固定锁定文案 + `retry-after`（不显示剩余次数）。 */
export declare function sendPasskeyLocked(res: ServerResponse, context: PasskeyFailureContext, retryAfterSeconds: number): void;
/** options 端点的 429（fetch 路径）：JSON 错误体 + `retry-after` 头，不下发 ceremony cookie。 */
export declare function sendOptionsLocked(res: ServerResponse, retryAfterSeconds: number): void;
/** 503：会话存储未就绪（与口令登录同形：text/plain，不计失败、不消费 ceremony）。 */
export declare function sendPasskeyUnavailable(res: ServerResponse): void;
/**
 * 用户文件不可用 → 503（与口令登录同形）。**必须在 consume ceremony 之前调用**：瞬时读盘
 * 失败不该烧掉用户的在途仪式，原样重试应当还能成功。
 */
export declare function loadUsersOr503(deps: {
    readonly loadUsers: () => Promise<UsersLoadResult>;
    readonly logger: {
        error(message: unknown): void;
    };
}, res: ServerResponse): Promise<UsersLoadResult | undefined>;
//# sourceMappingURL=passkey-login-failures.d.ts.map