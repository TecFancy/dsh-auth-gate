# dsh-auth M4 实施规格（executable spec）

> ## 修订注记（0.11.1，2026-08-30）——TOTP 加固评审
>
> M4 之后的评审（Grok 4.6）发现已在本文档基础上闭环修复；下文正文是历史 M4 契约，按以下修订：
>
> - **T5 / §3.3**：挑战 cookie 现为 **HMAC 签名**（`<username>.<expiresEpochMs>.<mac>`，进程级密钥；
>   MAC 无效视为「无挑战」）。见 ADR D10（取代 D6 的「不签名」）。
> - **T4**：`off` 同时闸住提交路径与 GET 渲染（残留/伪造挑战 cookie 在 off 下失效）；
>   提交路径拒绝 `user.disabled`（均在恒时验证之后检查，对齐密码路径）。
> - **T7**：防重放按 `(用户, counter)` 键控——同窗口的不同验证码同样拒绝（一个窗口恰有一个合法码）。
> - **T8**：`recordSuccess` 移至会话存储可用之后（503 保留失败桶）；`required` 无 secret 只计
>   `recordFailure`（不重置失败桶）。
> - **§3.4**：TOTP 失败返回 401 + 挑战页 HTML（error 槽位），不再是纯文本。
> - **T10**：实际装配为同步 `verifyTotp: (secretB32, code, nowMs) => number | undefined`
>   （返回匹配 counter）+ `replayCheck(username, counter, code)`；deps 增加
>   `challengeMacKey: Uint8Array`。
> - **T13**：`src/` 中三个复查点已留 `TODO(auth-m5):` 标记。
> - **§3.3**：按**最后一个** `.` 切分（用户名可含 `.`，P5）。
> - 新增文件：`src/features/password/challenge-cookie.ts`、
>   `src/integration-totp-helpers.ts` / `src/integration.totp-hardening.test.ts`（集成加固套件）。

> 读者：执行本规格的编码代理（预期 deepseek v4 flash，**新 session**）。本文档是**决策完备的可执行规格**：
> 所有决策点均已预先关闭；执行者只做翻译，不做设计。
> 基线：`docs/impl-m3_zh.md`（M3 已交付：users.yaml + scrypt + 限速 + `dsh-auth user` CLI——M4 在其上叠加）。
> M1 的 D1–D16、M2 的 M1–M22 和 M3 的 P1–P26 除非下文明确修订，否则保持不变。
> 设计依据：`docs/dsh-auth-plan_zh.md` §6 阶段 3 / §8；工程门禁与 slice（切片）布局：`docs/development.md`
> 和 `docs/src-refactor-plan.md`（分层 `src/`：gate/session 核心 + features/{token,password,proxy} + shared 叶子；
> 跨 slice 导入只能走 barrel（桶/聚束导出）；features 之间互不导入）。
> **本文件是 M4 细则的唯一权威**；与 plan/M1/M2/M3 冲突时，以本文件为准。
>
> 环境与验证工作流：见 `docs/handoff-m3_zh.md`（新 session 必读：服务器冒烟工作流 §4、M1–M3 踩坑 §3、
> M4 起步提示 §5）。**禁止自行探索 harness 内部**——如果需要本文件未给出的事实，停下并报告。

---

## 1. M4 目标

把阶段 3 的"OTP 加固"落地：在 M3 密码流之上叠加**TOTP 两段式登录**：

- `POST /auth/login`（password 模式）**仅对拥有 `totpSecret` 的用户**（且仅在配置开启时）变为两段式：
  密码通过 → TOTP 挑战页 → 输入正确的验证器验证码 → 签发会话 cookie；
- **没有** secret 的用户保持 M3 的精确行为（单段式密码登录，响应逐字节一致）；
- `mode: "token"`（M2）保持 100% 不变，守卫/会话/自检等其余机制同样不变；
- CLI 新增 `dsh-auth user totp enable <name>` / `user totp disable <name>`（生成 RFC 4648 base32 secret、
  写入 users.yaml、打印供验证器应用使用的 `otpauth://` URI；移除 secret）；
