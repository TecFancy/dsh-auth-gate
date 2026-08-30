# GUI 登出入口（client 半边）实施规格

> 范围：dsh-auth-gate 的 client 半边（browser 插件）。登出入口最初挂在会话头部右上角
> （`conversation.session.header.utilities`）与新会话页右上角浮动（`shell.overlay`），
> 后两次改版（侧边栏 footer 行 → 本版）最终落在**设置面板**：设置 → 通用设置 页底部
> 一个居中的醒目「退出登录 / Sign out」按钮，文案接入 dsh 现有 locale 机制（随界面语言
> 切换）。服务端端点（`POST /auth/logout`、`GET /auth/status`）M2/M3 已冻结并发布，
> 本规格只动渲染层、打包层与文档。

---

## 1. 背景与目标

关闭登出闭环：认证后在 GUI 内一键登出。历史：0.6.5 放右上角（会话头部 + 新会话页
浮动图标）→ 0.7.1 初版改侧边栏 footer 行 → 用户回退到「收进设置面板」，最终定为
**设置 → 通用设置 页最下方的居中危险样式按钮**（避免右上角/侧边栏出现高频占位，
同时也避开「footer action 渲染在设置触发行上方」的 shell 顺序问题）。

挂载契约（dsh 0.1.0-rc.7，本机 harness 与生产同为该版本）已实测核实：

- **挂载点 `settings.general.item`**（ui-settings-general 的 General 页声明、root
  作用域、**list** 槽、`replaceRisk: none`）：「设置 → 通用设置」页的一条可追加行，
  与 Agent 预设（-25）、权限（-20）、语言（0）、外观（10）、Enter 行为（20）同列表，
  `order: 30` 排在最后 → **页面最下方**。注册契约 `{ id, order, label? }` + `locale`
  （命名 `t` seat）；owner props 为空（`SettingsGeneralItemOwnerProps {}`）——行内
  部（图标/文案/行为/可访问名）全部由本插件自绘。
- **移除三处旧挂载**：`conversation.session.header.utilities`、`shell.overlay`
  （右上角两处）与 `sidebar.footer.action`（侧边栏脚区行）。此后右上角与侧边栏
  footer 均不再有登出入口。
- **i18n**：文案经 `ctx.locale`（`dsh-client-locale` 的 LocaleRuntime）注册 `auth`
  命名词典（zh/en 双语），槽位注册带 `locale: "auth"` → 渲染器给组件注入 `t` seat
  （与「设置」里语言切换同一套机制；lookup 链 = 命名域 → common → 键自身）。语言切换
  时 ledger 版本 bumped，`t` 读取活动语言即时跟随。
- **端点约束（不变）**：`POST /auth/logout?next=/`（GET → 405，M22：next 仅从 query
  取，校验回落 `/`）；`GET /auth/status` → `{"authenticated":true|false}`（只认 cookie）。

## 2. 冻结决策

| #   | 决策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 单处注册：`settings.general.item`，id `dsh-auth-gate-logout`，`order: 30`（General 页最后一条），`locale: "auth"`，`label` 为 thunk（`() => t("logout")`）。**移除**旧三处：`conversation.session.header.utilities`、`shell.overlay`、`sidebar.footer.action`。                                                                                                                                                                                                                                                                                                                       |
| D2  | 登出仍走原生 `<form method="post" action="/auth/logout?next=/">`（零 JS 依赖；302 回落 `/` → 门禁 → 登录页）                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D3  | 会话状态：组件挂载时 `fetch("/auth/status")` 一次；`authenticated: true` 才渲染，否则渲染 null（无残留 UI）                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D4  | 视觉：设置面板内**居中醒目 CTA**（不再 32px 圆形图标、也不再列表行）——16px 方块+箭头 SVG（viewBox 24 不变，仅 width/height 16）+ 本地化文字；容器 `display:flex; justify-content:center; padding:20px 0 4px`；按钮 `inline-flex; gap:8px; padding:10px 24px; border-radius:12px`，填充 `--dsw-alias-state-error-primary`（危险动作语义）+ 文字 `--dsw-alias-label-primary-inverted`（反色标签），hover `filter: brightness(1.08)`（主题自适应，不硬编码色值）。内联 style，不引 CSS 文件、不引 primitives（依赖最小化）。对话框/面板结构由设置 shell 提供，本入口不占用任何 single 槽 |
| D5  | i18n：`apply` 内 `ctx.effect(() => [ctx.locale.register("auth","zh",{logout:"退出登录"}), ctx.locale.register("auth","en",{logout:"Sign out"})], ...)`（双语词典挂纤维卸载级联）；槽位注册 `locale: "auth"` 注入 `t` seat；按钮文字与 `aria-label`/`title` 都用 `t("logout")`。不新建语言切换 UI（切换已存在于设置——General 的 Language 行）                                                                                                                                                                                                                                          |
| D6  | 类型：延续本地结构镜像（`src/client/context.ts`，`AuthLocaleService` + `effect` 面、注册选项 `locale`），不 import 任何 `@deepseek-ai/*` 运行时值；manifest inject 不变；服务面 inject 为 `["slots", "locale"]`（locale 是 dsh 客户端内置服务，设置页语言行同源）                                                                                                                                                                                                                                                                                                                     |
| D7  | 构建：不变（tsdown 单入口 `src/client/index.tsx` → `lib/client.js`，ModuleLoader id = 包名；client 声明通道生成 `lib/client/index.d.ts`）                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D8  | 测试：jsdom（`@vitest-environment jsdom`）单测覆盖 apply 注册（新增 `settings.general.item`、双语词典注册、`locale`/`order`/thunk label）与组件分支（authenticated 真/假、文字标签 zh/en、form action/method、可访问名、hover 提亮）；fetch mock。已删除 HeroLogoutAction / SidebarLogoutAction 相关测试，统一为 `SettingsLogoutAction`。                                                                                                                                                                                                                                             |
| D9  | 范围外：右上角/侧边栏入口复现、登出确认弹窗、`/auth/status` 轮询（仅挂载时一次）、client 登出后在 SPA 内的无痕刷新（302 整页跳转）、除按钮文字外的任何新 i18n。不改服务端端点/门禁/会话语义。                                                                                                                                                                                                                                                                                                                                                                                         |

