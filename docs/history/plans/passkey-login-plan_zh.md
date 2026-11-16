# 通行密钥（passkey / WebAuthn）登录：可行性与实施方案

> 状态：**proposed，未开工**（2026-11-11）。评审通过后转 `docs/specs/passkey-webauthn.md` 执行规格。
> 目标里程碑：**M6**（路线图见 `docs/specs/dsh-auth-plan_zh.md` §9）；发布按 release-please 走 `feat:` → v0.19.0。
> 适用面：`mode: "password"`。token 模式不受影响（token 模式配 `passkey` 非 off 只记 error 日志并按 off 处理）。
> 关联决策：D35（`docs/decisions/proposed/2026-11-11-passkey-login_zh.md`）。
> 调研底稿：`data/tmp/passkey-research/`（本机目录，不入库）。

## 1. 结论

**可做，建议做；服务端校验引成熟库，浏览器侧手写 glue。**

- 浏览器侧 `navigator.credentials` 是标准 API，登录页本来就是「服务端渲染 HTML + 渐进增强内联 JS」，
  加密端点可以直接挂在既有 `/auth` 路由表上，会话、限速、反枚举、失败页全部复用现有件。
- 服务端校验交给 `@simplewebauthn/server@14.1.0`（MIT，Node ≥22；10 个直接依赖 / 21 个传递包、解包约
  870 KiB，只进 Host 侧）：CBOR/COSE/签名/attestation 这些**安全边界不再手写**，我们只保留策略层
  （ceremony 存储、凭证事务、限速、审计、UI）。浏览器侧手写约 60–80 行 `get`/`create` + base64url，
  登录页仍零第三方资源。
- 前置条件都在既有部署前提里：HTTPS 反代终结（`cookieSecure: true` 本就需要）、`publicHost` 可配。
  新增的硬约束只有一条：**RP ID 必须是域名，且必须与 `publicHost` 一致**。IP 直连、`http://` 内网地址、
  `dsh-auth-proxy` 的 `http://127.0.0.1:8443` 都用不了 passkey，必须写进 known-limitations。
- 明确不做：passkey-only（无口令登录）、attestation 策略、related origin requests、Playwright/CDP e2e。
  「无 JS 仍可用密码登录」保持为不变量。

## 2. 现状与缺口

登录流本来就是可插拔的（`docs/specs/dsh-auth-plan_zh.md` §5）：M2 token 门、M3 口令、M4 TOTP 两段式，
会话统一走 `SessionStore` + `issueLoginSession`（`src/host/features/password/model/session-issue.ts:75-89`），
`/auth` 前缀由门整体放行、端点自己负责认证与 CSRF（`src/host/features/password/model/password-gate.ts:47-72`、
`src/host/shared/http/origin.ts:50-74`）。

缺的是：**一种不依赖口令的登录方式**。TOTP 只解决「口令之外再要一个码」，不解决钓鱼（实时转发 OTP 仍然有效），
也不减少口令带来的撞库、复用、离线破解面。passkey 把口令从登录路径上整体拿掉，且凭据绑定 origin
（phishing-resistant），正好补这块。

可复用的资产：登录页 SSR 与失败卡片、`parseFormBody`/`formField` 表单通道、`LoginRateLimiter`（双桶）、
`checkRequestOrigin`、`session-issue`、client 半边「账号安全」设置段、CLI 骨架、集成测试 harness。
不可复用/需新建：没有 JSON 请求体解析（本方案统一用 urlencoded，不必新增）、没有浏览器测试层
（验收靠单测 + 真栈集成 + 手工录制）。

## 3. 范围

**v1 做**

| 能力          | 说明                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录          | 登录页新增「Sign in with a passkey」按钮；无用户名（discoverable credentials），一次触摸/生物识别即完成登录                                    |
| 注册          | 已登录（完整会话）+ **再认证**（当前口令；启用 TOTP 时再要验证码）后，在设置 →「账号安全」→「通行密钥」里添加；`excludeCredentials` 防重复注册 |
| 自助管理      | 列出/删除自己的凭据（label、创建时间、最近使用、是否可同步）                                                                                   |
| CLI           | `dsh-auth passkey list <user>`、`dsh-auth passkey rm <user> --id <id 或前缀> [--all]`                                                          |
| 配置          | `passkey: "off"/"optional"`（默认 off）、RP 显示名、RP ID 覆盖、额外 origin、计数器策略                                                        |
| 条件 UI       | 登录页把 passkey 放进浏览器自动填充（autofill），默认关；管理员可在「账号安全」设置页打开，立即生效                                            |
| 审计/失败路径 | 注册/登录成功、计数器回退写入 `ctx.logger`；失败统一 401 同形响应；登录页失败仍是同一张卡片                                                    |