- TOTP 验证恒时、带窗口（±1），带**内存防重放（守卫）**（最近已验证的验证码再次提交会被拒绝）——
  与现有内存限速器一致（重启清零，README 注明）；
- M3 的全部评估遗留项在本里程碑重新评估并给出最终处置（T13）；
- 新决策按决策记录流程登记为 ADR（T15）：本里程碑是**第一个被 ADR 机制完整覆盖的功能里程碑**
  （重构里程碑回填了 D1–D5）。

守卫/会话/自检/限速器内部**不变**（限速器原样复用）；本里程碑新增 TOTP 流程、现有 password 端点内的
挑战阶段、CLI 命令与配置面。

---

## 2. 冻结决策表（M4 增量；D1–D16 / M1–M22 / P1–P26 不变）

| #   | 决策              | 冻结值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | 范围              | TOTP 两段式**仅适用于 `mode: "password"`**；`mode: "token"` 及所有其他机制与 M3/M2 逐字节一致。用户的 `totpSecret`（P4，已由 zod 解析但未使用）成为**按用户的启用标志**。零新增依赖（RFC 6238 = `node:crypto` HMAC-SHA1，不新增任何包；base32 编解码自写、约 40 行，以避免 Node 版本依赖）。                                                                                                                                                                                                                                                                                                                                                                                                              |
| T2  | 算法              | RFC 6238 TOTP，核心为 RFC 4226 HOTP：`counter = floor(unixTimeMs / 30000)`，8 字节大端计数，`HMAC-SHA1(secretBytes, counter)`，动态截断（offset = 末字节 & 0xf；取 4 字节；`& 0x7fffffff % 1_000_000`），**6 位**验证码，零填充。窗口 **±1（±1 个时间步）**（3 个计数：`t-1, t, t+1` → 90 秒有效，容忍时钟漂移）。验证码比较恒时（对等长数字缓冲做 `timingSafeEqual`）。                                                                                                                                                                                                                                                                                                                                  |
| T3  | secret 格式       | users.yaml 中的 `totpSecret` = **RFC 4648 base32、无填充、大写**，恰好 **32 字符（160 位，20 个随机字节）**。由 `randomBytes(20)` + 自写 base32 编码生成。CLI 打印 `otpauth://totp/<label>?secret=<BASE32>&issuer=dsh-auth` URI（label = `dsh-auth:<username>`，两者均百分号编码）供手动录入 / QR 使用。下游所有环节（verify）把 base32 解码成字节。上传其他长度/字符 → users 文件的 schema 校验保持 P4 不变（接受任意非空字符串；格式错误的 secret 只会验证失败、绝不崩溃——zod 本来就只检查 `string`）。                                                                                                                                                                                                 |
| T4  | 配置面            | 新增配置：**`totp: "off" \| "optional" \| "required"`**，默认 **`"off"`**（开箱即与 M3 行为逐字节一致；显式选择启用）。语义：`off` —— 完全忽略 secret（纯密码）；`optional` —— **有** secret 的用户走两段式，没有的用户保持单段式；`required` —— **所有**用户必须完成两段式：没有 secret 的用户（或未知用户）以统一 401 失败（绝不 503；保持防枚举，响应体与口令错误相同）。`totp` 用 `z.enum(["off","optional","required"])` 校验。无其他新配置（挑战 TTL/cookie 名/窗口均为模块常量，P22 风格）。                                                                                                                                                                                                       |
| T5  | 挑战机制          | **无状态挑战 cookie**（无待定会话状态、不涉及 storageDomain）：密码阶段通过后，设置 `dsh_auth_challenge = <username>.<expiresEpochMs>` —— HttpOnly、按 `cookieSecure` 加 `; Secure`、`SameSite=Lax`、`Path=/`、`Max-Age=300`（模块常量 `CHALLENGE_TTL_SECONDS = 300`）。值**不签名**（见 ADR T15-a）：该 cookie 只证明"密码阶段最近通过"；真正的闸门是 TOTP 验证码。`expiresEpochMs` 由服务端校验（`exp > now && exp - now <= 300_000`），因此手工重放的过期 cookie 会在服务端失效。                                                                                                                                                                                                                      |
| T6  | 端点行为          | 无新路由（同样 4 条：prefix 404 兜底 + `/auth/login`、`/auth/logout`、`/auth/status`；M16/P16 路由模型不变）。**`GET /auth/login`**：存在有效挑战 cookie → 渲染 **TOTP 挑战页**（单个 6 位验证码输入 + hidden next）；否则渲染密码页（其余渲染规则 M13/M20 不变）。**`POST /auth/login`**：挑战 cookie 有效**且** body 含 `code` → TOTP 提交路径；否则走 M3 密码路径。完整流程冻结于 §3.4（顺序：body → 挑战 cookie 解析 → 限速器 → users 文件 → 验证 → 会话）。                                                                                                                                                                                                                                          |
| T7  | 防重放（守卫）    | 内存**防重放（守卫）**（按用户名）：在 TOTP 验证_成功_时记录 `(counter, code)`；稍后再次提交相同的 `(counter, code)` 以统一 401 拒绝。维护：每用户上限 9 条，插入时丢弃早于 `counter-2` 的条目；条目上限 10 000 个用户，淘汰最旧的（与 `LoginRateLimiter` 同模式）。重启清零——与限速器一起在 README 注明。挑战 cookie 的一次性成功（签发会话时清除，T6）进一步收窄重放面。                                                                                                                                                                                                                                                                                                                                |
| T8  | 限速              | **复用现有 `LoginRateLimiter` 实例**（同样的 IP + 账号双桶、同样的 429 语义，P10 不动）：TOTP 提交路径在验证前调用 `check`，验证后调用 `recordFailure(ip, account)` / `recordSuccess(ip, account)`（account = 挑战 cookie 中的用户名）。因此错误验证码与错误口令一样触发相同的指数退避。此处 `username === ""` 不可能（cookie 携带用户名）。无新限速器、无新配置。                                                                                                                                                                                                                                                                                                                                        |
| T9  | 验证核心          | 新 slice `src/features/totp/`（启用 barrel；`scripts/verify-slice-boundaries.mjs` 的 `FEATURE_SLICES` 增加 `"totp"`）：`totp.ts`（base32 + HOTP/TOTP + `generateTotpSecret()` + 恒时 `verifyTotpCode(secretB32, code, nowMs, window=1)`）与 `replay-guard.ts`（`TotpReplayGuard`，按用户名的 counter/code 记录，上限/裁剪按 T7）。**password slice 绝不 import totp slice**（features 同层互禁）：由 `index.ts`（根、装配层）把 totp 实现注入 password deps（T10）。                                                                                                                                                                                                                                      |
| T10 | 装配（deps）      | `PasswordLoginDeps` 扩展：`totpMode: "off" \| "optional" \| "required"`、`verifyTotp: (secretB32: string, code: string, nowMs: number) => Promise<boolean>`（index.ts 注入 `features/totp` 实现）、`replayGuard: TotpReplayGuard`（与限速器一样，模块实例在 `apply` 中创建）。`password-endpoints.ts` 通过现有 `parseCookieHeader`/`buildSetCookie` 读写挑战 cookie。所有跨 slice 流量都落在 barrel 上（root → `features/totp/index.js` 等）。                                                                                                                                                                                                                                                            |
| T11 | 文件与行数预算    | `src/features/totp/totp.ts`（≤250）、`src/features/totp/replay-guard.ts`（≤250）、`src/features/totp/index.ts`（barrel），测试 `totp.test.ts` + `replay-guard.test.ts`（复制 helpers，测试间不互相 import——M3 踩坑 8）。`src/shared/login-page.ts` 新增 `totpChallengePageHtml(next, error?)`（同款卡片，一个 `code` 输入 `autocomplete="one-time-code" inputmode="numeric" maxlength="6"`）。`password-login.ts` 按需拆分（M3 P24 先例；登录 handler 因 TOTP 分支而变大——保持 ≤250，必要时把挑战 cookie 解析拆分进 `password-endpoints.ts`）。**`src/cli.ts` 必须保持 ≤250**：两个 TOTP 命令 handler 放在 `src/features/totp/cli.ts`（经 totp barrel 导出），`cli.ts` 用一个分支委托。                   |
| T12 | 日志纪律          | P23/M21 延续：**日志中永不出现验证码**（挑战 cookie 同样不出现）。TOTP 失败复用现有 `logger.info("login rejected")`（无验证码、无用户名——统一、防枚举）；成功复用 `"session issued"`。限速复用 `"rate limit exceeded"`。签发挑战 → 不记日志（M3 同样不为成功的密码阶段记日志；会话签发才是终态事件）。错误路径：`"user store unavailable"`（503，复用 M3 文案）。                                                                                                                                                                                                                                                                                                                                         |
| T13 | M3 遗留项（评估） | 最终处置，全部**不实现**，各附一行原因（记入 ADR T15-b）：**(a) `revokeBySubject`**（P15/P17 的 `TODO(auth-m4)`）——不做：users 文件每次登录都重读（P7）；为每个请求在 gate 路径上做文件 IO，是单门模型不值得的性能/缓存权衡；README 保留已记录的局限（禁用用户只拦住新登录）。**(b) 登录 CSRF token**（P21 再评估）——仍不加：TOTP 不改变该分析（伪造的 TOTP 提交也需要受害者的当前验证码；CSRF 设置挑战 cookie 无害——验证码才是闸门）；`SameSite=Lax` + 第三方 Set-Cookie 限制保持。**(c) 限速持久化**——不做：内存态重启清零已记录；TOTP 防重放（守卫）出于同样原因采用内存态并一同记录。新代码在重新审视这些点处保留 `TODO(auth-m5):` 标记。                                                             |
| T14 | CLI               | `dsh-auth user totp enable <name>` —— 用户必须存在且不被 disabled 标志拦截（任何用户状态都算已存在）；**仅当没有 secret 时**生成新 secret（已有 secret → stderr `user <name> already has a TOTP secret (disable first)` + exit 1）；经 `writeUsersFile` 原子写入 users.yaml（保留其他字段，0600，P19）；向 stdout 打印：base32 secret 与 `otpauth://` URI + 提示 "add to authenticator, then verify by logging in"。`dsh-auth user totp disable <name>` —— 移除 secret（幂等：无 secret → 成功，stdout 上打印 `user <name> has no TOTP secret`？**不**——静默成功，镜像 `disable` 的幂等性；仅出错时写 stderr）。无效名称/文件错误与现有命令一致（exit 1）。                                               |
| T15 | ADR 记录          | 实施时撰写，全部落入 `docs/decisions/implemented/`（双语 `(en\|zh).md`、四节模板、`verify-decision-records` 必须通过），然后扩展 `docs/decisions.md` 索引（D6+）：**(a)** `YYYY-MM-DD-totp-two-stage-challenge-cookie` —— 无状态挑战 cookie vs. 待定会话存储 vs. 单页重提交；**(b)** `YYYY-MM-DD-totp-disposition-of-m3-leftovers` —— T13 (a/b/c) 的评估结论；**(c)** `YYYY-MM-DD-totp-slice-and-injection` —— 新 `features/totp/` slice + 根层注入取代同层 import；**(d)** `YYYY-MM-DD-totp-config-off-by-default` —— 三态配置 + 默认 off（向后兼容）。若决策集紧凑，(a)+(d) 可合并为一个 ADR（决策 = "通过无状态挑战 cookie 自适应启用两段式，默认 off"）——执行者自行决定，但每个保留的决策必须可追溯。 |
| T16 | DoD               | (1) `npm run verify` 全绿（全部 10 个门禁；230 + 新测试）。(2) `lib/` 在同一提交中重建。(3) **otplib 交叉验证**（§3.1）：≥ 200 个随机用例 + RFC 向量，逐位一致，transcript 记入 handoff-m4。(4) 在 `web-test` 上做真实服务器冒烟（handoff-m3 §4 工作流）：密码 → 挑战页 → 错误验证码 401 → 正确验证码 → 会话 cookie；挑战 cookie 被清除；重放（同一验证码两次）→ 401；required 模式下无 secret 的用户 → 401；`mode:"token"` 回归不受影响。(5) README/README.zh 更新：配置表 + CLI + 局限（内存防重放/限速器重启清零；挑战 cookie TTL；`off` 默认）。(6) ADR 落地 + decisions.md 更新。(7) 写 `docs/handoff-m4.md`（环境事实、真实冒烟结果、交叉验证 transcript、踩坑、M5 起步提示；zh 镜像可选）。        |

