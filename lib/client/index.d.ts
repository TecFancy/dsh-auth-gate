import type { AuthContext } from "./context.ts";
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
 * 导航行图标：宿主 `settings.section` 没有 `icon` 选项（只有 id/order/label），第三方段的
 * 图标恒为宿主默认齿轮；插件侧没有官方挂载点，因此不抢宿主 nav 的 DOM（评审 D24 已否掉
 * 该方案），自设计图标只画在我们自己的内容区里（见 account-form.tsx 的 AccountIcon）。
 */
export declare const inject: string[];
export declare function apply(ctx: AuthContext): void;
//# sourceMappingURL=index.d.ts.map