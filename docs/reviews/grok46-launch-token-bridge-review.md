# Grok 4.6 Review — launch-token 自动桥（commit 19c8431）

- **日期**: 2026-09-01
- **审阅者**: grok-4.6（subscription，500K 上下文，xhigh effort 可用）
- **范围**: `feat: bridge dsh launch token into password login session`（19c8431，development）
- **结论**: **request-changes**
- **标准**: 仓库 `AGENTS.md` + `.agents/skills/dsh-auth-code-review/SKILL.md`（enforcement / 文档同步 / 真入口测试 / fail-closed 纪律）
- **对照实现**: dsh 0.1.2-alpha `dsh-client-connection` `BrowserAuth.authenticatedUrl` / `authorizeIndex`

## 总评

这次桥接的 fail-open 和 TOTP 复用是对的，但 302 Location 把未校验的 Host 和硬编码 `http` 拼进带 launchToken 的绝对 URL，等于在登录成功路径上做了凭证型跳转；再叠加仓库现有「半外壳重写 Host」推荐拓扑和零文档，生产上很容易 302 到 `127.0.0.1` 或明文 http。应改为相对路径 `/?token=…`（不要用 Host 拼 origin），补校验与文档后再合。

---

## Findings

| ID  | Severity | Title                                                        |
| --- | -------- | ------------------------------------------------------------ |
| F1  | major    | 302 Location 由未校验 Host 拼出，并携带 process launchToken  |
| F2  | major    | 硬编码 `http://` 在 TLS 反代部署上下发明文绝对跳转           |
| F3  | major    | 本次变更零文档，且与现有推荐反代拓扑直接冲突                 |
| F4  | minor    | connection 缺失完全静默，catch 文案误导且会毒化一次性告警闩  |
| F5  | minor    | 测试未覆盖 bridge 装配点，也未锁住「成功仍发会话 cookie」    |
| F6  | nit      | `makeLaunchTokenBridge` 永不返回 undefined，条件展开是死代码 |

### F1 — major — 302 Location 由未校验 Host 拼出，并携带 process launchToken

**位置**: `src/index.ts` `makeLaunchTokenBridge`（约 L128–L133）；`src/features/password/session-issue.ts` L35–L43；Host 来源 `src/features/password/password-login.ts` L86。

**问题**: `req.headers.host` 直接拼进 `` `http://${host}` ``，`authenticatedUrl` 的返回值原样成为 302 `Location`。dsh 侧实现是：

```js
authenticatedUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", this.launchToken);
  return url.href;
}
```

主机名不被改写。登录成功后浏览器可被送到 `http://<Host>/?token=<process launchToken>`。浏览器同源 POST 不能伪造 Host，所以这不是一键 CSRF；但反代/CDN/绝对形式请求/畸形 Host 可以把进程级令牌送到错误 authority。`issueSession` 对返回 URL 的 scheme/host/pathname/query 也零校验。

**改法**: 不要用 Host 拼 origin。调用 `authenticatedUrl("http://127.0.0.1")` 只为取出 token，然后 302 到相对地址 `/?token=<token>`。相对 Location 锁在浏览器当前 origin，并同时消掉 F2。若仍走绝对 URL，必须 WHATWG 规范化后要求 host 与请求 Host 一致、pathname 为 `/`、仅允许 `token` 查询参数，否则回退 `next`。

### F2 — major — 硬编码 `http://` 在 TLS 反代部署上下发明文绝对跳转

**位置**: `src/index.ts` L133：``connection.authenticatedUrl(`http://${host}`)``。

**问题**: 生产是 Caddy 终结 HTTPS、node 只听 loopback。登录页在 `https://<公网Host>`，成功后 Location 却是 `http://<Host>/?token=…`。token 进入 :80 访问日志/明文链路；80 未开则用户停在「已登录但进不了 /」；即便 Caddy HTTP→HTTPS 保留 query，也多一跳、双份日志。`authenticatedUrl` 契约要求的是 canonical browser origin。`cookieSecure` 默认 `true`，与写死 http 矛盾。

**改法**: 与 F1 一并改为相对 `/?token=…`。不要读 `X-Forwarded-Proto`（可伪造，与 P10 不读 XFF 同一纪律）。若必须绝对 URL，仅当 `cookieSecure === true` 时用 https，并在文档写明只覆盖「TLS 终结 + 透传 Host」这一种拓扑。

