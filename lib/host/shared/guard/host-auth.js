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
/**
 * 把适配器包在宿主原规则外面。适配器缺失（旧宿主，或宿主没声明 auth）时原样返回，
 * 保证旧宿主注册对象逐字不变。
 */
export function composeFallbackAuth(original, adapter) {
    if (adapter === undefined)
        return original;
    return (request) => adapter(original, request);
}
