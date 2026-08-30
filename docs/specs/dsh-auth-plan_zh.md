# dsh-auth 可行性规划（v3，威胁模型修订）

> 目标：让公网部署的 dsh web 具备应用层认证能力，不依赖上游修改即可落地。
> 状态：核心挂载点已用实时探针实测验证（探针 `authp-1` 已按用户要求 `cordis_undefine` 清理）。

---

## 0. 已确认的决策（2026-08-14，v3）

| #   | 决策                                                          | 影响                                                           |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | **不做多用户/会话隔离**（保护对象是整个实例，而非用户间隐私） | 阶段 3 删除；`subject` 仅作审计；方案显著简化                  |
| 2   | 会话必须跨重启持久化                                          | 用 storage domain（`dsh-storage-json` 已在组合中），见 §5      |
| 3   | 无上游 PR 通道                                                | 包装挂载点长期化 → 自检/回归纪律；特权方法仍钉 loopback，见 §7 |
| 4   | 探针清理                                                      | 已 `cordis_undefine`，无残留                                   |

**分阶段路线（最终版）：**

1. 阶段 1：随机 token 保护（共享口令）；
2. 阶段 2：真正登录，凭证维护在配置文件中（多条目 = 多个管理员各自的凭证，互相不隔离）；
3. 阶段 3：OTP（TOTP）加固。

---

## 1. 威胁模型：这个门到底保护什么

修正后的认知：**auth 门保护的不是"API Key"这一项，而是整个 dsh 实例的单一入口**。未授权者
一旦通过信任围栏（`--trusted-host`，它只是 DNS-rebinding 防栏，不是认证），可以触及：

| 资产         | 泄露途径                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| API Key 本身 | GUI 的 `credentials.describe` 被 loopback 钉死读不到；但 agent 的 bash 工具可直接 `cat ~/.dsh/.credentials.yaml`（除非文件沙箱拦截） |
| LLM 额度     | 更现实的主要损失：不必偷 Key，直接开 agent 会话白嫖 API 额度（成本滥用）                                                             |
| 全部会话历史 | 会话列表/内容 RPC 对所有过围栏的浏览器开放；agent shell 也可读 `sessions/*.jsonl`——可能含 agent 以往读入上下文的秘密                 |
| 服务器 RCE   | agent 平面 = 任意 shell 执行（standard 预设的 bash 工具），等于服务器 shell 外送                                                     |

**关于工作区的澄清**：workspace 是 GUI 的组织概念，**不是访问控制边界**。所有会话都在同一个
`DSH_HOME/sessions`，任何过了门的客户端都能看到并打开全部会话（包括他人的）。"客户端先加
本地工作区"并不能阻止会话互读。若未来需要客户端间隐私，那才是多用户隔离——已决定不做。

**推论**：单门模型（过了门 = 完整访问）与保护目标完全匹配，方案因此最简单；多用户隔离删除。

---

## 2. 结论

**可行，且已实测验证。** `webServer` 服务无中间件，但"请求时查表调 handler"的分发模型允许
Host 插件**无上游改动**地对全部 HTTP 请求与全部 WS 升级做守卫包装。实测证据（探针已清理，
结论留档）：

- fallback（SPA index）、`/api` 前缀（含动态插件 RPC 通道）、exact 路由、两个 WS 升级
  （`/api/events.mux`、`/api/events.host`）全部可拦截，放行零扰动；
- 包装"存量表 + 注册方法"双保险，不受组合行 apply 顺序影响。

实现形态：**静态 npm 包（`dsh-auth`）+ web profile 组合行**（生产）；动态插件仅原型（已排除：
无 `node:crypto`/`fetch`、重启即失效）。

---

## 3. 现状盘点（要点，详见附录代码位置）

- `webServer` 服务（`@deepseek-ai/dsh-host-webserver`）：`exact`/`prefixes`/`upgrades` 三表 +
  唯一 `fallback` 席位；分发 exact → 最长前缀 → fallback → 404；重复 `(kind, path)` 抛错；
  **无中间件概念**。