### F3 — major — 本次变更零文档，且与现有推荐反代拓扑直接冲突

**位置**: commit `19c8431` 仅 `src/` 四文件；冲突文档 `docs/deployed/reverse-proxy.md` / `reverse-proxy_zh.md` §3–§4.2。

**问题**: 现有文档把半外壳定为推荐：`header_up Host 127.0.0.1:3080`。按文档部署时，bridge 会 302 到 `http://127.0.0.1:3080/?token=…`：公网浏览器跳到用户本机或失败；即便打到 dsh，`authorizeIndex` 按请求 Host 绑定 cookie，mint 出 127.0.0.1 的 host-only cookie，公网 origin 下次仍 401。Review 包「必须透传 Host」与已发布推荐配置相反，且未落盘。`next` 被无条件丢弃同样未写。code-review skill 的 blocking 项「Docs match the code」未满足。

**改法**: 不改 frozen `impl-m3.md`。新增 `docs/implemented/impl-launch-token-bridge.md`，并同步反代文档与 README：0.1.2-alpha+ 启用本桥时，Host 重写会绑错 mint cookie；设置页 403 与 launch-token cookie 不能靠同一套 Host 重写同时修好。

### F4 — minor — connection 缺失完全静默，catch 文案误导且会毒化一次性告警闩

**位置**: `src/index.ts` L125–L140。

**问题**: `connection === undefined` / 无 `authenticatedUrl` 时直接 `undefined`、不打日志；`warnedMissing` 只在 catch 置位。接线失败时登录仍 302 到 `/`，随后撞 token 门 401，运营侧零信号。非法 `baseUrl` 导致 `new URL` 抛错时，日志写成 `connection service is unavailable` 并锁死闩。官方 bridge 只 `resolve(undefined)` 从不 reject，`issueSession` 的 catch 实际上接不住它。

**改法**: undefined/无函数 → 进程内 warn 一次；函数抛错 → warn 并带 `error.message`；两把闩分开。fail-open 行为可保留。

### F5 — minor — 测试未覆盖 bridge 装配点，也未锁住「成功仍发会话 cookie」

**位置**: `src/features/password/password-endpoints.login-bridge.test.ts`；缺失于 `src/integration.password.test.ts`。

**问题**: 5 个用例注入 fake `launchTokenBridge`，绕过 `ctx.get("connection")`。静默挂载失败正是本变更的核心风险。命中路径未断言 `Set-Cookie` 仍含 `dsh_auth`，也没有外链 Location / 畸形 Host 回归。

**改法**: 集成测试 provide 假 `connection.authenticatedUrl`，断言相对 Location + 会话 cookie。单元测试：外链 Location 必须回退 `next`。

### F6 — nit — `makeLaunchTokenBridge` 永不返回 undefined

**位置**: `src/index.ts` L124、L225。

**问题**: 签名是 `| undefined`，实现总是返回闭包；`...(launchTokenBridge === undefined ? {} : { launchTokenBridge })` 恒走后者。

**改法**: 删掉 `| undefined` 和条件 spread，或在 apply 时探测一次再决定是否注入。

---

## §5 关注点逐条回应（评审输入包原 6 问）

### 1. 安全：token 出现在 302 Location 的泄露面

**结论**: 进程级随机 token 本身可接受，但**当前绝对 URL 拼法不可接受**（见 F1/F2）。泄露面也不等于「启动打印 URL」。

**论证**:

- Token 生成：`processLaunchToken` 用 `randomBytes(32)` base64url，挂在 process owner 的 WeakMap 上，进程内稳定复用。`authenticatedUrl` **每次调用不会生成新 token**，也不可预测。这部分没有问题。
- 启动打印 URL 在本地 stdout，受众是操作者。本桥把同一 token 放到**每一次成功登录**的 `Location` 上：Caddy/node access log、反向代理日志、浏览器历史、Referer（若后续跨站）、截屏。303 的 `referrer-policy: no-referrer` 在 dsh `authorizeIndex` 上，**auth-gate 自己的 302 没设这个头**。频率从「每进程一次」变成「每登录一次」，不能再说暴露面等同。
- 更安全的替代：
  1. **相对 `/?token=`（推荐，本插件可独立落地）**：不把 Host/scheme 交给 Location，mint 仍由 dsh 按真实请求 Host 绑 cookie。
  2. **auth-gate 直接写 dsh cookie**：要读 `credentials` 里 `client-connection/browser-session` grant、复刻 `dsh-auth-` + sha256(authority) 命名和 HMAC payload，和 dsh 版本绑死，拒绝。
  3. **dsh 改固定 token / 另开 mint RPC**：需要上游，超出本仓库；固定 token 比进程随机更差。
