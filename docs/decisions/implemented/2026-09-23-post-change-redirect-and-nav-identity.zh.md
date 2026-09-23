# D24. 改密后的去向、登录页原因提示，与设置导航身份（文案/order/图标）

## 决定了什么

P1 收尾（P1.1）四项，全部不改动已冻结的 `POST /auth/password` HTTP 契约：

1. **改密成功后不再停留在设置面板**：成功文案保留（唯一的"改成功了"证据），停留
   **2500ms** 后 `location.replace("/auth/login?next=%2F&notice=password-changed")`；
   成功态按钮由"关闭"改成**「重新登录」**（点击立即跳、并清掉待跳定时器），焦点在成功态
   渲染后立刻落到该按钮。宿主的 `close` owner prop 不再使用（只关弹窗 = 把人留在死会话 SPA）。
2. **登录卡片支持"原因"提示**：`GET /auth/login` 解析 `notice` query，**精确白名单**只认
   `password-changed` → 渲染编译期常量 `<p class="notice" role="status">Your password was
changed. Sign in with your new password.</p>`（独立槽，不进 `role="alert"` 的错误槽，
   排在错误之前）。**只挂密码卡**：TOTP 挑战页、401/429 失败页、`POST /auth/login` 的任何
   重新渲染都不带 notice（POST 路径根本不解析该参数）。
3. **设置导航身份**：section id 保持 `dsh-auth-gate-account`（**绝不**占用宿主的 `account`），
   nav 文案 `账户` → **`账号安全` / `Account security`**，`order` 500 → **900**；内容区补一句
   "本地登录凭据，与 DeepSeek 云账户无关"。
4. **不抢宿主的导航 DOM**：宿主 `settings.section` 的注册选项只有 `id`/`order`/`label`，
   导航图标由宿主 `nav-icon` 的硬编码 if 链决定（第三方段一律默认齿轮）→ 我们**不做**基于
   `MutationObserver` 的导航行替换，自设计图标（盾 + 钥匙孔，16px outline）只画在插件自己的
   内容区，同时作为资产落 `docs/demo/account-security.svg` 供 README / 上游 PR 复用。

## 背景

- 服务端在返回 `200 {"ok":true}` 之前就清 cookie 并吊销该用户**全部**会话，所以成功那一刻当前
  设备已经是"死会话壳"：停在面板上，之后每个请求都会 401。这是"直接回登录页"的产品动因。
- 宿主排序只按 `order` 升序（`sort((a, b) => a.order - b.order)`），**没有并列决胜**：同 order
  时按插件注册顺序，跨安装不稳定。已知占用：宿主 `general 0` / `models 10` / `plugins 15` /
  `agent-presets 20`，0.1.7 起还有官方云账户段 `account -10`；姊妹包 `dsh-plugin-subscriptions`
  订阅页 `90`。
- 0.1.7 起宿主自带 `@deepseek-ai/dsh-client-ui-settings-account`（官方云账户：登录 DeepSeek /
  API Key / 余额），注册的正是 `id: "account"`。同 id 会让 `only` 过滤同时挂载两段内容。
- 登录卡片是**服务端渲染的英文**（`Sign in` / `Invalid username or password.`），客户端词典
  管不到它，所以 notice 文案也用英文常量。

## 考虑过的替代方案

- **服务端 302 跳登录页**：`fetch` 会跟随 302 并把 JSON 体吞掉，与冻结的 200 JSON 契约冲突；否。
- **`location.assign` 而不是 `replace`**：死页面留在历史栈里，用户登录后按返回键回到"看起来还在
  设置、其实已失效"的壳，还可能命中 bfcache；否。
- **用短命 cookie / flash cookie 携带 notice**：对"之后刷新登录页仍能看到原因"更稳，但扩大会话面
  （多一个可被第三方设置的 cookie 槽），收益只是文案；否。