- `@deepseek-ai/dsh-client-connection`：前缀路由 `/api`（桥接 `apiProxy`）+ 两个 WS 升级；
  每请求先过 `isTrustedApiRequest` 信任围栏（防 DNS rebinding / 跨站）——**注释明确"不是认证"**。
- `PRIVILEGED_METHODS`（17 个方法：`settings.*`、`credentials.*`、`agentPreset.*` 等）用空信任
  列表钉死 loopback——注释原文："until a real authentication layer exists"。
- `@deepseek-ai/dsh-host-frontend-static` 独占 fallback 服务 SPA dist。
- 组合层：web profile 根为空，patch 栈 = bundle patches（dsh-base → dsh-web-app → dsh-deeptutor）
  → profile 层 → `$DSH_HOME/cordis.patch.yml` → `--patch` 覆盖层；行按 id 覆盖。
- 全依赖树无任何 auth 包/服务/事件；`/api` interceptor 只能接管命中端点且围栏在它之前 → 不能当门。

---

## 4. 挂载点：`webServer` 守卫包装

### 4.1 原理

在 Host 插件 `apply` 中：

1. **包装存量**：遍历 `server.exact`/`server.prefixes`/`server.upgrades`，逐项把 `handler` 替换为
   `guard(原始 handler)`；`server.fallback` 同样包装；
2. **包装增量**：覆盖实例方法 `register`/`registerUpgrade`/`registerFallback`，未来注册自动进守卫；
3. **守卫逻辑**拿 `(req, res)`（升级为 `(req, socket, head)`）：公共路径白名单 / 会话校验，
   放行或自行写 302/401，WS 无效则直接拒绝握手（不进入 `ws` 协商）；
4. **auth 自己的端点**（登录/回调/登出/状态）用包装前捕获的原始 `register` 注册，避免自拦；
5. **生命周期可逆**：`ctx.effect` 里还原原始方法与表快照（停用/卸载即撤守卫）。

### 4.2 骨架（概念代码，静态包内写法）

```js
export function apply(ctx, config) {
  const server = ctx.webServer; // inject: ['webServer', ...]
  const guard = (kind) => (handler) => async (req, res) => {
    const pathname = String(req.url ?? "/").split("?")[0];
    const decision = await ctx.auth.decide(req, { kind, pathname }); // auth 服务：白名单/会话/目标
    if (decision === "allow") return handler(req, res);
    if (decision === "redirect") {
      res.writeHead(302, { location: `/auth/login?next=${encodeURIComponent(pathname)}` });
      return res.end();
    }
    res.writeHead(401);
    return res.end("unauthorized");
  };
  const orig = {
    register: server.register.bind(server),
    registerUpgrade: server.registerUpgrade.bind(server),
    registerFallback: server.registerFallback.bind(server),
  };
  const snap = {
    exact: new Map(server.exact),
    prefixes: new Map(server.prefixes),
    upgrades: new Map(server.upgrades),
    fallback: server.fallback,
  };
  for (const [p, r] of server.exact)
    server.exact.set(p, { ...r, handler: guard("exact")(r.handler) });
  for (const [p, r] of server.prefixes)
    server.prefixes.set(p, { ...r, handler: guard("prefix")(r.handler) });
  for (const [p, r] of server.upgrades)
    server.upgrades.set(p, { ...r, handler: guardUpgrade(r.handler) });
  if (server.fallback) server.fallback = guard("fallback")(server.fallback);
  server.register = (r) => orig.register({ ...r, handler: guard(r.kind)(r.handler) });
  server.registerUpgrade = (r) => orig.registerUpgrade({ ...r, handler: guardUpgrade(r.handler) });
  server.registerFallback = (h) => orig.registerFallback(guard("fallback")(h));
  // auth 公共端点（orig.register）+ 自检 + 还原，见 §7/§8
}
```

### 4.3 风险与纪律（无上游通道下长期适用）

- 包装依赖 `WebServer` 内部字段与"请求时查表"行为，属非契约接口。**每次 dsh 升级必须回归**。
- 启动自检：探针式检查四类入口是否被包装（未包装 = 裸奔，启动时报错并写日志）。
- guard 代码集中在一个模块，未来上游若提供契约中间件，迁移面最小。

---

## 5. 架构设计：门恒定、登录流可插拔

