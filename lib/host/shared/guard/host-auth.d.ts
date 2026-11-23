/**
 * 宿主路由鉴权模型（DSH 0.2.3-alpha.2 起 `webServer` 的 `auth` 字段）。
 *
 * 新版 `WebRoute` / `WebResourceRoute` / `WebUpgradeRoute` / `WebFallback` 都接受
 * `auth?: WebAuthenticationRule`，取值 `anonymous | required | deny` 或按请求选择的同步函数；
 * **省略即 `required`**。旧宿主没有这个概念，注册时这个字段被原样忽略，所以镜像里加上它
 * 只为在注册对象上保留本插件自己的声明，不改变旧宿主行为。
 *
 * 守卫只透传宿主字段、不解读策略；唯一例外是 fallback 的 {@link FallbackAuthAdapter}：
 * 新版把 `/` 索引兜底声明成 `required` 并在渲染时消费 Peer，守卫需要在「本轮会话不完整」
 * 时把它降级成 `anonymous`，先让门按登录流程 302，而不是被宿主提前 401。
 */
/** 宿主路由鉴权策略：允许匿名、要求已认证 Peer、或直接拒绝（403）。 */
export type HostAuthPolicy = "anonymous" | "required" | "deny";
/** 宿主鉴权请求事实（结构镜像 `WebAuthRequest`；守卫只把原对象递回原规则）。 */
export interface HostAuthRequest {
    readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method?: string | undefined;
    readonly url: URL;
    readonly transport: "http" | "upgrade";
    readonly signal?: AbortSignal | undefined;
}
/** 固定策略或按请求选择策略（宿主同步调用）。 */
export type HostAuthRule = HostAuthPolicy | ((request: HostAuthRequest) => HostAuthPolicy);
/**
 * 新版 fallback 鉴权适配器：`original` 是宿主自己声明的规则（可能是函数）。
 * 返回 `required` 时宿主才会把 Peer 交给 resource；返回 `anonymous` 时守卫接手判定。
 */
export type FallbackAuthAdapter = (original: HostAuthRule | undefined, request: HostAuthRequest) => HostAuthPolicy;
/**
 * 把适配器包在宿主原规则外面。适配器缺失（旧宿主，或宿主没声明 auth）时原样返回，
 * 保证旧宿主注册对象逐字不变。
 */
export declare function composeFallbackAuth(original: HostAuthRule | undefined, adapter: FallbackAuthAdapter | undefined): HostAuthRule | undefined;
