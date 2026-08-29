import type { AuthContext } from "./context.ts";
import { SettingsLogoutAction } from "./logout-action.tsx";

/** 本插件文案的词典命名域（locale 服务按 (ns, locale) 分开注册）。 */
const AUTH_NS = "auth";
/** 命名词典里登出键。 */
const LOGOUT_KEY = "logout";
/**
 * 默认槽位 order：注册时先用它（与 host 端 Config 默认一致），随后 `/auth/status`
 * 探针读到 host 配置的 `logoutOrder` 时按配置重注册。1000 已大于 dsh 自带条目
 * （agent-preset -25 / permission -20 / language 0 / appearance 10 / composer-enter 20），
 * 除非第三方插件注册更大的 order，按钮始终留在通用设置页最底部。
 */
const DEFAULT_LOGOUT_ORDER = 1000;

/**
 * dsh-auth-gate client 半边：认证后在**设置面板**（设置 → 通用设置 页底部）挂一
 * 个醒目的「退出登录 / Sign out」按钮——`settings.general.item`（root 作用域、
 * 可追加列表槽，由 ui-settings-general 的 General 页堆叠渲染，按 order 升序）。
 *
 * 顺序可配置：先以默认 order（1000）注册（探针失败/未开始前按钮也可见），再探
 * `/auth/status` 读取 host 配置的 `logoutOrder`，与默认不同则按配置值重注册
 * （同 id 注册 = 槽位替换，先注册新条目再释放旧条目，避免中间态空白）。
 *
 * 换槽对比：不再往会话页 `conversation.session.header.utilities`、新会话页
 * `shell.overlay` 注册（右上角两处入口已移除），也不占侧边栏 footer 脚区。
 * 文案挂进 dsh 现有的 locale 机制（与「设置」里的语言切换同一套）：注册 `auth`
 * 词典（zh/en），再以 `locale: "auth"` 给注册条目注入 `t` seat，按钮文字随界面
 * 语言在「退出登录」/ "Sign out" 间实时切换。不改任何服务端端点/会话语义。
 */
export const inject = ["slots", "locale"];

export function apply(ctx: AuthContext): void {
  // 词典注册（zh/en 双语，挂 fiber 卸载级联）。
  ctx.effect(
    () => [
      ctx.locale.register(AUTH_NS, "zh", { [LOGOUT_KEY]: "退出登录" }),
      ctx.locale.register(AUTH_NS, "en", { [LOGOUT_KEY]: "Sign out" }),
    ],
    "auth: logout dictionary",
  );

  // 绑定 translate：读取活动语言（thunk 每次投影重读，跟随语言切换）。
  const t = ctx.locale.bind(AUTH_NS);

  ctx.slots.inject("settings.general.item", () => {
    const mount = (order: number): (() => void) =>
      ctx.slots.register(
        {
          name: "settings.general.item",
          id: "dsh-auth-gate-logout",
          locale: AUTH_NS,
          order,
          label: () => t(LOGOUT_KEY),
        },
        SettingsLogoutAction,
      );
    let dispose: (() => void) | undefined = mount(DEFAULT_LOGOUT_ORDER);
    // 与 SettingsLogoutAction 相同的 status 探针：读 host 的 logoutOrder 配置并在
    // 不同时重注册。探针抛错（如测试环境无 fetch）保持默认，绝不吞掉注册。
    try {
      void fetch("/auth/status")
        .then((res) => res.json() as Promise<{ logoutOrder?: unknown }>)
        .then((body: { logoutOrder?: unknown }) => {
          const order = body.logoutOrder;
          if (
            typeof order !== "number" ||
            !Number.isInteger(order) ||
            order === DEFAULT_LOGOUT_ORDER
          ) {
            return;
          }
          const previous = dispose;
          dispose = mount(order);
          previous?.();
        })
        .catch(() => undefined);
    } catch {
      // fetch 不可用（测试环境/旧浏览器）：保持默认 order。
    }
    return () => dispose?.();
  });
}
