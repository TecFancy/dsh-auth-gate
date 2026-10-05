# impl-launch-token-bridge — dsh launch-token 自动桥

> **状态**: M3 之后的增量（**非** M3 frozen spec 的一部分；`impl-m3.md` P14 的成功路径
> 契约仍为「302 → next」，本文档是其在 dsh ≥ 0.1.2-alpha 上的兼容层覆写）。token 模式
> 同理覆写 `impl-m2.md` 的成功路径契约（issue #99 起）。
> **适用**: dsh ≥ 0.1.2-alpha（存在 `dsh-client-connection` 的 `authenticatedUrl`）；
> 更早版本零行为变化（桥自动回退）。
> **来源**: 2026-08-31 实测（隔离实例 dsh-test.example.com）+ `19c8431` +
> `grok-4.6 review`（`docs/reviews/grok46-launch-token-bridge-review.md`，F1–F6 全部落地）
>
> - `issue #99`（token 模式漏接；grok-4.7 双路复核）。

## 1. 背景

dsh 0.1.2-alpha 起，dsh web 新增**页面级 launch-token 门**（`dsh-client-connection` 的
`authorizeIndex`）：浏览器首次访问必须带启动 token（`/?token=<launchToken>`）才会 mint
一个 30 天有效、绑定 Host authority 的 cookie；无 token 且无 cookie → 401。launchToken
每次进程启动随机（`randomBytes(32)` base64url）。

问题：auth-gate 登录成功后 302 到 `next`，但新浏览器没有 dsh cookie → 仍然撞 token 门，
用户被迫手动从终端复制 `?token=` URL。

issue #99 补上另一半：**token 模式**（M2 共享口令）的登录成功路径此前从未接上这座桥。
新浏览器过完 auth-gate 拿到 `dsh_auth` cookie，却仍然没有 dsh 的 browser-session cookie，
于是每个 `/api` 请求都是 401；当时唯一的补救是让用户再贴一次启动 URL。桥首版是 password
流程的增量，token 模式被划在范围外，这个缺口一直没补。

## 2. 行为契约

| 场景                                                           | 行为                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 密码登录成功（无 TOTP）                                        | 发会话 cookie → 302 **相对** `/?token=<launchToken>`                                                                                |
| TOTP 两段式第二段成功                                          | 同上（清挑战 cookie + 发会话 + 相对跳转）                                                                                           |
| 令牌登录成功（token 模式）                                     | 同上（同一座桥、同一失败语义）                                                                                                      |
| 桥未配置 / connection 缺失 / 旧版 dsh（无 `authenticatedUrl`） | 302 原 `next`，跳转目标零变化（进程内 warn 一次：`launch-token bridge inactive: ...`；响应多一条 `referrer-policy`，见 D-bridge-8） |
| `authenticatedUrl` 抛错 / 返回无 token                         | 302 原 `next`（进程内 warn 一次：`launch-token bridge unavailable: ...`）                                                           |
| 登录失败（401/429/503）                                        | 与 M3/T4（密码）、M2（令牌）完全一致，桥不参与任何失败路径                                                                          |

**fail-open 范围**：桥只影响「登录成功后的 redirect 目标」；denial 路径、限速、TOTP
挑战、会话签发全部不动。桥失败（返回 undefined / 抛错）绝不影响登录成功。

## 3. 冻结设计决策

- **D-bridge-1（相对跳转）**: Location 一律相对 `/?token=...`。token 从
  `connection.authenticatedUrl("http://127.0.0.1")` 的返回值中**只提取 token**，
  host/scheme/其它 query 全部丢弃（`new URL(...).searchParams.get("token")`）。
  理由：a) TLS 反代（Caddy 终结）下写死 `http://` 会造成协议降级 + token 进明文日志
  （grok F2）；b) 未校验的请求 Host 拼进 Location 会把进程级 token 送错 authority
  （grok F1）；c) 相对地址由浏览器按当前 origin 补齐，mint 的 cookie 永远绑定用户
  实际访问的 origin。
