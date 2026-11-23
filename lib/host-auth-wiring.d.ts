import type { Context } from "@deepseek-ai/cordis";
import { type SessionStore } from "./host/entities/session/index.js";
import type { FallbackAuthAdapter } from "./host/shared/guard/index.js";
export interface HostAuthWiringInput {
    readonly sessions: () => SessionStore | undefined;
    readonly cookieName: string;
    readonly log: {
        error(message: unknown): void;
        info(message: unknown): void;
        warn(message: unknown): void;
    };
}
/**
 * 宿主是否有路由级鉴权模型（`connection` + 独立服务 `connection.authentication`）。
 *
 * 两处细节都来自实测：Cordis 4.2 的服务代理**禁止**读取未注入的嵌套服务成员
 * （`connection.authentication` 会抛 `cannot get property … without inject`），所以判断只能
 * 用 `ctx.get` 逐个取，并且整体 try/catch（旧宿主上这两个服务不存在或形状不同都返回 false）。
 */
export declare function hasRouteAuthModel(ctx: Context): boolean;
/**
 * 把本插件的完整会话接成宿主 `connection.authentication` 的 Provider，并给出 fallback 鉴权适配器。
 *
 * 背景（DSH 0.2.3-alpha.2）：宿主在**路由分发之前**按路由 `auth` 策略判定；省略 `auth` 即
 * `required`。插件自己的门包在 handler/resource 外面，请求被宿主判死时根本到不了那里。这里注册
 * 一个 Provider：请求带本插件**完整**会话（cookie 或 Bearer 会话 token）→ 返回 owner Peer，
 * 宿主 required 路由放行；否则 `undefined`，宿主自己的 Token/Remote Provider 继续尝试。
 *
 * 注册走 `ctx.inject(["connection"])`：宿主组合里 `connection` 可能晚于本插件就绪，apply 时
 * 直接 `ctx.get` 会永远拿不到。旧宿主（`connection` 在但没有 `authentication` 子服务）注入
 * 回调直接返回，Provider 不装，行为与 0.2.2 及更早一致。
 *
 * Peer 的粒度为 owner：宿主侧权限只区分「已放行/未放行」，而本插件对所有完整会话一视同仁
 * （角色只在插件自己的管理面里细分），与旧宿主守卫放行后的语义相同。Peer 由读 `connection`
 * 的那层 ctx 拥有，插件卸载时随之释放；bootstrap 与受限会话**不**算完整会话，换不到 Peer，
 * 因而不会因为宿主放行而拿到数据面权限。
 */
export declare function wireHostAuth(ctx: Context, input: HostAuthWiringInput): FallbackAuthAdapter;