---

## 3. 权威契约（M4 新增事实；其余见 impl-m2 §2 / impl-m3 §3）

### 3.1 TOTP 内部实现（RFC 6238 / RFC 4226，本机基线 Node 24.13.1 实测）

- 来自 `node:crypto`（`createHmac`）的 `HMAC-SHA1(key=secretBytes, msg=8-byte BE counter)`。
- 动态截断：`offset = lastByte & 0xf`；`binary = (d[offset] & 0x7f) << 24 | d[offset+1] << 16 | d[offset+2] << 8 | d[offset+3]`；
  `code = String(binary % 1_000_000).padStart(6, "0")`。
- 窗口 ±1（±1 个时间步）：对 `t in {t0-1, t0, t0+1}`，其中 `t0 = floor(nowMs / 30_000)`；若任一计数的
  验证码匹配，则验证判定为成功（随后做防重放检查，§3.2）。
- 恒时比较：双方转为等长缓冲（`Buffer.from(code, "ascii")`）+ `timingSafeEqual`。任何地方**都不要**回退到 `===`。
- `generateTotpSecret()`：`randomBytes(20)` → base32（RFC 4648 字母表 `A-Z2-7`、无填充、大写）。base32 编解码
  是 `totp.ts` 内的私有 helper（node 的 `Buffer` base32 支持随版本而异——自写可避开 engines 问题；约 40 行，
  通过往返测试做单测）。