- **D-bridge-2（next 丢弃）**: 桥命中时 `next` 被丢弃 —— dsh 的 mint 只在
  `pathname === "/"` 执行，next 目标页无法与 mint 并存；登录后先落 `/`（打 token），
  再 303 回 `/`。深链（`next=/some/page`）在启用桥后不再直达，属已知取舍。
- **D-bridge-3（静默降级纪律）**: 两把闩分开告警、各 warn 一次/进程 ——
  ① 服务缺失/无函数（`inactive`，提示 dsh < 0.1.2-alpha）② 调用/解析异常（`unavailable`
  附带 error message）。避免「缺服务」与「换 Host 触发异常」互相毒化告警
  （grok F4）。旧版行为：此前的实现是打 `error` 且单闩。
- **D-bridge-4（Host 无关）**: 桥不读取也不依赖请求 Host。反代改写 Host（半外壳）与否
  均不影响跳转目标；mint 的 cookie authority 由实际 mint 请求的 Host 决定（见 §4）。
- **D-bridge-5（暴露面）**: 302 Location 携带进程级 launchToken（进入 access log /
  浏览器历史）。与 dsh 启动打印 URL 同一 token、同一暴露面级别（仅进程寿命内有效，
  30 天 cookie 由 dsh 侧管理）。反代建议对 `token=` query 做日志 redact（caddy
  `log_skip` / 过滤器）作为运营缓解。
- **D-bridge-6（测试）**: 单元测试 hand-mounted 注入 bridge 锁 fail-open 分支；集成测试
  以真 cordis 栈 + `ctx.provide("connection", ...)` 假服务锁装配边（`ctx.get` →
  bridge → 302），断言相对 Location 与 Set-Cookie 仍签发（grok F5）。装配边必须由集成
  测试覆盖：本次 issue #99 的缺陷形态就是「端点函数正确、装配漏传」，只手注 deps 的
  单元测试会全绿（grok-4.7 评审 A8）。
- **D-bridge-7（token 模式对齐）**: M2 的共享口令登录与 password 登录共用同一座桥实例、
  同一失败语义（`bridge() ?? next`），本文档对 `impl-m2.md` 成功路径契约的覆写与对
  `impl-m3.md` P14 的覆写同性质。token 模式没有受限会话（`must_change_password` 是
  password 专有），成功路径不需要任何跳过桥的分支（issue #99）。
- **D-bridge-8（无 Referer）**: `referrer-policy: no-referrer` 加在三处 302 上：守卫把
  导航请求 302 到登录页的两条分支（`denyHttp`，字符串 `"deny"` 与 `{deny:{redirect}}`）
  与两种模式的成功 302。真正起作用的是守卫那两条：被拒的 URL 可能自带 `/?token=`，
  不加这条，浏览器跟随时会把带 token 的完整 URL 作为 Referer 送进登录页请求。成功 302
  上的是纵深防御（它抑制的是「登录页 URL → `/?token=`」那一跳的 Referer），不是这个头
  在保护 Location 里的 token：Location、请求目标、访问日志、浏览器历史都照旧看得见 token
  （见 D-bridge-5）。因此把「旧版 dsh 零行为变化」理解为「跳转目标不变」，响应头上会多一条。
- **D-bridge-9（否决：守卫保留 query）**: issue #99 建议把守卫导航拒绝的 `next` 从
  `pathname` 改成 `pathname + search`，让原 URL 上的 `?token=` 活过登录往返。**不采纳**，
  理由按重要性排序：① 它把进程级 launch token 写进**未认证**的登录页文档 URL 与它的
  Referer，且编码成 `token%3D`，刚好绕开 D-bridge-5 建议的 `token=` 日志脱敏；② 桥命中时
  `next` 必然被 D-bridge-2 丢弃，主路径收益为零；③ 客户端带来的 token 一旦落在 `/` 以外
  的路径上，`authorizeIndex` 即使 cookie 合法也回 401。
  一处需要说清的边界：如果桥**不可用**（`authenticatedUrl` 抛错或返回空 token，而页面门
  仍在），本 PR 不会自救，用户看到的仍是 issue #99 的症状，恢复手段仍是再打开一次终端里
  那条启动 URL。桥失败属于契约内的 fail-open，不是本 PR 声称修好的场景。
  另外，保留 query 在「新鲜的启动 URL」上确实能铸出 cookie（pathname 就是 `/`、token 也
  是本进程的），所以它不是功能上零收益的错方案；不采纳是在「把 token 反射进未认证页面」
  与「多一条自救路径」之间选了前者。若将来要做 query 保真，应另开变更，并在拼 `next`
  之前剥掉凭证类参数。

