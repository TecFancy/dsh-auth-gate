# GUI 登出按钮（client 半边）实施规格

> 范围：新增 dsh-auth-gate 的 client 半边（browser 插件），在 dsh GUI 会话头部
> 右上角（Session log 右侧）挂一个纯图标登出按钮。服务端端点（`POST /auth/logout`、
> `GET /auth/status`）M2/M3 已冻结并发布（0.5.1），本规格只动渲染层与打包层。

---

## 1. 背景与目标

当前登出只能手输 URL（`docs/deployment_zh.md` G 节："登出按钮未实现，URL 访问
`/auth/logout?next=/` 登出"）。计划（`docs/dsh-auth-plan.md`）与 handoff-m2/m3 均把
"client 半边登出按钮（GUI 组件）"列为候选后续。登录页美化（0.5.1）已闭环，本次
补齐登出闭环的最后一环：认证后在 GUI 内一键登出。

挂载契约已在 dsh 0.1.0-rc.6（本机 harness 与生产同为该版本）上实测核实：

- **client 插件机制**：package.json 声明 `dsh.client` manifest（`inject` + `platform:
"web"`）+ `exports["./client"]` 指向 `lib/client.js`；产物为
  `window.__ModuleLoader__.load({ id, factory })` 格式（tsdown 构建，CJS closure，
  模块表外部化 react 等平台模块）。参考实现：`dsh-better-sidebar`（生产已部署）。
- **挂载点**：`conversation.session.header.utilities` —— list 槽位、session
  作用域（会话打开时在）恒显示、`replaceRisk: none`（可追加，不替换任何 shipped
  UI）。注册契约 `{ id, order, label }`；owner props 为空
  （`ConversationHeaderActionOwnerProps {}`），头部按钮只从 standard session
  kit 取数。
- **端点约束**：`POST /auth/logout?next=/`（GET → 405，M22：next 仅从 query 取，
  校验回落 `/`）；`GET /auth/status` → `{"authenticated":true|false}`（只认 cookie，
  Bearer 不参与）。两者均走包装前捕获的原始 register，属 gate 白名单路径。

## 2. 冻结决策

| #   | 决策                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | 挂载点 `conversation.session.header.utilities`，entry id `dsh-auth-gate-logout`，`order: 10`（位于 shipped 的 Session log 入口右侧），`label: "Sign out"`（i18n 延后，暂英文）                                                                                                                                                                                                                                                             |
| D2  | 登出走原生 `<form method="post" action="/auth/logout?next=/">`（零 JS 依赖；302 回落 `/` → 门禁 → 登录页）                                                                                                                                                                                                                                                                                                                                 |
| D3  | 会话状态：组件挂载时 `fetch("/auth/status")` 一次；`authenticated: true` 才渲染，否则渲染 null（无残留 UI）                                                                                                                                                                                                                                                                                                                                |
| D4  | 视觉：会话头部右上角 32px 圆形**纯图标**按钮（无文字，`aria-label`/`title` 提供可访问名）——边框 `--dsw-alias-border-l2`、图标色 `--dsw-alias-label-primary`、hover 背景 `var(--dsw-alias-interactive-bg-hover)`（浅 `rgba(38,49,72,.06)` / 深 `rgba(255,255,255,.08)`，随主题自适应），与 Session log/图标按钮同表面语言。内联 SVG（logout 图标，`stroke="currentColor"`），样式用内联 style，不引 CSS 文件、不引 primitives（依赖最小化） |
| D5  | 类型：本地结构镜像（`src/client/context.ts`），不 import 任何 `@deepseek-ai/*` 运行时值；manifest `inject: ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-slots"]`；bundle 外部化 `react`、`react/jsx-runtime`                                                                                                                                                                                                            |
| D6  | 构建：`tsdown`（devDep ^0.22）单入口 `src/client/index.tsx` → `lib/client.js`（banner/footer 包 ModuleLoader，id = 包名 `dsh-auth-gate`）；`lib/client/index.d.ts` 由独立 tsc 声明通道（`tsconfig.client.json`，emitDeclarationOnly）生成；主构建（tsconfig.build.json）排除 `src/client`                                                                                                                                                  |
| D7  | 测试：jsdom（`@vitest-environment jsdom` pragma）单测覆盖组件分支（authenticated 真/假、纯图标无文字、form action/method、可访问名）与 apply 注册参数；fetch mock                                                                                                                                                                                                                                                                          |
| D8  | 范围外：i18n、暗色模式、登出确认弹窗、`/auth/status` 轮询（仅挂载时一次）、client 登出后半边 UI 的 SPA 内无痕刷新（302 整页跳转）                                                                                                                                                                                                                                                                                                          |