- **与 otplib 交叉验证（用户已批准 2026-08-30）**：里程碑落地前，运行一个一次性临时脚本（放临时目录、
  绝不进仓库——development.md 规则 4）安装 `otplib@13.5.0`
  （`npm install --registry=https://registry.npmjs.org/ --no-save --prefix /tmp/...`），用 **≥ 200 个随机用例**
  将我们的实现与 `@otplib/totp`（验证器 30 秒步长、6 位）比对：随机 20 字节 secret（base32 编码）、`±1` 窗口内
  与窗口外的随机计数，加上 RFC 6238 附录 B 向量。每个用例都必须逐位一致（窗口命中与未命中）。这是证据而非
  运行时依赖：脚本的 transcript 记入 `docs/handoff-m4.md`；该包不加入 package.json。

### 3.2 防重放（守卫）语义

- 键：用户名。值：`Map<counter, code>`（≤ 9 条）。
- `checkAndRecord(username, counter, code): boolean` —— 若 `(counter, code)` 已记录 → 返回 `false`（重放，
  上游统一 401）；否则丢弃 `counter' < counter - 1` 的条目，插入，返回 `true`。
- `verifyTotpCode` 成功时，传给守卫的是_匹配的_那个计数（不是全部三个）。
- 条目上限：用户总数 ≤ 10 000，淘汰最旧用户（Map 迭代序，`LoginRateLimiter` 模式）。

