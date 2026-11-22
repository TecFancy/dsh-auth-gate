import type { MountedRoute, RouteRegister } from "../../../shared/http/index.js";
import type { PasskeyOptionsQuota } from "../model/options-quota.js";
import { type PasskeyLoginFinishDeps } from "./passkey-login-finish.js";
export type { PasskeyLoginSettings } from "../model/passkey-login.js";
/** 注册登录取的输入（root 侧装配把配置、存储与限速器收拢成这个形状）。 */
export interface PasskeyLoginDeps extends PasskeyLoginFinishDeps {
    register: RouteRegister;
    /** begin 的请求配额（与登录失败限速器分开）。 */
    readonly optionsQuota: PasskeyOptionsQuota;
}
/**
 * 两条登录路由（begin / finish）。两条 handler 共用同一个 `PasskeyCounterStore`：
 * 计数器只被 finish 使用，begin 只建 ceremony；拆出来供统一注册入口把登录与管理路由
 * 收进同一批 `mountRoutes`（部分失败一起回滚）。
 */
export declare function makePasskeyLoginRoutes(deps: PasskeyLoginDeps): MountedRoute[];
/** 只注册两条登录路由（合并 disposer；部分失败按注册逆序回滚）。 */
export declare function registerPasskeyLoginEndpoints(deps: PasskeyLoginDeps): () => void;