**v1 明确不做**（写进文档与决策记录，避免评审时反复讨论）

- `passkey: "required"`（passkey-only 或强制全员注册）：锁定风险（丢全部设备 + 口令被禁用）未解决前不提供；
  `totp: "required"` 不再构成理由（passkey 登录本就不受其约束，见 §5.8）；需要「只有通行密钥」的环境请配
  `passkey: "off"` + 口令/TOTP，或等 v2。
- attestation 校验 / MDS 证书白名单；`appid` 扩展；`largeBlob`/`prf`/`credProtect`。
- related origin requests（`/.well-known/webauthn`）与多注册域：v1 只支持 `passkeyOrigins` 里列出的精确 origin。
- 管理员代发的一次性注册链接、跨设备二维码引导页。
- Playwright/CDP Virtual Authenticator：仓库没有浏览器测试层，成本 1.5–2 人日只覆盖 ~50 行 glue，v1 用
  jsdom 单测 + 手工验收矩阵替代。
- 登录页多语言：登录页服务端渲染，按既有约定只用英文。

## 4. 威胁模型：passkey 改变了什么

| 攻击                            | 现状（口令 + 可选 TOTP）    | 加 passkey 之后                                               |
| ------------------------------- | --------------------------- | ------------------------------------------------------------- |
| 钓鱼站冒充登录页                | 口令可被钓；TOTP 可实时转发 | origin 绑定，浏览器拒绝在别的 origin 出示凭据；**不再可钓**   |
| 拖库后离线破解                  | scrypt 哈希可被离线攻击     | 服务器没有私钥，passkey 无可破解物                            |
| 撞库/口令喷洒                   | 靠口令策略 + 限速           | 不变（口令路径仍在，见下）                                    |
| 会话 cookie 被偷                | 有风险                      | **不变**，仍靠 TLS/Host/Origin/SameSite/短 TTL                |
| 终端被控（键盘记录/浏览器扩展） | 有风险                      | 部分变化：仍可偷会话，但拿不到私钥（同步 passkey 例外，见下） |
| 恢复通道被钓                    | 口令仍是入口                | **不变**：v1 保留口令登录，钓鱼者仍可钓口令                   |
| 管理员权限滥用                  | 有风险                      | 不变                                                          |

两条必须写进文档的边界：

1. **同步 passkey 不是设备绑定**：iCloud Keychain / Google Password Manager / 1Password 等把私钥同步到云端，
   `BE`（backup eligible）常为 1。平台侧云账户被攻破 + 本地解锁即可使用；因此不能宣称它等价于硬件密钥。
   GitHub 的 passkey 文档同样承认云同步 passkey，并仍把它算作满足 2FA——本方案采用同一模型。
2. **注册是唯一新增的持久化攻击面**：拿到会话 cookie 的攻击者若能给账号加一把自己的 passkey，就等于
   留下永久后门（改密也踢不掉）。所以注册必须再认证（§5.7），这是本方案的安全红线，不是可选项。

## 5. 设计

### 5.1 三条流程

```
登录（匿名）：
  GET /auth/login                     ← 页面渲染 passkey 按钮（passkey 开启且浏览器支持时由 JS 显示）
  POST /auth/passkey/options          ← 生成 challenge，服务端存 ceremony，Set-Cookie 不透明 id（120s）
  navigator.credentials.get(...)      ← 浏览器弹平台验证器/跨设备（UV required、allowCredentials: []）
  POST /auth/passkey/login            ← 普通表单 POST（隐藏字段）；校验通过 → issueLoginSession → 302 next

注册（已登录 + 再认证）：
  POST /auth/passkey/register/options ← 字段 label/password/code；校验口令(+TOTP) → options + challenge cookie
  navigator.credentials.create(...)   ← residentKey required、UV required、excludeCredentials=现有凭据
  POST /auth/passkey/register         ← 校验 attestationObject/authData/签名 → 写 users.yaml → 返回摘要

管理（已登录）：
  GET  /auth/passkey                  ← 自己的凭据列表（无哈希/无公钥细节）
  POST /auth/passkey/remove           ← 字段 id；删除；最后一枚 + 无口令的护栏（见 §5.9）
```

登录完成走**隐藏表单 POST 而不是 fetch**：302 语义、cookie 下发、失败卡片 HTML、无 CORS 细节，都与口令
登录完全同形；challenge 与 options 走 fetch（JSON 返回），只有这一步是 JS 必需。