### 3.3 挑战 cookie

- 名称：`dsh_auth_challenge`（`password-endpoints.ts` 内的模块常量）。
- 值：`<username>.<expiresEpochMs>`。用户名字符集 `[a-zA-Z0-9._-]`（P5）——与 `.` 分隔符无冲突。
- 读取时服务端校验：按第一个 `.` 切分；用户名非空且 `exp` 为整数且 `exp > now && exp - now <= 300_000` → 有效。
- 签发时机：密码阶段通过 **且** 用户有 secret **且** totpMode ≠ off →
  `buildSetCookie(CHALLENGE_COOKIE, value, 300, cookieSecure)` + `302 /auth/login?next=<validated next>`
  （next 从密码 POST 透传而来，已校验）。
- 清除时机：TOTP 成功 → `buildSetCookie(CHALLENGE_COOKIE, "", 0, cookieSecure)` + 签发会话（响应形状与 M3 相同：
  302 + 会话 cookie）。重新走过的密码阶段只是覆盖它。
- `logout` 不碰它（挑战 cookie 反正会因 TTL/服务端过期而死）。

### 3.4 冻结的登录流程（password 模式，TOTP 感知）

```
POST /auth/login：
  1. parseFormBody（415/413 → respondFormError，M19 语义）
  2. next = validateNext(body next ?? "/")
  3. challenge = parseCookieHeader(req.headers.cookie, "dsh_auth_challenge")
  4. 若 challenge 有效且 body 含 "code"：
       → TOTP 路径：ip/account 限速检查（429 短路，P10）；loadUsers（出错 503）；
         从 challenge 解析用户名；user = snapshot.users.get(username)；
         若 user === undefined 或 user.totpSecret === undefined → recordFailure + 401（统一）
         t0 = floor(now/30000)；match = verifyTotp(user.totpSecret, code, now)
         若 !match → recordFailure + 401 "invalid credentials" + info("login rejected")
         若 !replayGuard.checkAndRecord(username, matchedCounter, code) → recordFailure + 401（重放，统一）
         recordSuccess；清除挑战 cookie；issueSession(username, next)   [M3 issueSession 不变]
       （任何 loadUsers/session-store 失败 → 用 M3 的 503 文案）
  5. 否则 → M3 密码路径不变，例外：`rejectedInvalid` 通过之后：
       用户有 totpSecret：
         totpMode "off"      → issueSession（M3 行为）
         totpMode "optional" → 签发挑战 cookie + 302 /auth/login?next=...   （TOTP 页 next）
         totpMode "required" → 签发挑战 cookie + 302 /auth/login?next=...
       用户无 totpSecret：
         totpMode "off"|"optional" → issueSession（M3 行为）
         totpMode "required"      → recordFailure + 401 "invalid credentials"（统一，计入限速）

GET /auth/login：
  挑战 cookie 有效 → 200 totpChallengePageHtml(next)   （next 取自 query，已校验）
  否则              → 200 passwordLoginPageHtml(next)   （M3 不变）

登录页 / 挑战页的卡片共用 CARD_STYLE（P13）；挑战卡：
  标题 "Verify"，副标题 "Enter the 6-digit code from your authenticator app"，
  一个输入 name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"
  autofocus，提交按钮 "Verify"，hidden next，错误槽位（仅统一 "invalid credentials" 文案）。
```