关键设计：**守卫（gate）永远只做一件事**——查公共白名单、查会话 cookie、按目标写 302/401。
"如何产生会话"是**可插拔的登录流（flow）**，按阶段叠加，不改门：

```
请求 → guard → 白名单? ──是──→ 放行
              └─否→ 会话 cookie 有效? ──是──→ 放行（subject 挂到请求上下文，仅审计用）
                          └─否→ HTML 导航 → 302 /auth/login
                               API/WS    → 401 / 拒握手

登录流（按阶段启用）：
  阶段1 token flow   : POST /auth/login {token} → 校验共享 token → 发会话
  阶段2 password flow: POST /auth/login {username, password} → 查 users 文件(哈希) → 发会话
  阶段3 otp flow     : password 通过后 + TOTP 校验 → 发会话（两段式）
```

- 会话记录带 `subject`（阶段 1 固定 `"token"`，阶段 2 为用户名），**用途是审计**（日志里知道
  哪个凭证产生的会话），不是为隔离铺路。
- 登录页由 auth 自服务（自包含 HTML 字符串，无第三方资源）：SPA 在门后，登录页不能依赖 SPA。
- 浏览器侧所有后续请求自动带 cookie（fetch/WS 由上游客户端发出，我们不改客户端代码）。

---

## 6. 分阶段设计

### 阶段 1：随机 token 保护

- 部署时生成高熵 token（如 `openssl rand -hex 32`），写入 `.credentials.yaml`（条目名如
  `DSH_AUTH_TOKEN`），插件配置以 **credential 引用** 声明（`credentials` 服务只认环境变量名，
  值从 `.credentials.yaml`/env 解析——与 dsh 既有秘密机制一致，配置面永不落值）。
- 入口：`POST /auth/login`（自包含页面 + 表单）提交 token → 恒时比较 → 发会话 cookie；
  另支持 `Authorization: Bearer <token>`（curl/脚本友好）直接通过守卫。
- 会话：§5 的持久化 session + `HttpOnly; Secure; SameSite=Lax; Path=/`。

### 阶段 2：真正登录 + 配置文件凭证

- 凭证文件：`$DSH_HOME/auth/users.yaml`（自建——settings/credentials 两条缝分别是命名空间/
  单值模型，装不下用户表）。条目：`username → { passwordHash, totpSecret?, disabled? }`。
  多条目的语义：**多个管理员各自的登录凭证**，互相完全可见（不做隔离）。
- 口令哈希：**scrypt（`node:crypto` 内建，M3 实施选用——见 §9 路线图注）**；argon2id
  （`@node-rs/argon2` 带预编译二进制）与 bcryptjs（纯 JS）为备选。**文件里永不出现明文口令**。
- 配套管理 CLI：`dsh-auth user add/list/disable`（生成哈希、编辑 users.yaml）——避免手写哈希出错。
- 登录限速：按 IP + 账号计数，失败指数退避；恒时比较。

### 阶段 3：OTP（TOTP）

- RFC 6238 TOTP：`node:crypto` HMAC 即可，静态包内无额外依赖。
- users.yaml 增加 `totpSecret`；登录两段式：password 通过 → TOTP 挑战页 → 发会话。
- 配置项：OTP 全局开关、按用户可选、尝试限速（TOTP 窗口 ±1，防重放记录最近验证码）。

### （已删除）多用户会话隔离

不做。理由：威胁模型是"保护整个实例的单一入口"，门内所有人互信；会话互读在单门模型下
不是问题。若未来真的需要客户端间隐私，需上游配合做会话归属过滤——届时单独立项。

---

## 7. 无上游 PR 通道的限制