### 5.2 配置项

沿用扁平 camelCase（与 `totp` 同构），总配置项从 12 增至 18：

```yaml
- id: dsh-auth-gate
  config:
    mode: "password"
    publicHost: "https://dsh.example.com" # 既有；passkey 的唯一锚点（不要读请求头 Host）
    passkey: "off" # "off"(默认) | "optional"
    passkeyRpName: "DeepSeek Harness" # 展示名，不参与校验
    passkeyRpId: "" # "" = 取 publicHost 的 hostname（无端口、无 scheme）
    passkeyOrigins: [] # [] = [origin(publicHost)]；多值用于域名/端口迁移
    passkeyEnforceCounter: false # true = 计数器回退且设备绑定凭证时拒绝；默认只 warn
    passkeyConditionalUi: false # 登录页 passkey 自动填充；默认关，管理员可在设置页打开
```

派生与自检（写死，不允许「尽力而为」）：

- `passkey` 非 off 而 `publicHost` 为空/非法 → **error 日志 + 按 off 处理**（`passkey 功能 fail-closed`，
  实例照常启动；不因功能配置错误拖垮登录门）。宁可「看起来开了实际没开」，也不能「看起来没开实际开了」。
- `rpId` 必须是 valid domain string（无 scheme/端口/路径，**非 IP 字面量**，`localhost` 特例）；
  每个 origin 必须 `https`，或 `http://localhost[:port]`；origin 的 hostname 必须等于 `rpId` 或是其子域。
- `origins` 比较用 **scheme + host + port 精确字符串**（W3C L3 §13.4.9），不做子域通配。
- 登录页与所有 `/auth` 响应附 `Permissions-Policy: publickey-credentials-get=(), publickey-credentials-create=()`，
  禁止被跨源 iframe 当作 WebAuthn 中继（v1 不支持嵌站，`crossOrigin: true` 一律拒绝）。
- 测试环境与生产 origin 不同则 passkey 凭据不通用（预期行为，部署文档写清）。

### 5.3 跨半边契约（`src/protocol/`，host/client 各自经唯一桥进入）

新增路径常量（`src/protocol/index.ts`，先改 `index.test.ts` 钉住值；`host:check` 要求每个常量恰好注册一次）：

| 常量                            | 路径                             | 方法      | 认证                |
| ------------------------------- | -------------------------------- | --------- | ------------------- |
| `PASSKEY_OPTIONS_PATH`          | `/auth/passkey/options`          | POST      | 匿名（登录 begin）  |
| `PASSKEY_LOGIN_PATH`            | `/auth/passkey/login`            | POST 表单 | 匿名（登录 finish） |
| `PASSKEY_REGISTER_OPTIONS_PATH` | `/auth/passkey/register/options` | POST 表单 | 会话 + 再认证       |
| `PASSKEY_REGISTER_PATH`         | `/auth/passkey/register`         | POST 表单 | 会话                |
| `PASSKEY_PATH`                  | `/auth/passkey`                  | GET       | 会话                |
| `PASSKEY_REMOVE_PATH`           | `/auth/passkey/remove`           | POST 表单 | 会话                |
| `PASSKEY_SETTINGS_PATH`         | `/auth/passkey/settings`         | GET/POST  | admin 会话          |

`payloads.ts` 新增纯类型（**只加法演进**）：options 响应直接采用库的
`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`（client 只透传给浏览器）；
断言/注册请求在端点内把 urlencoded 扁平字段（`id`、`client_data_json`、`authenticator_data`、`signature`、
`attestation_object`、`transports`、`next`）映射成库的 `RegistrationResponseJSON` / `AuthenticationResponseJSON`；
另有 `PasskeySummary`（id 前缀、label、createdAt、lastUsedAt、backupEligible、transports）、
`PasskeyListResponse`、`PasskeySettingsResponse`（`conditionalUiEnabled`，admin 读写）、
`PasskeyErrorBody`（`unauthorized | forbidden | locked | unavailable | bad_request`）。

状态码矩阵与既有端点一致：405（含 `allow` 头）→ 415（非 urlencoded）→ 413（体超限）→ 401（未认证/验证失败，
同形）→ 403（受限会话/完成注册）→ 429（`locked` + `retry-after`）→ 503（会话存储未就绪）。

### 5.4 存储模型（`users.yaml`，`version: 1` 不变）