### 3.5 CLI 契约新增（P18/P19 扩展）

```
dsh-auth user totp enable <name>   --file <path>
  - <name> 必须匹配 USERNAME_RE 且存在于文件中（否则 stderr + exit 1，沿用现有错误风格）
  - 已有 secret → stderr "user <name> already has a TOTP secret (disable first)" + exit 1
  - 新 secret = generateTotpSecret()；snapshot.users.set(name, { ...user, totpSecret: secret })
  - writeUsersFile（原子、0600、P19）；stdout：
      "TOTP secret for <name>: <BASE32>"
      "otpauth://totp/dsh-auth%3A<enc name>?secret=<BASE32>&issuer=dsh-auth"
      "Add it to your authenticator app, then verify by logging in."
dsh-auth user totp disable <name>  --file <path>
  - 用户必须存在（否则 stderr + exit 1）
  - 移除 totpSecret（不存在 → 仍算成功，exit 0，与 `disable` 一样幂等）
  - stdout "user <name> TOTP disabled"
```

实现位于 `src/features/totp/cli.ts`（经 barrel 导出）；`cli.ts` 新增：
`if (command === "totp") return totpCommand(file, tokens[2], tokens[3], io)`——行数预算检查：`cli.ts` 保持
≤250（usage 常量 + 一个分支；handler 住在 totp slice）。