## 4. 部署注意（与反代拓扑的关系）

- **普通反代（透传 Host）**：mint 请求 Host = 公网域名 → cookie 绑定域名 authority，
  后续请求同 Host 校验通过。✅
- **半外壳（重写 Host 为 127.0.0.1:3080）**：相对跳转后 mint 请求 Host = loopback →
  cookie 名按 loopback authority 计算；半外壳同时把后续所有请求的 Host 重写为
  loopback，校验一致，可正常工作。✅（**前提**：跳转必须是相对路径 —— 旧实现
  `http://${host}` 绝对跳转在半外壳下会把浏览器送去 `http://127.0.0.1:3080`，用户
  本机或失败。见 `docs/deployed/reverse-proxy*.md` 附注。）
- 多入口（LAN IP + 域名）：cookie 名绑定各自 authority，互不复用（dsh 单门模型：
  过任一入口 = 全实例权限，两张等价全权票，非提权）。
- **多副本（Kubernetes 等）**：桥读取的是**处理这次登录的那个进程**的 connection。
  没有粘滞会话时，紧随其后的 `GET /?token=` 若打到别的副本，`authorizeIndex` 会 401。
  password 模式自首版起就是这个假设，token 模式继承同一约束；部署需要单进程或粘滞路由。

## 5. 测试

- `src/features/password/password-endpoints.login-bridge.test.ts`（4 用例）：
  命中（相对 URL + Set-Cookie 仍含 `dsh_auth`）/ undefined 回退 / 抛错回退 /
  TOTP 第二段命中（含挑战 cookie 清理断言）。
- `src/shared/login-redirect.test.ts`（6 用例）：两条成功路径共用的回落规则 —— 未配置 /
  undefined（静默）/ 抛错 / 空串与 `//evil`、绝对 URL、反斜杠、控制符等非安全地址 /
  logger 缺失或抛错时仍然返回跳转目标。
- `src/features/token/auth-endpoints.login-bridge.test.ts`（7 用例）：命中（相对 URL +
  Set-Cookie + `referrer-policy`）/ undefined 回退 / 抛错回退并 warn / 非安全地址回退并
  warn / 未注入桥 / 401 不调用桥 / 503 不调用桥。
- `src/integration.password.test.ts`（1 用例）：真栈 + 假 connection →
  登录 302 相对 `/?token=launchTok123` + 会话 cookie。
- `src/integration.auth.test.ts`（新增 2 用例）：真栈 + 假 connection（在插件 apply 之后
  才注册，锁惰性查找）→ 令牌登录 302 相对 `/?token=launchTok-it`（不含表单里的共享 token）
  - 会话 cookie + 带 cookie 跟随第二跳 `GET /?token=` 不再被打回登录页；connection 服务
    在但没有 `authenticatedUrl` 时回落 `next`。

## 6. 变更记录

| commit    | 内容                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `19c8431` | 首版：`makeLaunchTokenBridge` + `issueSession` 透传 host（绝对 URL）                                                                                                                                                                      |
| `b7e48e5` | grok-4.6 review F1–F6 落地：相对跳转只取 token、两把闩、去 host 依赖、抽 `src/launch-token-bridge.ts`（root 层白名单）、集成测试锁装配边、本文档 + 反代文档附注                                                                           |
| `#103`    | issue #99：token 模式接上同一座桥（D-bridge-7）；成功 302 与守卫登录跳转补 `referrer-policy: no-referrer`（D-bridge-8）；回落规则抽成两条成功路径共用的 `resolvePostLoginLocation`；记录 D-bridge-9（否决守卫保留 query）与多副本粘滞假设 |