| 限制                                     | 影响                                                         | 对策                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 包装是**非契约接口**                     | dsh 升级可能改字段名/分发行为 → 静默失效即裸奔               | 启动自检（§4.3）+ 升级回归清单 + 盯 dsh 版本变更                                                            |
| `PRIVILEGED_METHODS` **仍钉死 loopback** | 认证用户也无法从 GUI 改 settings/credentials（配置只能 SSH） | 接受（单门模型下影响小，反而把"门内人改配置"这条路堵住了）；可选 hacky 开关（守卫改写 Host 头解锁）默认关闭 |
| 无 auth 事件/中间件                      | 需自建 `auth` 服务名 + 包装                                  | 无影响（宿主平面一行，单实例）                                                                              |
| 登录页无法用 SPA 渲染                    | 预认证阶段 SPA 不可达                                        | 自包含 HTML 登录页（计划内）；认证后的会话状态/登出按钮可加 client 半边（browser 插件）做进 GUI             |
| 信任围栏不认 auth                        | `--trusted-host` 仍需配置，两者正交叠加                      | 部署文档注明                                                                                                |

---

## 8. 纵深防御与安全要点

**与门正交、专门服务"保护 API Key"目标的措施：**

- [ ] 服务器用**独立低权限 OS 用户**跑 dsh（无 sudo、无其他项目文件）——agent 平面若被攻破，
      损失被限定在该用户；API Key 泄露影响面也最小
- [ ] `.credentials.yaml` `chmod 600`；users.yaml 同样 600
- [ ] 服务器部署的沙箱策略收紧（agent 工具限制在 workspace、不读 `DSH_HOME`）——注意会削弱
      agent 能力，按需权衡；至少默认不读 `.credentials.yaml`
- [ ] 会话日志视同**含密材料**（agent 可能把秘密读进过上下文）：备份/共享时同等防护

**门本身的要点：**

- [ ] 会话 token 只存 SHA-256 摘要；256-bit `crypto.randomBytes` 生成
- [ ] Cookie：`HttpOnly; Secure; SameSite=Lax; Path=/`（Secure 依赖前置 TLS 终结）
- [ ] 登录成功即换 token（防会话固定）；登出吊销并写盘
- [ ] 登录限速（IP+账号，指数退避）；TOTP 防重放
- [ ] 口令 scrypt（node:crypto 内建，M3 已实施），文件零明文
- [ ] 恒时比较；日志不落 token/口令
- [ ] fail-closed 纪律：auth 行禁用即裸奔 → 部署验收清单含"auth 行健康"检查
- [ ] 自包含登录页（无 CDN/第三方资源）
- [ ] dsh 升级回归：四类入口包装自检 + 登录流程冒烟

---

## 9. 路线图

| 阶段 | 内容                                                                                | 交付物                                 |
| ---- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| M0   | 探针验证挂载点                                                                      | ✅ 完成（探针已清理）                  |
| M1   | `dsh-auth` 包骨架 + 守卫 + 启动自检 + 持久化会话（storage domain）                  | ✅ 完成：npm 包 host 半边 + profile 行 |
| M2   | 阶段 1：随机 token 门（credentials 引用 + Bearer + 登录页发 cookie）                | ✅ 完成：可部署的公网最小防护          |
| M3   | 阶段 2：users.yaml + 口令哈希（**scrypt**，见下注）+ 登录限速 + `dsh-auth user` CLI | ✅ 完成：真正登录                      |
| M4   | 阶段 3：TOTP 两段式登录 + 配置项                                                    | OTP 加固                               |
| M5   | 独立反代外壳模式（proxy shell）：自身监听公网 + 反代裸 dsh + Host/Origin 重写       | 规划中（2026-08-15 记录，待排期）      |

> M3 注：口令哈希按用户拍板选用 `node:crypto` **scrypt**（N=2¹⁶/r=8/p=1，零新增原生依赖；
> 规格 `docs/implemented/impl-m3_zh.md` P1/P2），替代本节初稿中的 argon2id/bcryptjs 候选。

### M5（规划）：独立反代外壳模式（standalone proxy shell）

> 2026-08-15 由生产部署实证驱动立项；排期前先读 `docs/deployed/deployment_zh.md` §8（半外壳生产拓扑与
> 栅栏事实表）。

**背景（实证结论）**：dsh 0.1.0-rc.6 的浏览器信任栅栏把 `settings.*` / `credentials.*` /
`llm.discoverModels` 等 privileged 方法钉死为仅 loopback（`dsh-client-connection`
`PRIVILEGED_METHODS`，`--trusted-host` 放不开）。公网反代下这些端点恒 403。实测矩阵：