---

## 4. 文件蓝图（src/ 与 docs/）

```
src/features/totp/index.ts        barrel：export * from "./totp.js"；export * from "./replay-guard.js"；export * from "./cli.js"；
src/features/totp/totp.ts         base32 编解码、HOTP、TOTP（窗口）、generateTotpSecret、verifyTotpCode（≤250）
src/features/totp/replay-guard.ts TotpReplayGuard（≤250）
src/features/totp/cli.ts          totpCommand + enable/disable handler（≤250，每个函数 ≤80）
src/features/totp/totp.test.ts    RFC 6238 附录 B 向量（secret 12345678901234567890 ASCII → base32 → 6 位）、
                                  窗口 ±1 边界、base32 往返、恒时路径、畸形输入
src/features/totp/replay-guard.test.ts  记录/重放/多用户/上限/裁剪/时钟注入
src/shared/login-page.ts          + totpChallengePageHtml（卡片复用）
src/features/password/password-login.ts   deps + TOTP 分支（≤250；必要时拆到 password-endpoints）
src/features/password/password-endpoints.ts 挑战 cookie 常量/解析/签发/清除 + GET/POST 分发（≤250）
src/index.ts                      config totp 字段 + replayGuard 实例 + verifyTotp 接线（T10）
src/cli.ts                        一个 `totp` 分支委托给 features/totp/cli.ts（≤250）
scripts/verify-slice-boundaries.mjs  FEATURE_SLICES += "totp"
docs/impl-m4.md  （本文件）+ docs/impl-m4_zh.md（镜像，同一批）
docs/decisions/implemented/2026-08-30-*.{en,zh}.md   按 T15 的 ADR（verify-decision-records 必须通过）
docs/decisions.md                  索引扩展（D6+）
README.md / README.zh.md           配置表（+totp）、CLI 小节（+user totp …）、局限段落
docs/handoff-m4.md                 给 M5 的 handoff（en；zh 镜像可选）
```

端点流测试位于 `src/features/password/` 下（`password-login.totp.test.ts` 与/或 `password-endpoints.totp.test.ts`
——按 describe 拆套件以遵守 `max-lines-per-function` 上限，M3 踩坑 7），外加集成文件
`src/integration.totp.test.ts`（独立 ctx/端口栈、真实 scrypt、经真实 `verifyTotp` 的 TOTP + 注入 TOTP 与
防重放守卫的假固定时钟以求确定性；429 用例单独 describe、起新栈——M3 P25）。

**必读踩坑提醒（来自 handoff-m3 §3）：** (1) `deps.verify` 参数顺序——与 `verifyPassword` 相同签名；
(7) describe 回调行数上限/套件拆分；(8) 测试间不互相 import、src/ 内不建 helper 文件；(11) fetch 集成测试
必须 POST body。新增：(12) **绝不记录验证码/挑战 cookie**；(13) `timingSafeEqual` 双方必须等长——始终
填充/转换，绝不 `===`；(14) 防重放（守卫）只在_匹配的_计数上写入，绝不在窗口未命中时写入。

---

## 5. 测试矩阵（新增；现有套件必须保持绿）