- 在改成相对 Location 之前，不要合入。日志侧应在反代文档要求对 `token=` query 做 redact（Caddy `log_skip` / 过滤器），这是运营缓解，不是代码借口。

### 2. 正确性：`ctx.get("connection")` 与静默回退

**结论**: 惰性 `ctx.get` 的模式与 `makeTokenResolver` 一致，**接线本身大概率能工作**；但缺失路径比 credentials 更盲，会把「桥没挂上」伪装成「用户还要手动贴 token」（F4）。

**论证**:

- `HostConnectionService` 以 `"connection"` 为名 `provide`（dsh-client-connection `super(ctx, "connection")`）。auth-gate 是同一 web profile 上的 Host 插件，cordis 子 ctx 默认能读到祖先服务。credentials 用同一惰性 get，生产已验证——所以「profile 层绝对读不到 root」不是第一假设。
- 真正的正确性洞在观测性：`connection === undefined` 或旧版无 `authenticatedUrl` 时零日志（`src/index.ts` L130–L131）。credentials 缺失是 fail-closed + `log.error`；这里是 fail-open + 静默。用户表现是登录 302 成功，紧接着 `/` 401，和改之前一样，运营会以为 0.1.2 桥「坏了」而不是「没接到」。
- `try/catch` 包住 `ctx.get` + `authenticatedUrl()` 是对的（`new URL` 会抛）。错在 catch 文案和单闩。
- 手测 e2e 不能替代集成测试锁住 `ctx.get("connection")` 这条装配边（F5）。建议补真栈测试，而不是只加 log。

### 3. TOTP 与限速：跳转差异是否成为新探测面

**结论**: **没有在 denial 路径上引入新的可探测面。** 成功路径的 Location 形态变了，但不能用来枚举用户或绕限速。

**论证**:

- 密码错误 / 未知用户 / 禁用：仍是 401 `invalid credentials`（`rejectedInvalid`），不进 `issueSession`。
- TOTP 错码：仍是 401 + 挑战页 HTML（`rejectTotp`），挑战 cookie 保留。
- 限速：仍是 429 + `retry-after`，在 `issueSession` 之前（`rateLimitOk`）。
- TOTP 第一段成功：仍 302 到 `/auth/login?next=…`，**不走 bridge**（`handlePasswordSubmit` 的 `needsTotp` 分支未改）。
- 第二段成功：与纯密码成功一样走 `issueSession` → bridge（`password-login.ts` L148–L155，测试 `bridges on TOTP challenge submit`）。攻击者若已能打出这条 302，说明 TOTP 已经通过，Location 是绝对还是相对没有额外信息。
- 成功时 `Location` 从相对 `next` 变成绝对带 token，只区分「这台 dsh 是否暴露了 authenticatedUrl」，且前提是已经认证成功。限速计数在 `recordSuccess` 之后，bridge 抛错也已经清桶——这是原 P10 语义，不是新洞。
- 不要在失败响应上做任何 Location 差异。当前没有。保持。

### 4. 多 Host：LAN IP + 域名双入口

**结论**: **没有跨 authority 的 cookie 混淆（cookie 名绑定 authority）**；风险是「两个入口两张 30 天票」和「Host 重写把票签到 127.0.0.1」。这是 dsh 门的既有模型，本桥会把它从手工 URL 变成登录自动触发，从而更容易踩。

**论证**:

