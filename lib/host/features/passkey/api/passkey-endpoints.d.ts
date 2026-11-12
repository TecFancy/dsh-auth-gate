import type { PasskeyLoginDeps } from "./passkey-login-endpoints.js";
import type { PasskeyManagementDeps } from "./passkey-management-deps.js";
/**
 * 注册入口的完整依赖：登录两条路由的 deps + 管理侧 deps。
 *
 * `settings` 只取管理侧那一份（`PasskeyManagementSettings` 是 `PasskeyLoginSettings` 的
 * 超集，多一个可选的 `rpName`），因此用 `Omit` 而不是同时 extends 两个接口。
 */
export interface PasskeyEndpointsDeps extends Omit<PasskeyLoginDeps, "settings">, PasskeyManagementDeps {
}
/**
 * 注册全部 7 条 passkey 路由并返回合并 disposer（按注册逆序释放）。
 * 登录两条由 `registerPasskeyLoginEndpoints` 注册（它自己持有计数器存储），其余五条在这里注册。
 */
export declare function registerPasskeyEndpoints(deps: PasskeyEndpointsDeps): () => void;
//# sourceMappingURL=passkey-endpoints.d.ts.map