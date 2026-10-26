import type { IncomingMessage } from "node:http";
import type { Gate, GateDecision, GuardKind } from "../../../shared/guard/index.js";
import { safeEqual } from "../../../shared/crypto/index.js";
import { type SessionStore } from "../../../entities/session/index.js";
/** 恒时比较在 `shared/crypto`，这里转口导出：既有调用点（含 barrel）不用改 import。 */
export { safeEqual };
export interface TokenGateOptions {
    /** 每次 decide 调用的凭证解析器（index.ts 注入 credentials.resolve 闭包）。 */
    resolveToken: () => Promise<string | undefined>;
    /** 会话访问器（M16）：每次 decide 现取（domain 异步就绪；undefined = cookie 通道不可用。 */
    sessions: () => SessionStore | undefined;
    cookieName: string;
}
/**
 * 共享 token 门（M2）：`/auth` 前缀 + 公开只读静态路径白名单 → 会话 cookie → Bearer，
 * 恒时校验，fail-closed。
 *
 * 首次引导通道：本来要拒绝的 `GET /?token=` 只按请求形状 302 到 `/auth/bootstrap?token=`，
 * 门内不校验 token、不读文件、不做 IO。bootstrap 会话只放行 `/auth/*`（上面已放行），
 * 其余导航 302 回向导页，API 401，WS 拒握手。
 */
export declare class TokenGate implements Gate {
    private readonly resolveToken;
    private readonly sessions;
    private readonly cookieName;
    constructor(options: TokenGateOptions);
    decide(req: IncomingMessage, kind: GuardKind, pathname: string): Promise<GateDecision>;
    /** 会话行（只认会话 cookie，与既有 token 通道一致）：无 store/无 cookie/失效 → undefined。 */
    private sessionOf;
}
//# sourceMappingURL=token-gate.d.ts.map