## 3. 文件蓝图

| 文件                                                            | 动作     | 说明                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/client/context.ts`                                         | 改       | 镜像新增 `AuthLocaleService`（register/bind）与 `AuthContext.effect`；`AuthSlotRegisterOptions` 增 `locale?: string`                                                                             |
| `src/client/logout-action.tsx`                                  | 改       | `SettingsLogoutAction`（`{ t? }`）：`useAuthenticated` 门控 + `<form>` + 居中危险 CTA（16px 图标 + `t("logout")` 文字，hover 提亮）                                                              |
| `src/client/index.tsx`                                          | 改       | 注册词典（zh/en，zh=退出登录）→ `ctx.slots.inject("settings.general.item", ...)` 单处注册（`locale`/`order:30`/thunk label）；移除三处旧注册；`inject = ["slots","locale"]`                      |
| `src/client/logout-action.test.tsx`                             | 改       | apply 断言：双语词典注册 + 单槽注册；组件断言：zh/en 文字、无认证隐藏、hover 提亮（见 D8）                                                                                                       |
| `docs/implemented/impl-client-logout.md`                        | 改       | 本规格（即此文件）                                                                                                                                                                               |
| `docs/deployed/deployment.md` / `_zh`、`README`、`README.zh.md` | 改       | 「右上角/侧边栏底部登出」描述 → 设置面板醒目退出登录按钮；删过时截图 `docs/demo/logout-hero-blank.png`、`logout-conversation-en.png`；设计预览 `docs/design/**` 仅作历史参考、不再在 README 链接 |
| `lib/client.js`、`lib/client/index.d.ts`                        | 构建产物 | 与 src 同批提交                                                                                                                                                                                  |

## 4. 验证步骤

1. `npm run verify`（format:check + lint + type-check（含 client 通道）+ test:coverage
   - lock:check）全绿，覆盖率 ≥80%。
2. `npm run build`：`tsc -p tsconfig.build.json` + `tsdown` + client 声明通道；
   `git diff --exit-code -- lib` 通过（产物同批提交）。
3. 部署到生产（tencent-cloud，`dsh-web.service`）后真实浏览器验证：登录 → 设置 →
   通用设置 → 页底出现居中的「退出登录 / Sign out」按钮 → 切换语言 → 按钮文字在
   「退出登录」/ "Sign out" 间切换 → 点击 → 302 回落登录页 → 未带 cookie 的 SPA 请求
   被门禁拦截。**会话头部右上角、新会话页右上角与侧边栏 footer 均不再有登出入口**。
   按 `docs/specs/development.md` "GUI demos"约定配演示（截图 + 说明证明了什么）。
4. 提交 development → PR → main（`feat:` → release-please）。

## 5. 明确不做的事

- 不引入任何第三方运行时资源；client bundle 仍只依赖平台模块表（react）。
- 不改动任何服务端端点/门禁/会话语义。
- 不替换 `settings.section`/`settings.trigger` 等 single 槽（设置面板结构仍归
  ui-settings-general / ui-settings）；只用**可追加**的 `settings.general.item`；
  不碰侧边栏 shell、不占 `sidebar.footer.action`。
- 不在设置之外新增语言切换控件（切换已存在于设置的 General → Language 行，这次只
  让登出按钮文字跟随）。
- 不做 i18n 之外的 UI 改动（确认弹窗、暗色模式专用样式等）。

## 6. DoD（完成定义）

1. §3 文件全部落地，`npm run verify` 全绿，`lib/` 与 `src/` 同批提交。
2. 生产部署后真实浏览器验证登出闭环（位置、双语文字、右上角/侧边栏无残留）。
3. 提交信息符合 commitlint（`feat(client): move sign-out into settings as a centered
CTA`），未在未经用户指示的情况下 push。