```yaml
users:
  alice:
    passwordHash: "scrypt$..."
    passkeyUserHandle: "<base64url 32B 随机>" # 每用户一个，首次注册时生成
    passkeys:
      - credentialId: "<base64url credentialId>"
        publicKeyCose: "<base64url 原始 COSE 字节>" # 不转 JWK 存，保留原始形状
        alg: -7
        signCount: 3
        aaguid: "<uuid>"
        be: false
        bs: false
        uvInitialized: true
        transports: ["internal", "hybrid"]
        label: "MacBook Touch ID"
        createdAt: 1762760400000
        lastUsedAt: 1762764000000
```

约束与规则：

- 内嵌 `users.yaml`（不新建 `passkeys.yaml`）：复用既有 `mutateUsersFile` 的锁 + CAS + `.strict()` schema +
  0600 权限（`src/host/entities/user/model/users-file.ts`）；用户被禁用/删除时凭证天然跟着失效。
- 加字段要同步 5 处：`UserRecord`、`userRecordSchema`（`.strict()` 下新键必须显式声明）、loader 默认值、
  writer 序列化（`false`/空数组不落盘，保持旧文件逐字不变）、`src/host/entities/user/index.ts` 导出。
- 上限：每用户 ≤ 10 把；`label` ≤ 64 字符且拒绝控制字符（渲染时仍转义）；`credentialId` ≤ 1023 字节、
  **全局唯一**（同一凭据不能绑两个用户）。
- **TOCTOU**：全局唯一、每用户上限、首次生成 `passkeyUserHandle` 三项必须在**同一次** `mutateUsersFile`
  mutator（锁 + CAS 内）复核后再写盘；不能在锁外预检后直接写，否则并发注册可绕过上限或产生覆盖。
- `signCount` **默认只存进程内**（Map），不随每次登录写盘；`lastUsedAt` 节流落盘（最多每小时一次，供展示）。
  理由：每次登录写 `users.yaml` 会带来写放大、与并发改密抢 CAS，且「写失败只记日志」意味着落盘值本就不可靠。
  代价：跨重启的克隆检测能力有限，`passkeyEnforceCounter` 只是**尽力检测**，文档不得宣称可靠的克隆防护。
- `userHandle` 必须 `randomBytes(32)`，**不得**用 username/邮箱/自增 id（会同步进云端，规范要求无 PII）。
- `/auth/status` 只加一个 `passkeyEnabled: boolean`（配置透传，恒在），不暴露「该用户是否已注册」；
  客户端要列表就调已认证的 `GET /auth/passkey`。

### 5.5 一次性状态：ceremony 存储（不抄 TOTP 挑战 cookie，理由如下）

WebAuthn 的 challenge 是**必须被服务端重新读出的秘密**，且必须一次性；这与 TOTP 阶段「只记 stage 已过」的
无状态 cookie 不同。方案：

- `Map<ceremonyId, Ceremony>`，进程级单例（与 `LoginRateLimiter` / `TotpReplayGuard` 同寿命）；
  `Ceremony = { kind: "login" | "register"; challenge: Uint8Array; userId?: string; userHandle?: string; label?: string; expiresAt: number }`。
- cookie `dsh_auth_pk` 只放 `randomBytes(32)` 的 base64url id，属性
  `Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=120`（`Secure` 跟随 `cookieSecure`）。TTL 120 秒，条目上限 1024（超限先清过期再丢最旧），**finish 先删后验**（并发重放只有一次能过）。
- **容量上限不防驱逐攻击**：`/auth/passkey/options` 必须按客户端 IP + 全局限速（复用 `LoginRateLimiter`
  的独立实例），注册 options 另按用户限速；否则匿名方可反复建条目把他人仪式挤掉。
- 重启/插件重载后在途仪式全部失效 → 用户重试一次；与 TOTP 挑战 cookie 的重启语义一致。
  **单进程假设**：Map 只对单实例成立；多副本/多进程部署需要黏性会话或共享存储，v1 明确不支持（写进部署限制）。
- **考虑过的替代方案**（写进决策记录）：D10 的签名无状态 cookie 也能携带 challenge，但重放要靠
  「已用 challenge 集合」，并发下「先查后记」的竞态比「先删后验」更难写；且注册要把 label/用户绑定也签进
  cookie，体积与校验面都变大。故此处选进程内 Map，并明确它不是「第二套会话状态」。

### 5.6 服务端校验（用 `@simplewebauthn/server`）

服务端校验交给 `@simplewebauthn/server@14.1.0`：`generateRegistrationOptions` /
`generateAuthenticationOptions` 生成 options，`verifyRegistrationResponse` / `verifyAuthenticationResponse`
完成 CBOR/COSE/签名/attestation 解析与校验。**我们自己仍然负责**：