| #   | 套件                            | 用例                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | totp.test.ts                    | RFC 6238 附录 B 向量：secret "12345678901234567890"（ASCII 字节）base32 编码，T=59 → 287082（6 位）；T=1111111109 → 89005924→6 位 005924？（对照本地计算参考值断言——执行者用同一实现计算，再与 RFC 的 8 位值 mod 10^6 交叉核对）；窗口：t0 的验证码在 t0±1（≥90 秒后）仍被接受、在窗口外被拒绝；错误验证码 → false；畸形 secret/空验证码 → false；base32 往返：20 个随机字节 → 编码 → 解码 = 原值；大写/无填充不变式 |
| 2   | replay-guard.test.ts            | 同一 (user, counter, code) 两次 → 第二次 false；不同 counter 相同 code → true；多用户隔离；修剪：旧计数被丢弃；上限：1 万个用户淘汰；时钟注入                                                                                                                                                                                                                                                                        |
| 3   | password-login.totp.test.ts     | off 模式：有 secret 的用户 → 直接发会话（与 M3 逐字节一致）；optional：有 secret → 挑战 cookie + 302（该响应无会话 cookie）；无 secret → 直接发会话；required：无 secret → 401 + 计入失败；错误验证码 → 401 + 计入失败；正确验证码 → 会话 + 挑战清除；重放（第二次 POST 同一验证码）→ 401；过期挑战（时钟注入）→ 视为无挑战 → 走密码路径                                                                             |
| 4   | password-endpoints.totp.test.ts | GET /auth/login 携带有效挑战 cookie → 挑战页 HTML（含 code 输入）；不带 → 密码页；POST 分发：带有效挑战的 code → TOTP 路径；无挑战的 code → 密码路径（username/password 字段）；405 不变；限速：5 个错误验证码 → 429（含 retry-after）；users 文件错误 → 503                                                                                                                                                         |
| 5   | integration.totp.test.ts        | 真实栈、真实 scrypt、真实 TOTP、注入时钟：完整两段式（密码 → 302 挑战 → GET 挑战页 → POST 验证码 → 302 + 会话 cookie 在 `/__auth_probe` 可用）；错误验证码；重放；required 模式无 secret 用户；禁用用户（无论有无 TOTP）在密码阶段被拦截；`mode:"token"` 不变回归（冒烟级）                                                                                                                                          |
| 6   | cli.test.ts 新增                | totp enable：新用户 → 打印 secret + users.yaml 含 32 字符 base32 + URI；已有 secret → exit 1 + stderr；缺 name/非法 name → exit 1；disable：移除 secret、幂等、未知用户 → exit 1                                                                                                                                                                                                                                     |
| 7   | slice:check                     | 新 slice 通过（features/totp 仅由 root 经 barrel 导入；password 绝不 import 它）                                                                                                                                                                                                                                                                                                                                     |

覆盖率：保持 ≥ 80% 红线（新文件体积小、被密集覆盖）。

---

## 6. 实施顺序

1. `scripts/verify-slice-boundaries.mjs` 的 FEATURE_SLICES += `"totp"`（否则新目录是 `null` → slice:check 失败）。
2. `totp.ts` + `totp.test.ts`（先纯函数，向量全绿）。
3. `replay-guard.ts` + 测试。
4. `login-page.ts` 挑战卡 + 测试（卡片 HTML 断言放端点测试）。
5. `password-login.ts`/`password-endpoints.ts` 的 TOTP 分支 + 挑战 cookie + 测试（T6/T8 逻辑）。
6. `index.ts` 配置 + 接线（T4/T10）+ `integration.totp.test.ts`。
7. `features/totp/cli.ts` + cli.ts 分支 + 测试。
8. `npm run build`（lib/ 同一提交），完整 `npm run verify`。
9. **otplib 交叉验证脚本**（临时目录，transcript 供 handoff-m4）。
10. ADR（T15）+ decisions.md + README zh/en + docs/impl-m4_zh.md；最终 verify。
11. 服务器冒烟（适配 handoff-m3 §4 工作流：用新 CLI 添加 TOTP 用户，走一遍 §3.4 流程），然后写
    `docs/handoff-m4.md`。
