import type { HttpHandler } from "../../../shared/guard/index.js";
import type { PasskeyOptionsQuota } from "../model/options-quota.js";
import { type PasskeyLoginFinishDeps } from "./passkey-login-finish.js";
export type { PasskeyLoginSettings } from "../model/passkey-login.js";
/** 注册登录取的输入（root 侧装配把配置、存储与限速器收拢成这个形状）。 */
export interface PasskeyLoginDeps extends PasskeyLoginFinishDeps {
    register(route: {
        kind: "exact";
        path: string;
        handler: HttpHandler;
    }): () => void;
    /** begin 的请求配额（与登录失败限速器分开）。 */
    readonly optionsQuota: PasskeyOptionsQuota;
}
/**
 * 注册两个 exact 端点并返回合并 disposer（内部按注册逆序释放）。
 * 同一 `PasskeyCounterStore` 实例服务两个端点（只被 finish 使用）。
 */
export declare function registerPasskeyLoginEndpoints(deps: PasskeyLoginDeps): () => void;
//# sourceMappingURL=passkey-login-endpoints.d.ts.map