1. 一次性 ceremony：challenge 由库生成，但存储、cookie 绑定（不透明 id + HttpOnly）、TTL、**先删后验**都是我们的。
2. 期望值传入：`expectedChallenge`（ceremony 里的值）、`expectedOrigin`（`passkeyOrigins`）、
   `expectedRPID`（`passkeyRpId`）、`requireUserVerification: true`；注册时 `supportedAlgorithmIDs:
[-7, -257, -8]`、`attestationType: "none"`、`userID` = `passkeyUserHandle`、`excludeCredentials` = 现有 id。
3. 注册后策略：`BE=0 且 BS=1` 拒绝；`credentialId` 全局唯一、每用户 ≤ 10、首次 userHandle 生成，全部在
   **同一次** `mutateUsersFile` 事务内复核；记录 `BE` 供登录一致性校验。
4. 登录后策略：`response.userHandle` 必须存在且等于记录的 `passkeyUserHandle`；`BE` 必须与注册值一致
   （不一致拒绝，§7.2）；签名/COSE 由库验证，我们不再手写 `crypto.verify`；计数器按库返回的 `newCounter`
   更新进程内值（回退默认只 warn，见 §5.8）。
5. 失败与防护：统一 401、等量工作（未知 credential 用固定 dummy 走一次 verify 或等长比较）、
   `cache-control: no-store`、解析/验签成本上限；库的异常 message 只进服务端日志，不回客户端。
6. 请求体仍是 urlencoded 扁平字段，在端点内映射成库的 JSON 形状；上限：各字段 ≤ 8/64 KiB、总 ≤ 16 KiB。

**为什么不再自写**：CBOR/COSE/签名边界正是最容易写错的部分（调研稿自己就把 COSE `crv` 标签写错过），
而这一层恰好由库覆盖；我们保留的是「业务策略」层（存储、绑定、限速、审计），测试照样完整覆盖。
依赖代价显式接受：21 个传递包、解包约 870 KiB，只进 Host 侧、不进浏览器 bundle。

### 5.7 页面与交互

- 登录页：SSR 渲染按钮占位（`hidden`），内联 JS 特性检测（`window.PublicKeyCredential` 存在）后显示；
  点击 → fetch options → `navigator.credentials.get` → 填充隐藏表单（`id/client_data_json/.../next`）→ submit。
  失败回服务端同一张卡片，新增唯一常量文案（不含任何请求文本）；`AbortError`（用户取消）只恢复按钮。
  内联 JS 约 60–80 行，CSS +0.4 KiB（预算 6 KiB 内）。
- 条件 UI：开关打开时，登录页在加载后调用 `navigator.credentials.get({ mediation: "conditional" })`，让
  passkey 直接出现在密码框的自动填充里（Chrome 108 / Firefox 119 / Safari 16+）；按钮路径保留，不支持或
  `AbortError` 时静默回退，密码表单不受影响。
- 设置页开关：管理员在「账号安全」里看到「登录页启用 passkey 自动填充」开关，经 `POST /auth/passkey/settings`
  写回宿主 settings 服务并即时更新运行期标志；默认关，当前状态回显在设置页（非管理员只读）。
- 设置面板：`src/client/features/passkey/**` 新 slice（api/model/ui），挂在 account-section 已登录分支；
  列表 + 「添加通行密钥」表单（label + 当前口令 + TOTP 码）→ create → finish → 刷新；删除按钮。
  文案进 `src/client/shared/i18n/account-copy.ts` 的 zh/en 两份词典。
- 注册再认证：`register/options` 校验当前口令（复用 `verifyPassword`，错口令统一 401；限速用独立桶）；
  `totp !== "off"` 且该用户有 secret 时必须同时给码（复用 `verifyTotpCode` + `replayCheck` 单例）。
  **会话本身不足以注册**：这是「会话被劫 → 加后门 passkey」的唯一堵点。
- CLI 文案沿用现有英文风格；`dsh-auth passkey rm` 用 credentialId 前缀匹配（≥ 8 字符），`--all` 全删。

### 5.8 与 TOTP、受限会话、禁用用户的关系

