/**
 * 管理端点的统一门禁（注册/列表/删除/设置共用），顺序即安全语义：
 *
 * 405 → 415/413 → Origin 403 → 401（无 cookie / 会话无效）→ 503（有 cookie 但会话存储不可用）
 * → 403（受限 / bootstrap 会话）→ 429（独立限速桶，IP + 账号）→ 503（读 users.yaml）。
 *
 * 两处顺序是刻意的：
 * - **503 在 401 之后**：没有 cookie 时先回 401（用户确实没登录）；有 cookie 但存储不可用时
 *   回 503 而不是 401，否则会把「服务暂时不可用」误报成「会话失效」，用户会去重新登录。
 * - **503（读 users）在 consume ceremony 之前**：瞬时读盘失败不该烧掉在途仪式。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthedPasskeyRequest, PasskeyManagementDeps } from "./passkey-management-deps.js";
/** 门禁选项：哪些阶段参与（GET 不解析表单、不查 Origin、不查限速桶）。 */
export interface PasskeyGateOptions {
    /** 允许的方法；其它方法 405 + `allow`。 */
    readonly method: "GET" | "POST";
    /** 是否解析 urlencoded 表单体（415/413 只在这条路径上出现）。 */
    readonly form: boolean;
    /**
     * 是否做同源校验（CSRF 纵深）。只对**写路径**开启：GET 列表/设置是只读 JSON，
     * 浏览器地址栏导航不带 `Origin`，对读路径强制同源只会把正常访问打成 403。
     */
    readonly origin: boolean;
    /** 是否检查限速桶（写路径用；列表/设置读不消耗）。 */
    readonly limiter: boolean;
}
/** 门禁通过后的上下文。 */
export interface PasskeyGateContext {
    readonly authed: AuthedPasskeyRequest;
    readonly params: URLSearchParams;
    readonly ip: string;
}
/** 门禁结论：`proceed` 继续处理；`handled` 表示响应已写出。 */
export type PasskeyGateResult = {
    readonly kind: "proceed";
    readonly context: PasskeyGateContext;
} | {
    readonly kind: "handled";
};
/**
 * 跑完整门禁。返回 `handled` 时响应已写完，调用方直接 return。
 * 405 用 `methodNotAllowed`（与既有端点同形：`allow` 头 + text/plain）。
 */
export declare function passkeyManagementGate(deps: PasskeyManagementDeps, req: IncomingMessage, res: ServerResponse, options: PasskeyGateOptions): Promise<PasskeyGateResult>;
//# sourceMappingURL=passkey-management-gate.d.ts.map