- **抢 `id: "account"` 以复用宿主的 person 图标**：与官方云账户段撞 id（0.1.7 双挂载）+ 语义错位
  （那是 DeepSeek 云账户，我们是本地登录凭据）；否。**负向测试**已钉 `id !== "account"`。
- **导航行 DOM 增强**（按当前 locale 文案定位自己的 nav 按钮，隐藏宿主齿轮、插入自绘 SVG，
  `MutationObserver` 重放）：能把图标画到导航行，但那是和宿主 React 抢 DOM——reconcile 可能丢掉
  自插节点造成闪烁，按可见文案当选择器随宿主改版失效，还要为它烧掉文件行数与测试预算。
  评审结论"直接砍掉"，改为内容区自绘 + 上游提案；**提案源码留档**
  `notes/tech/dsh-auth-gate/references/pwchange-p1-2026-09-23/proposal-nav-icon/`（不在产品代码里）。
- **保持 `order 500` / 或反向挪到 `5`（贴近官方账户段）**：500 与后来者更易撞，且宿主的
  `-10 … 20` 之间没有契约空隙、后补官方段会插队；否。

## 为什么这样选

- **replace + 定时器 + 可点按钮**：三个出口都指向同一 URL —— 自动跳是体验、按钮是兜底、焦点是
  可达性（WCAG 2.2.1：2.5s 的时间限制必须有等价的即时操作）。按钮永不 disable。
- **notice 走白名单常量**：所有文案来自编译期常量，query 只用来**选**文案，不做任何拼接或回显
  —— 反射型 XSS / 开放重定向在这条路径上不成立；且 notice 与 `next` 校验互不影响（`validateNext`
  仍在原位）。测试断言"响应体不含攻击串"与"失败页无 notice"。
- **order 900 而不是"保留区"**：只声明"大于已知全部条目、落在导航靠后"，不承诺全局最后（宿主没有
  并列决胜，承诺不了）；谁先到谁先用 900，撞车按 901/902 递增。导航靠后也符合"账号安全压轴"的
  设置页惯例，并避开宿主 nav 列没有滚动条时的溢出风险。
- **图标留在自己的树里**：可测（jsdom 断言存在 + `aria-hidden`）、可卸载、零宿主耦合；宿主哪天给
  `settings.section` 加上 `icon` 选项（或 `navIcon` 认得我们的 id），再切换到官方 API 即可。

**残留**：notice 只在当前设备可见（其他设备被服务端吊销会话，浏览器无从得知原因）；之后手动刷新
登录页仍带 query 所以仍显示，但登录成功离开后即消失；2.5s 内若宿主的全局 401 处理抢先导航，
notice 可能丢失（最坏情况退化为一张普通登录卡，不影响安全与功能）；导航图标在宿主未提供 API 前
恒定是默认齿轮。

## 迁移条件（宿主升级时按这张表动作）

| 触发                                                                                | 动作                                                                         |
| :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| 宿主给 `settings.section` 加 `icon` 选项，或 `navIcon` 认得 `dsh-auth-gate-account` | 改走官方 API 传图标；内容区那枚自绘图标可撤（避免同一屏出现两枚）            |
| 另一插件也注册 `order: 900`                                                         | 我们让到 901/902（同上，谁先到谁先用）                                       |
| 宿主排序加了并列决胜（例如按 id）                                                   | 900 仍然合法，不必去抢"最后"                                                 |
| 宿主全局 401 处理在 2.5s 内抢先导航                                                 | notice 丢失，退化成普通登录卡（无安全影响，已知）                            |
| 宿主官方云账户段的中文 label 也叫「账户」                                           | 已用「账号安全」+ 内容区"本地登录凭据"拆语义；**不要**改 id 去抢 person 图标 |
| 宿主把成功态所在的 section 在改密后被卸载                                           | 跳转由模块级定时器保证（见 `account-redirect.ts`），卸载不取消               |