- **TOTP**：**采用 GitHub 的 passkey 模型**——[GitHub Docs: About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
  写明「passkey 同时满足口令与 2FA 要求，单步完成登录」，即使账号启用了 TOTP，用 passkey 登录也不再要验证码。
  因此 `passkey` 登录恒为**完整认证**，`totp` 的语义明确为「**口令登录**的两步验证」：`totp: "required"`
  只约束口令路径，不拦截 passkey。启动时若 `totp: "required"` 且 passkey 开启，只记一条 info（不是 warn，
  不做降级）：passkey 满足 2FA。需要「独立第二因子、不接受同步 passkey」的环境设 `passkey: "off"`，
  这是唯一 escape hatch。
  残留风险如实写进文档：同步 passkey（BE=1）会复制到云端，不等价于硬件密钥；但 GitHub 先例、抗钓收益大于该
  风险，且 TOTP 本身可被实时转发。替代方案（passkey 后继续要 TOTP 两段式）留 v2，前提是把 TOTP 第二段从
  password slice 下沉为共享步骤。
- **受限会话**：登录成功一律 `issueLoginSession`（`must_change_password` → 15 分钟受限会话，只进改密页）。
  注册/管理端点要求 `kind === "full"`，受限会话 403（与 admin 端点同形）。
- **禁用/删除用户**：passkey 登录时按 users.yaml 现状判定，禁用者 401 同形；删除用户 = 凭证随之消失。
- **管理员重置他人口令**：不动 passkey（与现状不动 TOTP secret 一致）；会话撤销不吊销凭证。
- **`passkeyEnforceCounter`**：默认 false（只 warn）；true 时只对设备绑定凭证（`be=false && bs=false`）拒绝；
  计数只存进程内、跨重启失效，因此它是尽力检测，不是克隆防护承诺。

### 5.9 恢复、审计与运维

- 丢设备：其余凭据可用；全丢 → 口令登录 → 设置里删旧加新；口令也忘 → 管理员 `dsh-auth user passwd`。
  v1 没有恢复码（不做），文档写清「口令是最后恢复通道」。
- CLI：`passkey list`（label/创建/最近使用/BE）、`passkey rm --all`。删除最后一把时若用户口令哈希不可用
  （`passkey: "required"` 才有意义，v1 不做 required）；口令路径始终存在，因此这里只做「删前给出警告」。
- 审计：注册/删除/登录成功/计数器回退 → `logger.info`（含用户名、credentialId 前 8 字符、不写全值/不写
  clientData）；失败原因只进服务端日志，响应不区分。
- 运维：部署文档补「RP ID / publicHost / HTTPS / 反代端口」检查清单与症状表（「永远登录不上」的三种典型
  原因）；known-limitations 补：IP/HTTP 直连不可用、本地代理模式不可用、iOS 第三方浏览器可能不可用（特性检测降级）、
  attestation 不校验、无 passkey-only、条件 UI 默认关（管理员可在设置页打开）。
- 版本走廊：新功能不动 `engines.dsh` 与 storage-domain peer；`lib/` 同 commit 重建；protocol 路由
  只加在 `src/protocol/`。

## 6. 实现方式：服务端校验用成熟库

| 方案                                                 | 取舍                                                                                                                        | 结论                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| A. `@simplewebauthn/server@14.1.0` + 手写浏览器 glue | MIT、双 ESM/CJS、Node ≥22；10 个直接依赖 / 21 个传递包、解包约 870 KiB（只进 Host 侧）；CBOR/COSE/签名/attestation 由库处理 | **采用**                 |
| B. 自写校验器（`node:crypto` + 最小 CBOR/COSE）      | 零运行时依赖，但 250–400 行安全边界代码 + 300–400 行测试；COSE 标签这类细节容易写错（调研稿已犯过一次）                     | 不选                     |
| C. 只引 `@levischuck/tiny-cbor`                      | 0 依赖、解包 140 KiB；只解决 CBOR，COSE/验签仍自写                                                                          | 备选（依赖评审不通过时） |
| D. `fido2-lib`                                       | 12 包，`cbor-extract` 原生模块（安装期编译）                                                                                | 不选                     |

取舍说明：评审提醒「库大不等于不安全」——对，选 A 的理由是**它覆盖的正是最容易写错的安全边界**，
而我们自己的工作量集中在它不覆盖的策略层（ceremony、凭证事务、限速、审计、UI）。代价显式接受：
插件安装多 21 个传递包、约 1 MB（不进浏览器 bundle）；版本**精确锁定** `14.1.0`，`lock:check` 只允许
公共 registry，升级走单独 PR + 回归测试。浏览器侧不引 `@simplewebauthn/browser`：登录页零第三方资源的既有
约束下，`get`/`create` + base64url 手写约 60–80 行（非安全边界，服务器校验）。

## 7. 分期、工作量与验收

| 切片                            | 内容                                                                                                                                                                                                               | 估时    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| PR1 契约 + 存储 + ceremony      | protocol 常量/类型与钉值测试；users.yaml 字段（schema/loader/writer）与单测；ceremony 存储 + cookie；配置 + 启动自检；CLI list/rm；`/auth/status` 加 `passkeyEnabled`                                              | ~2 人日 |
| PR2 登录 + 条件 UI              | 引库并精确锁版；options/login 端点（generate/verify）；登录页按钮 + 条件 UI 内联 JS；失败卡片常量；限速/反枚举；真栈集成测试 + 手工验收                                                                            | ~2 人日 |
| PR3 注册 + 管理 + 设置页 + 文档 | register options/finish + 再认证；client feature + account-section；条件 UI 设置页开关（admin、settings 持久化、默认关）；i18n；审计；README/known-limitations/config skill；ADR 转 implemented；`lib/` 重建；demo | ~2 人日 |

合计 **约 6–7 人日**（含引库集成、设置页开关与安全测试；不含评审往返与真机矩阵时间）。三个 PR 依次依赖，
可独立 review；每个 PR 各自过相关门禁（`host:check`/README 路由/双语文档/`lib/` 重建），不能全堆到 PR3。

**DoD**

1. `npm run verify` 14 步全绿（含 80% 覆盖率红线、`host:check` 路由/README 检查、`decisions:check`、`docs:check`、`readme:parity`）。
2. 单测：引库调用参数（expectedChallenge/origin/RP ID/UV/算法白名单）；ceremony 签发/过期/重放/并发；
   凭证事务（唯一性/上限/userHandle/并发注册）；限速；反枚举同形响应。
3. 集成（真 cordis + WebServer 栈）：begin → 自造 authenticator 签名 → finish，断言 302 + `set-cookie` + 会话可用；
   失败路径 401 且无 cookie；禁用用户/受限会话用例。
4. 集成 fixture：W3C §16.2（ES256/`fmt:none`）、§16.4（`crossOrigin` 拒绝）、§16.6（1023 B credId）与自造
   authenticator 的注册/登录输入，验证「库调用契约 + 我们的拒绝路径」；库异常不得泄漏到响应。
5. 手工验收矩阵：Chrome/Edge（Windows Hello）、Safari（macOS Touch ID）、Safari iOS、Firefox、Android Chrome；
   跨设备扫码登录；取消/超时/无 passkey 的失败文案；无 JS 时密码登录不受影响。
6. 文档：README 两版配置表/CLI/首跑；known-limitations；部署检查清单；config skill；ADR 落地转 implemented。

## 8. 风险与缓解

| 风险                                  | 影响                            | 缓解                                                                                                                                        |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **注册无再认证 → 后门 passkey**       | 会话被劫后攻击者获得永久访问    | 注册必须当前口令（+TOTP）；`Sec-Fetch-Site`/Origin 校验；独立限速；审计                                                                     |
| **RP ID/origin 与既有半外壳反代错位** | 全员 passkey 登录失败且报错难懂 | 只从 `publicHost` 派生（绝不读 `Host`）；启动自检 + error 日志降级为 off；失败卡片给「检查 publicHost/RP ID」的可操作提示；密码路径保持不变 |
| 引库的供应链/升级面                   | 21 个传递包的漏洞与破坏性升级   | 精确锁 `14.1.0`；`lock:check` 只认公共 registry；升级单独 PR + 全套回归；回退备选 `@levischuck/tiny-cbor`                                   |
| `signCount=0` 误判同步 passkey        | 把正常用户锁在门外              | 只在双方非 0 时比较；默认 warn 不拒；`passkeyEnforceCounter` 只对设备绑定凭证                                                               |
| 会话被劫（不变）                      | 仍可冒充                        | v1 不解决（属 TLS/宿主威胁模型）；文档明确 passkey 不改变这一项                                                                             |
| 浏览器/企业策略禁用 WebAuthn          | 按钮不可用                      | 特性检测后隐藏按钮；密码始终可用；iOS 第三方浏览器写进限制                                                                                  |
| 文档/README 漂移                      | 门禁变红或误配                  | `host:check` + `readme:parity` 强制两版同步；配置技能同一 PR 更新                                                                           |
| 匿名 options 洪水挤掉他人 ceremony    | 他人登录仪式被驱逐（可用性）    | options 按 IP + 全局限速；条目上限 + 过期清理；单进程假设写入文档                                                                           |
| 并发注册绕过上限/唯一性               | 凭证覆盖或超额                  | 唯一性/上限/userHandle 全部在同一 `mutateUsersFile` 锁内复核                                                                                |
| 计数器落盘被误当成克隆防护            | 安全承诺失真                    | 计数只存进程内、`passkeyEnforceCounter` 标记为尽力检测；README 写清边界                                                                     |
| 运维把 passkey 当成「独立第二因子」   | 与 TOTP 的安全假设错位          | 文档写清「passkey 自带两因子、可能云同步」；要独立因子的环境 `passkey: "off"`                                                               |

## 9. 决策状态

**已拍板**

1. **校验器**：服务端用 `@simplewebauthn/server`（用户确认；浏览器侧手写 glue）。
2. **TOTP 关系**：GitHub 模型——passkey 登录恒为完整认证，`totp` 只约束口令登录。
3. **默认值**：`passkey: "off"`。
4. **条件 UI**：v1 提供，默认关，管理员在「账号安全」设置页打开（立即生效）。

**待拍板**

1. **删除凭据验证强度**：仅会话 + `checkRequestOrigin`；删最后一把或 `--all` 时再认证（口令 + TOTP 码）。（已拍板）
2. **CLI 一次性注册链接**（管理员代发，方便远程用户）：v2 再做，v1 只做「先口令登录再自己注册」。（已拍板）

> 六项决策已于 2026-11-11 全部拍板，本方案进入实现；PR1 从契约、`users.yaml` 字段、ceremony 存储与 CLI 开始。

> **实施进度（2026-11-12，已完成）**：M6 三个 PR 全部落地并通过 `npm run verify` 全链路（178 文件 / 1498 tests，
> 含 lint/FSD/覆盖率/构建/bundle/host 检查，17 条 protocol 路由）：PR1 `152e46b`（契约、`users.yaml` 存储、
> ceremony、配置派生、CLI、config skill）、PR2 `f20f2de`（`@simplewebauthn/server@14.1.0`、options/login、
> 登录页按钮 + 条件 UI、真栈集成测试）、评审修复 `0a8f747`（begin 配额、`Permissions-Policy`、503 顺序等）、
> PR3（注册/管理/设置端点含再认证、客户端通行密钥区块与条件 UI 开关、README/known-limitations/部署文档、
> D35 转 implemented）。
> **隔离实例验证（2026-11-12）**：在独立 `DSH_HOME` 的 `passkey-verify` profile（端口 3099、`publicHost: http://localhost:3099`、`passkey: "optional"`）里用 Playwright + CDP 虚拟认证器走完「口令登录 → 注册通行密钥 → 登出 → 通行密钥登录」；`/auth/status` 回 `authenticated:true, name:alice,passkeyEnabled:true`，条件 UI 开关的开/关两种状态都验证过。验证中抓到并修掉两个真实缺陷（`Permissions-Policy` 必须写成 `=(self)` 而不是 `=()`；登录页的 passkey 开关必须每次渲染现取而不是挂载快照），见 PR #125。截图见 `docs/demo/passkey-login.en.png` 与 `docs/demo/passkey-account-security.en.png`。

## 10. 参考

- W3C WebAuthn Level 3：注册校验 §7.1、登录校验 §7.2、`fmt:none` §8.7、flags BE/BS §6.1.3、RFC 8152 COSE
  Key 标签（kty=1、alg=3、crv/x/y=-1/-2/-3）、
  origin 精确匹配 §13.4.9、related origin §5.11、官方向量 §16.2/§16.4/§16.6。
- MDN / caniuse：浏览器支持与条件 UI 版本（Chrome 108 / Firefox 119 / Safari 16；iOS 第三方浏览器可能不可用）。
- 仓库内定位：`src/host/features/password/api/password-endpoints.ts:136-170`（端点注册模型）、
  `src/host/features/password/model/session-issue.ts:75-89`（唯一会话签发）、
  `src/host/features/password/model/challenge-cookie.ts`（D10 签名 cookie 先例）、
  `src/host/shared/http/origin.ts:50-74`（CSRF 校验）、`src/host/entities/user/model/users-file.ts`（users.yaml）、
  `src/endpoints-wiring.ts`（root 装配）、`src/client/widgets/account-section/ui/account-section.tsx:58-79`。
- 外部评审：`docs/reviews/kimi-k3.1-passkey-review_zh.md`（2026-11-11，Kimi K3.1 Pro，request-changes；
  F1–F8 已按上文处理）。
- `@simplewebauthn/server` v14.1.0 文档（options 生成与 verify* 的期望值参数）：
  [simplewebauthn.dev](https://simplewebauthn.dev/docs/packages/server)。
- GitHub Docs: [About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
  （passkey 同时满足口令与 2FA；云同步 passkey 的定位）。
- 相关决策：D2（fail-closed/启动自检）、D3（零依赖 scrypt 先例）、D10（HMAC 挑战 cookie）、
  D19（客户端 IP）、D31（跨半边契约）、D35（本方案）。