| 上游 Host                   | Origin        | privileged API |
| --------------------------- | ------------- | -------------- |
| `dsh.hi-ruofei.com`（现状） | 任意          | 403            |
| `127.0.0.1:3080`（重写）    | 匹配 loopback | 200            |
| `127.0.0.1:3080`（重写）    | 剥离          | 200            |
| `127.0.0.1:3080`（重写）    | 不匹配        | 403            |

结论：**"让 dsh 以为自己在 loopback"与认证必须由同一层外壳承担**——只加认证壳而不重写
Host/Origin 无效（栅栏与认证正交）。

**目标**：dsh-auth-gate 增加独立部署形态——以 bare cordis 上下文启动（独立挂载范式见仓库根
`.serve-login.tmp.mjs`），自身监听公网端口，内置反代到"裸 dsh"（零插件），自动重写
Host/Origin 头；登录页/会话/限速/Bearer/登出沿用现有 gate 逻辑并覆盖代理入口。

**收益**：

- dsh 实例零插件零耦合；升级 dsh 无守卫兼容性风险（现插件形态每次升级须跑 deployment.md §5 回归）；
- 设置页/凭证管理公网下完整可用（privileged 403 消失，无需 SSH 隧道）；
- 外壳独立版本化、独立发布，与插件形态共享 gate/session 代码（需抽象公共层）。

**技术要点**：

- 代理层：cordis `webServer` 注册 catch-all 反代路由（转发 + header 重写）+ upgrade 通道透传（WS 101）；
- header 规则（已实测）：`Host: 127.0.0.1:<上游端口>` + 剥离 `Origin`（或重写为 loopback
  origin）；`Sec-Fetch-Site: cross-site` 仍被栅栏拒（保留，纵深防御）；跨站 cookie 由门卫
  `SameSite=Lax` 兜底；
- 会话 cookie `Secure` 依赖外壳 TLS 终结（沿用 deployment.md 前置条件）；
- 形态入口建议：`dsh-auth proxy --upstream 127.0.0.1:3080 --port 8443`（password/token 模式配置不变）。

**验收标准**（沿用 deployment.md §4 精神）：

- 未认证：HTML 302 登录页 / API 401；登录后 `settings.describe`/`credentials.describe`/
  `settings.update` 200；WS 带 cookie 101、无 cookie 401；
- 公网浏览器全流程：登录 → 设置页零 transport failure → 聊天流式正常；
- 裸 dsh 侧无插件、不需要 `--trusted-host`（Host 恒 loopback）。

**依赖/风险**：

- 反代需处理 streaming/SSE/WS/大 body（dsh 请求体上限 167772160 字节）；
- 代理层是新攻击面：header 重写正确性优先；上游固定（127.0.0.1），SSRF 面小；
- 与插件形态并存期维护双入口，spec 需先抽象公共 gate/session 层（建议 M5 首步）。

---

## 10. 附录：关键代码位置

| 事实                                    | 位置                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webServer`：路由表/注册/分发/升级监听  | `node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js`（register L53、registerUpgrade L67、registerFallback L82、match L194、upgrade 监听 L132） |
| `/api` 前缀路由 + 信任围栏 + WS 注册    | `node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`（isTrustedApiRequest L184、/api 路由 L550-561、WS L566-585）                           |
| PRIVILEGED_METHODS（loopback 钉死清单） | 同上 L504-520（意图注释 L485-503）                                                                                                                    |
| SPA fallback 席位                       | `node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js` L69-83                                                                              |
| web 宿主组合（webserver/connection 行） | `node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml`（webserver L115-120、connection L156-163）                                                   |
| storage domain 用法范式                 | `node_modules/@deepseek-ai/dsh-message-feedback/lib/types/spec.js` + `lib/index.js` L258-267                                                          |
| credentials 引用模型（环境变量名）      | `node_modules/@deepseek-ai/dsh-credentials/lib/types/index.js`                                                                                        |
| profile patch 层栈与 bundle 机制        | `dsh/lib/profile-boot-*.js`（composeProfile）                                                                                                         |
| 本机 web profile bundles                | `C:\Users\Randal_Wang\.dsh\profiles\web\package.json`                                                                                                 |