- dsh cookie 名 = `dsh-auth-` + sha256(authority)，payload 内也签了 authority（`requestAuthority` = `new URL("http://" + host).host`）。`example.com` 上 mint 的票，带 `Host: 10.0.0.5` 的请求验不过。不存在「域名票在 LAN IP 上复用」的混淆。
- 单门模型（plan §1）：过任一入口 = 全实例权限。双入口只是两张等价的全权票，不是提权。
- 若 Caddy 把两个入口都重写成 `127.0.0.1:3080`，两入口 mint 的是**同一张** loopback 票；浏览器在公网 origin 上存不到它（host-only）。这是 F3 的生产失败模式，不是 LAN/域名串票。
- 相对 `/?token=` 之后，mint 请求的 Host 仍是浏览器实际访问的那个。双入口各自 mint 仍然成立，且不再被 bridge 的 `http://${host}` 二次改写。文档写一句即可，不必在代码里做 Host 白名单（白名单是 dsh `trustedHosts` 的职责）。

### 5. 测试强度

**结论**: 5 个单测对 **issueSession 的 fail-open 分支**够用，对 **bridge 装配与重定向安全**不够。建议补集成测试，但不把「补 integration.password.test.ts」当成唯一阻塞；F1/F2 的回归用例更急。

**论证**:

- 已覆盖：命中、`undefined`、throw、无 Host、TOTP 第二段。这锁住了「桥失败不得挡住 302 发会话」这一产品决策。
- 未覆盖（skill「Real entry path」）：`apply` → `makeLaunchTokenBridge` → `ctx.get("connection")`。hand-mounted fake 把装配点整个剪掉。
- 未覆盖（安全）：外链 Location、`http://` 绝对 URL、相对 Location 断言、成功时 Set-Cookie。
- 实盘 e2e 有价值，但不能进 CI，也不能捕捉 Host 重写/HTTPS 降级。
- **需要补集成测试**：是，最小一条即可（假 connection + POST `/auth/login` + 断言 Location 与 Set-Cookie）。现有 `mountPasswordStack` 已有真 cordis/webserver/storage，加 `ctx.provide`/`plugin` 一个假 connection 的成本低。不是「再堆 5 条单测」。

### 6. 文档同步

**结论**: **不要写入 `impl-m3.md`（frozen）**。应单开 `docs/implemented/impl-launch-token-bridge.md`，并改反代文档与 README。当前 diff 文档为零，按仓库标准不能合。

**论证**:

- `AGENTS.md`：`impl-m3.md` 是 M3 的 sole authority，P14 写明成功 → 302 `next`。本桥改写了这条成功路径，属于 M3 之后的增量，硬塞进 frozen spec 会让后续维护者以为是 P14 原行为。
- 命名：`impl-bridge.md` 太泛（仓库还有 proxy/半外壳）。建议 `impl-launch-token-bridge.md`，文首声明「非 M3，dsh ≥ 0.1.2-alpha 的兼容层；旧版零行为变化」。
- 必须写进该文档的决策：fail-open 仅作用于成功 redirect；相对 Location；`next` 丢弃原因（dsh 只在 `pathname === "/"` mint）；TOTP 第二段同样生效；与半外壳 Host 重写不兼容；access log 含 token。
- `docs/specs/dsh-auth-plan.md` 不必改（路线图不是变更日志）。`CHANGELOG` 由 release-please 在 squash 进 main 时生成，本次不要手改。

---

## 建议落地顺序（合入前）

1. **改跳转构造（F1+F2）**：`authenticatedUrl` 只取 token → `Location: /?token=…`；非法返回值回退 `next`。
2. **补测试（F5）**：外链回退 + 真栈假 connection + Set-Cookie。
3. **写文档（F3）**：`impl-launch-token-bridge.md` + 反代指南修正 + README 一句。
4. **补日志（F4）**、顺手删死代码（F6）。

不改 denial 路径、不改限速、不把桥接到 token 模式（本次范围是 password/TOTP；token 模式若也要直达，另开变更）。

---

## 审查范围外、明确不作为 finding

- token 模式 `POST /auth/login` 仍 302 `next`、不走桥：本次提交说明只覆盖 password。
- `password-login.ts` 行数已超 P24 的 250：抽出 `session-issue.ts` 是在还债，不是本桥引入的超标。
- 登录 CSRF 仍缺（P21）：本桥未放大 denial/跨用户隔离（计划已决定无多用户隔离）。
