import { ACCOUNT_DICT_EN, ACCOUNT_DICT_ZH, ACCOUNT_KEYS } from "./account-copy.ts";
import { installAccountNavIcon } from "./account-nav-icon.ts";
import { SettingsAccountSection } from "./account-section.tsx";
import type { AuthContext } from "./context.ts";
import { SettingsLogoutAction } from "./logout-action.tsx";

/** 本插件文案的词典命名域（locale 服务按 (ns, locale) 分开注册）。 */
const AUTH_NS = "auth";
/** 命名词典里登出键。 */
const LOGOUT_KEY = "logout";

/** 「账号安全」设置页（自助改密）的 section id。 */
const ACCOUNT_SECTION_ID = "dsh-auth-gate-account";
/**
 * 「账号安全」页在设置导航里的排列位置。
 *
 * 已知占用：宿主 general 0 / models 10 / plugins 15 / agent-presets 20（0.1.7 起还有官方云账户
 * `account` -10），姊妹包 dsh-plugin-subscriptions 的订阅页 90，全部远小于 900，所以 900
 * 表示「大于已知的全部条目、落在导航靠后」（账号安全压轴是设置页惯例，宿主 nav 列也没有滚动条）。
 *
 * **不保证全局最后**：宿主只按 order 升序排、没有并列决胜（同值按插件注册顺序，跨安装不稳定），
 * 后来者随时可能注册更大或相同的值。谁先到谁先用 900，撞车时按 901/902 递增（ADR D24 已记录）。
 */
const ACCOUNT_SECTION_ORDER = 900;

/**
 * 默认槽位 order：注册时先用它（与 host 端 Config 默认一致），随后 `/auth/status`
 * 探针读到 host 配置的 `logoutOrder` 时按配置重注册。1000 已大于 dsh 自带条目
 * （agent-preset -25 / permission -20 / language 0 / appearance 10 / composer-enter 20），
 * 除非第三方插件注册更大的 order，按钮始终留在通用设置页最底部。
 */
const DEFAULT_LOGOUT_ORDER = 1000;

/**
 * dsh-auth-gate client 半边：认证后在**设置面板**（设置 → 通用设置 页底部）挂一
 * 个醒目的「退出登录 / Sign out」按钮：`settings.general.item`（root 作用域、
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
 *
 * 同一次 apply 还注册「账号安全」设置页（`settings.section`，id
 * dsh-auth-gate-account，order 900）：内容为自助改密表单（见 account-section.tsx），
 * 文案复用同一个 `auth` 词典的 account 键。登出按钮的注册逻辑与 order 语义不变。
 *
 * 导航行图标（D24.1）：宿主 `settings.section` 没有 `icon` 选项（只有 id/order/label），
 * 第三方段的图标恒为宿主默认齿轮；插件侧没有官方挂载点，所以 `account-nav-icon.ts` 只对
 * 我们这一行做一次临时 DOM 垫片（自设计盾牌图标），上游支持 `icon` 后整体删除。
 */
export const inject = ["slots", "locale"];

export function apply(ctx: AuthContext): void {
  // 词典注册（zh/en 双语，挂 fiber 卸载级联）：登出 CTA + 账户页共用 auth 命名域。
  ctx.effect(
    () => [
      ctx.locale.register(AUTH_NS, "zh", { [LOGOUT_KEY]: "退出登录", ...ACCOUNT_DICT_ZH }),
      ctx.locale.register(AUTH_NS, "en", { [LOGOUT_KEY]: "Sign out", ...ACCOUNT_DICT_EN }),
    ],
    "auth: zh/en dictionaries (logout + account)",
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

  // 「账号安全」设置页：注册 `settings.section`（root 作用域、可追加列表槽，导航按
  // order 升序）。内容是自助改密表单，未登录由组件自查 `/auth/status` 后隐藏。
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: ACCOUNT_SECTION_ID,
        locale: AUTH_NS,
        order: ACCOUNT_SECTION_ORDER,
        label: () => t(ACCOUNT_KEYS.nav),
      },
      SettingsAccountSection,
    ),
  );

  // 导航行图标垫片（D24.1）：只替换我们自己那一行，找不到就保持宿主齿轮；没有 DOM 的环境
  // （node 单测）直接 no-op。上游给 `settings.section` 加 `icon` 后，这一行与
  // account-nav-icon.ts 一起删除。
  ctx.effect(
    () => installAccountNavIcon(globalThis.document),
    "auth: account nav icon shim (D24.1)",
  );
}