## 3. 文件蓝图

| 文件                                     | 动作     | 说明                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                           | 改       | + `dsh.client` manifest；+ `exports["./client"]`；+ devDeps（react、react-dom、@types/react、@types/react-dom、@deepseek-ai/dsh-client-runtime、@deepseek-ai/dsh-client-ui-slots、tsdown、jsdom）；scripts：build/type-check 追加 client 通道 |
| `tsdown.config.ts`                       | 新       | 最小 client bundle 配置（cjs/browser/external/ModuleLoader 包装/codeSplitting: false）                                                                                                                                                        |
| `tsconfig.client.json`                   | 新       | client 编译单元：lib DOM、jsx react-jsx、严格旗标同主配置；noEmit 用于 type-check，emitDeclarationOnly+outDir lib 用于声明产出                                                                                                                |
| `tsconfig.json` / `tsconfig.build.json`  | 改       | exclude `src/client`（主构建是 node 通道）                                                                                                                                                                                                    |
| `vitest.config.ts`                       | 改       | include `src/**/*.test.{ts,tsx}`；coverage include `src/**/*.{ts,tsx}`                                                                                                                                                                        |
| `src/client/context.ts`                  | 新       | 本地结构镜像：`AuthSlotsService`、`AuthContext`（slots + effect）                                                                                                                                                                             |
| `src/client/index.tsx`                   | 新       | client 插件：`export const inject = ["slots"]`；`apply(ctx)` 内 `ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({...}, LogoutAction))`                                                                    |
| `src/client/logout-action.tsx`           | 新       | `LogoutAction()`：useEffect fetch `/auth/status` → 门控渲染；`<form method="post" action="/auth/logout?next=/">` + 纯图标按钮（32px 圆形、主题 token hover）+ 可访问名                                                                        |
| `src/client/logout-action.test.tsx`      | 新       | jsdom 单测（见 D7）                                                                                                                                                                                                                           |
| `docs/impl-client-logout.md`             | 新       | 本规格                                                                                                                                                                                                                                        |
| `docs/deployment.md` / `_zh`、`README`   | 改       | 登出按钮已实现说明（G 节更新）                                                                                                                                                                                                                |
| `lib/client.js`、`lib/client/index.d.ts` | 构建产物 | 与 src 同批提交                                                                                                                                                                                                                               |

## 4. 验证步骤

1. `npm install --registry=https://registry.npmjs.org/`（新增 devDeps 后，lock:check
   纪律不变）。
2. `npm run verify`（format:check + lint + type-check（含 client 通道）+ test:coverage
   - lock:check）全绿，覆盖率 ≥80%。
3. `npm run build`：`tsc -p tsconfig.build.json` + `tsdown` + client 声明通道；
   `git diff --exit-code -- lib` 通过（产物同批提交）。
4. 部署到生产（tencent-cloud，`dsh-web.service`）后真实浏览器验证：登录 →
   会话头部右上角（Session log 右侧）出现 Sign out 图标 → 点击 → 302 回落登录页
   → 未带 cookie 的 SPA 请求被
   门禁拦截。按 `docs/development.md` "GUI demos"约定配演示（截图 + 说明证明了什么）。
5. 提交 development → PR → main（`feat:` → release-please 0.6.0）→ 生产切正式版。

## 5. 明确不做的事

- 不引入任何第三方运行时资源；client bundle 只依赖平台模块表（react）。
- 不改动任何服务端端点/门禁/会话语义（`/auth/logout`、`/auth/status`、guard、
  cookie、session 全部保持 M2/M3 冻结行为）。
- 不碰 `sidebar`（整列替换风险）、`settings.*` 等非追加槽位。
- 不做 i18n/暗色模式/确认弹窗（见 D8）。
- 不把 client 包放进 `dependencies`（web app 提供运行时）。

## 6. DoD（完成定义）

1. §3 文件全部落地，`npm run verify` 全绿，`lib/` 与 `src/` 同批提交。
2. 生产部署后真实浏览器验证登出闭环，演示截图 + 说明已附。
3. 提交信息符合 commitlint（`feat(client): add sign-out button to the sidebar foot`），
   未在未经用户指示的情况下 push（push/PR/merge/release 走已建立的用户授权流程）。
