# TOTP 修复计划（dsh-auth-gate 0.11.x）

> ## 状态：已实施（2026-08-30，决策 A）
>
> 本计划已按决策 A（HMAC 签名挑战 cookie）完整落地于 0.11.1 修复：
> P0.1 / P0.2 / P0.3-A、P1.1-P1.3、测试缺口 1-10 与 12 合入 PR-fix；
> P2（冻结规格修订注记、README、SKILL、ADR D10）合入 PR-docs。
> 实施期间发现并处理：测试文件行数预算（拆分 describe / 独立集成文件）、
> slice:check 白名单扩充（integration-totp-helpers / integration.totp-hardening）。

> 读者：按本文落地的开发者。本文把已核实的 TOTP 评审发现改写成可执行步骤。
> 权威现状以仓库当前 `development` 分支源码为准；`docs/implemented/impl-m4.md` 是 **M4 冻结规格**，改它必须附 ADR 或规格修订注记，禁止静默改写历史决策。
> 架构约束（贯穿全文，不再逐条重复）：
>
> - **deps 注入**：password slice **不 import** totp slice（D5 / D9）。新能力从 `src/index.ts` `apply` / `mountAuthEndpoints` 注入 `PasswordLoginDeps`。
> - **fail-closed**：凭证不确定时拒绝，不放行（D1）。
> - **行预算**：`max-lines` 250（空行/注释不计）、函数 ≤ 80、复杂度 ≤ 15。`password-login.ts` 已 295 行（含注释），P0/P1 若再膨胀必须拆文件。
> - **测试 harness**：TOTP 端点测试共用 `test/password-totp-harness.ts`（src 外，禁止在 src 内新建跨测试 helper）。

---

## 1. 概述

### 1.1 目标

堵住 TOTP 两段式登录的安全缺口，使「禁用用户无法完成第二段」「`totp: "off"` 真正忽略 TOTP」「限速/防重放语义与成功登录对齐」，并把冻结规格、README、ADR、技能文档回写到与实现一致。

### 1.2 范围

**会改**

| 层                 | 文件                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 登录流             | `src/features/password/password-login.ts`、`password-endpoints.ts`；必要时新增 `src/features/password/challenge-cookie.ts`                                                                                         |
| 装配               | `src/index.ts`（只加 deps 字段，不改 token 模式）                                                                                                                                                                  |
| TOTP 算法 / 防重放 | `src/features/totp/replay-guard.ts`；可选 `src/features/totp/totp.ts`（dummy-HMAC）                                                                                                                                |
| 测试               | `password-endpoints.totp-stage1.test.ts` / `totp-stage2.test.ts`、`replay-guard.test.ts`、`totp.test.ts`、`integration.totp.test.ts`、`test/password-totp-harness.ts`；必要时 `password-endpoints.methods.test.ts` |
| 文档               | `docs/implemented/impl-m4.md` + `impl-m4_zh.md`（修订注记）、ADR、`docs/decisions.md`、`README.md` / `README.zh.md`、`.agents/skills/dsh-auth-gate-config/SKILL.md`                                                |

**不会改**

- `mode: "token"` 路径（`src/features/token/`、TokenGate）。
- 守卫 / 会话存储 / scrypt / `LoginRateLimiter` 算法本身（P10 语义保留；只调整**调用时机**）。
- `revokeBySubject`、登录 CSRF token、限速持久化（T13 / D8 维持不做；只补 `TODO(auth-m5):` 标记）。
- 用户名字符集（P5 / `USERNAME_RE`）、挑战 TTL 300s、cookie 名 `dsh_auth_challenge`、窗口 ±1。
- 不新增 npm 依赖。

### 1.3 决策点：挑战 cookie 签不签名

M4 ADR D6 明确**否决**了签名挑战令牌（`docs/decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md` 第 22–24 行）：cookie 只证明「密码阶段最近通过」，真正闸门是 TOTP 码；伪造 username 只改变验证谁的 secret。

评审指出的残余风险：cookie **未签名**意味着攻击者可以**跳过密码阶段**——伪造 `dsh_auth_challenge=<victim>.<未来时间戳>` 后，只需受害者当前 6 位码（肩窥、恶意软件、90s 窗口内窃码）即可登录。D6 的「攻击者没有 code」前提在「码已泄漏」时不成立。`GET /auth/login` 也不读用户文件（`password-endpoints.ts` 第 62–71 行），任意格式合法的 cookie 都会渲染挑战页。

仓库负责人必须在开工前二选一。

#### 方案 A — HMAC 签名挑战 cookie（推荐）

- cookie 值改为 `<username>.<expiresEpochMs>.<hmac>`，HMAC-SHA256，密钥为 `apply()` 内 `randomBytes(32)` 进程级密钥（与 limiter / replayGuard 同寿命，**不新增配置项**，遵守 T4「无其他新配置」）。
- 解析时 `timingSafeEqual` 校验 MAC，失败视为无挑战（走密码路径 / 渲染密码页）。
- **优点**：恢复「密码阶段确实通过」这一认证事实；伪造 cookie 不再能跳过密码；与 D1 fail-closed 一致。
- **代价**：在途挑战 cookie 在**进程重启后全部失效**（即使用户浏览器里 Max-Age 还没到）——这是行为变化，必须写进 README。多实例/多进程不共享密钥，挑战不能跨进程续上（本插件本就是单门、内存限速模型，可接受）。
- **文档**：新 ADR D10 取代 D6 中「不签名」这一条（D6 原文保留为历史，不改 archived 规则下的已落地正文；在 D6 文末加 2 行「被 D10 部分取代」指针）。`impl-m4.md` T5 / §3.3 加修订注记。

#### 方案 B — 只文档化风险，代码不签名

- 代码零改签名面；在 README「注意事项与局限」、SKILL、D6 补「残余风险」段。
- **优点**：无兼容性变化；重启后新鲜 cookie 仍能提交验证码（当前 README 第 304–307 行承诺的行为得以保留）。
- **代价**：密码阶段可被伪造 cookie 绕过；`totp: "required"` 下攻击者可对任意用户名打 TOTP 码（仍受限速）。与「两段式」的字面保证不一致。
- **文档**：新 ADR 或 D6 增补「接受无签名残余风险」；README 必须出现「挑战 cookie 未签名，持有当前 TOTP 码即可跳过密码」这句。

#### 推荐

**选 A。** 单门公网部署下，「跳过密码」把 TOTP 从第二因素降成唯一因素。进程级 HMAC 不引入配置、不碰 storageDomain，重启失效窗口 ≤ 5 分钟，与内存限速/防重放同模型。方案 B 只适合「明确接受 TOTP 码等同登录」的内网门。

未拍板前：**P0.1 / P0.2 可先合**；P0.3 的代码路径按 A 写在独立提交/PR 里，以免 B 被误装进 0.11.1。

---

## 2. P0 修复项

### 2.1 禁用用户仍能走完 TOTP 第二段

- **问题**：`handleTotpSubmit` 只拒绝「无 `totpSecret`」，不看 `user.disabled`。管理员在挑战 TTL（300s）内禁用账号后，持有挑战 cookie + 当前码仍可拿到会话。严重度：**严重**。
- **修改文件与位置**：
  - `src/features/password/password-login.ts` 函数 `handleTotpSubmit`，第 98–146 行（用户取出在 111–119 行）。
  - 对照：密码路径 `rejectedInvalid` 第 224–247 行——禁用用户**仍做真实哈希验证**再 401（`password-endpoints.login-reject.test.ts`「still verifies the real hash for disabled users before rejecting」）。
  - 密码阶段已拦禁用：`password-endpoints.totp-stage1.test.ts` 第 42–48 行；**第二段没有对应测试**。
- **具体改法**：禁用检查放在 TOTP 校验**之后**、发会话**之前**，避免用「跳过 HMAC」给禁用账号计时侧信道（与 P9 密码路径对齐）。伪代码（保持 deps / 401 文案 / 日志不变）：

```ts
const user = loaded.snapshot.users.get(username);
if (user?.totpSecret === undefined) {
  deps.limiter.recordFailure(ip, username);
  reject401(res, deps); // 现有 401 + cache-control + "invalid credentials" + info("login rejected")
  return;
}

const matched = deps.verifyTotp(user.totpSecret, code, deps.now());
const replay = matched !== undefined && deps.replayCheck(username, matched, code);
if (matched === undefined || !replay || user.disabled) {
  deps.limiter.recordFailure(ip, username);
  reject401(res, deps);
  return;
}
```

抽出 `reject401` 小函数以免 `handleTotpSubmit` 超过 80 行。`user.disabled` 为 true 时：若码已匹配，`replayCheck` 已经登记——窗口内该码作废，fail-closed，可接受。

不要在「无 secret」分支为了计时去调 `verifyTotp`（secret 不存在）；无 secret / 未知用户维持现状短路径 401（与 §3.4 第 101 行一致）。dummy-HMAC 是 P1 可选项，不阻塞本项。

- **影响面 / 风险 / 兼容性**：
  - 行为变化：禁用账号的在途挑战 cookie 在下一次 POST code 时变为 401（以前会发会话）。这是漏洞修复，无升级开关。
  - 已签发会话仍不受影响（T13/P15：禁用只拦新登录）。
  - 不改 cookie 格式、不改 401 响应体。
- **测试**（文件 `src/features/password/password-endpoints.totp-stage2.test.ts`，用 `makeHarness` / `aliceChallengeCookie` / `SECRET_ALICE`）：
  1. `disabled user with secret and a valid challenge cookie is rejected at TOTP submit`：`h.users.set("alice", { ...alice, disabled: true })`，`setVerifyImpl` 返回 counter，`POST code=123456` + alice 挑战 cookie → `status === 401`、`body === "invalid credentials"`、`set-cookie` 不含 `dsh_auth=`。
  2. `disabled user still runs verifyTotp before rejecting`：断言 `setVerifyImpl` 被调用（harness 里用计数闭包），避免回归成「禁用则跳过 HMAC」。
  3. 集成：`src/integration.totp.test.ts` 增 `disabled user is blocked at the password stage even with a TOTP secret`（规格矩阵 #5 已要求、当前缺失）。

### 2.2 `totpMode === "off"` 时第二段与挑战页仍生效

- **问题**：`handlePasswordLogin` 第 91–94 行只要「挑战 cookie 合法 ∧ body 有 code」就进 TOTP 路径，**不看 `deps.totpMode`**。`GET /auth/login` 第 66–71 行同样只看 cookie。配置改为 `"off"` 后，在途 cookie 或伪造 cookie 仍能完成两段式 / 看到验证码页。与 T4「off = 完全忽略 secret」和 stage1 测试「off mode ignores secrets entirely」（`password-endpoints.totp-stage1.test.ts` 第 26–32 行，只覆盖**密码阶段**）不一致。严重度：**中**。
- **修改文件与位置**：
  - `src/features/password/password-login.ts` `handlePasswordLogin` 第 71–96 行（分流在 91–94 行）。
  - `src/features/password/password-endpoints.ts` `handleLogin` GET 分支第 62–72 行。
  - 装配已注入 `totpMode`：`src/index.ts` 第 187 行 `totpMode: config.totp`。
- **具体改法**：

```ts
// handlePasswordLogin
if (challenge !== undefined && code !== "" && deps.totpMode !== "off") {
  await handleTotpSubmit(deps, res, challenge, code, next, ip);
  return;
}
await handlePasswordSubmit(deps, res, params, next, ip);

// handleLogin GET
const challenge = parseChallengeValue(
  parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE),
  deps.now(),
);
const showTotp = challenge !== undefined && deps.totpMode !== "off";
res.end(showTotp ? totpChallengePageHtml(next) : passwordLoginPageHtml(next));
```

`off` 时带 code 的 POST 落到密码路径：harness 里无 username/password → 已有「code without challenge cookie」用例同形，401。不要在 TOTP 路径里对 `off` 另写 401，以免跟「忽略 TOTP」语义分叉。

- **影响面 / 风险 / 兼容性**：
  - 运维把 `totp: "optional"|"required"` 改回 `"off"` 并重启后：浏览器里还活着的挑战 cookie 不再打开验证码页、不再能换会话。用户需重新走密码登录（off 下直接发会话）。这是配置语义修复。
  - 若选方案 A，重启本身就会让 cookie 失效，本项在 A 落地后对「重启改配置」是冗余保险；对「热改配置但不重启」仍有意义（当前 apply 无热更新，cordis 重载插件等于重启）。
- **测试**：
  - `password-endpoints.totp-stage2.test.ts`：
    1. `off mode: leftover challenge cookie + code does not issue a session`：`h.setTotpMode("off")`，`setVerifyImpl` 返回 counter，`POST code=123456` + `aliceChallengeCookie()` → 401，且 `h.replayCalls` 为空（根本没进 TOTP 路径）。
    2. `off mode: GET with leftover challenge cookie renders the password page`：`setTotpMode("off")`，GET + alice cookie → body 含 `name="username"`、不含 `name="code"`。
  - 已有 stage1 `off mode ignores secrets entirely` 保留，作为密码阶段回归。

### 2.3 挑战 cookie 签名（方案 A vs 方案 B）

- **问题**：`buildChallengeValue` / `parseChallengeValue`（`password-login.ts` 第 14–33 行）明文 `<username>.<expiresEpochMs>`，无 MAC。D6 有意为之。严重度：**中**（在「码已泄漏」前提下升级为高）。
- **修改文件与位置**（**仅方案 A**）：
  - 现码：`buildChallengeValue` 第 14–16 行、`parseChallengeValue` 第 19–33 行（`lastIndexOf(".")`）、签发第 178–193 行。
  - GET/POST 读取：`password-endpoints.ts` 第 67–70 行、`handlePasswordLogin` 第 85–88 行。
  - cookie 工具：`src/session/session-store.ts` `buildSetCookie` 第 12–19 行（复用，不改签名）。
  - 装配：`src/index.ts` `apply` 第 223–224 行附近（与 `limiter` / `replayGuard` 一起建密钥）、`mountAuthEndpoints` 第 176–194 行注入。

#### 方案 A 改法

1. **拆文件**（行预算）：新建 `src/features/password/challenge-cookie.ts`（password slice 内，不进 totp、不进 shared——这是认证面状态，不是通用 cookie 解析）。把 `CHALLENGE_COOKIE`、`CHALLENGE_TTL_SECONDS`、`buildChallengeValue`、`parseChallengeValue` 迁过去；`password-login.ts` / `password-endpoints.ts` / harness 改 import。从 `password/index.ts` 再导出常量，避免测试深 import 断裂。
2. **deps** 增加 `challengeMacKey: Uint8Array`（32 字节）。`index.ts`：

```ts
const challengeMacKey = randomBytes(32); // node:crypto，与 totp.ts 同模块风格
// mountAuthEndpoints(...): PasswordLoginDeps 增
challengeMacKey,
```

测试 harness：`makeHarness` 固定 `Buffer.alloc(32, 7)`（或 `randomBytes(32)` 一次），保证同一 harness 内签发/解析一致。

3. **格式与解析**（用户名 P5 允许 `.`，见 `src/shared/users-file.ts` 第 8 行 `USERNAME_RE`；**必须继续用「从右侧切」**，见 §4.2）：

```
value = `${username}.${expiresEpochMs}.${mac}`
mac   = createHmac("sha256", key).update(`${username}.${expiresEpochMs}`).digest("base64url")
```

`parseChallengeValue(value, nowMs, key)`：

- `lastIndexOf(".")` 取 mac；再对前缀 `lastIndexOf(".")` 取 username / expires。
- mac 长度与本地计算值不同 → 直接 `undefined`（等长才能 `timingSafeEqual`）。
- `timingSafeEqual(computed, provided)` 失败 → `undefined`。
- expires 校验保持第 25–29 行：`Number.isInteger(expires) && expires > nowMs && expires - nowMs <= CHALLENGE_TTL_SECONDS * 1000`。
- **不要**用 `===` 比较 mac。

4. **签发**（`handlePasswordSubmit` 第 178–189 行）改为 `buildChallengeValue(username, expires, deps.challengeMacKey)`。
5. password 切片继续只通过 deps 拿 key，**不**为了 HMAC 去 import `features/totp`。

#### 方案 B 改法

不改 cookie 格式、不改 deps。只做 §4 文档。测试补一条**文档契约**测试可选，但代码侧至少补「伪造 cookie 能进入 TOTP 路径」的回归注释，避免后人当 bug 修掉又没 ADR。

- **影响面 / 风险 / 兼容性**：
  - **A**：升级到含 A 的 0.11.1 并重启后，旧明文 cookie（`alice.<exp>`）解析失败 → 用户看到密码页，需重新输入密码。正在验证码页的人会丢挑战态（最多 5 分钟）。**多副本进程**之间挑战不能互通（与当前内存 limiter 相同限制）。
  - **B**：无运行时变化。
- **测试**（A 落在 `password-endpoints.totp-stage2.test.ts` + 新 `src/features/password/challenge-cookie.test.ts`，避免把解析细节塞进 80 行 describe）：
  1. `tampered mac is treated as no challenge (GET renders password page)`。
  2. `forged unsigned value alice.<exp> is treated as no challenge`（旧格式升级）。
  3. `wrong key (simulating restart) rejects a cookie issued by another key`。
  4. `valid signed cookie still completes TOTP submit`（改 `aliceChallengeCookie()`：harness 用同一 key 调 `buildChallengeValue`）。
  5. `dotted username round-trips`：`alice.bob` + 合法 exp + mac → parse 得 `alice.bob`。
- **B 的测试**：`forged challenge cookie skips the password stage` 作为**已知行为**锁在 stage2（注释引用 D6/D10-B），防止无文档的行为漂移。

---

## 3. P1 修复项

### 3.1 `recordSuccess` 过早 / 限速连续性

- **问题**：
  1. TOTP 成功路径第 132 行在检查 session store（133–140 行）**之前** `recordSuccess`。store 503 时失败桶已被清零，攻击者可「4 次错码 + 一次正确码撞 503」洗桶。
  2. 密码路径第 165 行在 `rejectedInvalid` 通过后立刻 `recordSuccess`，随后 `required` 无 secret 又 `recordFailure`（169–176 行）。净效果：正确密码会**先清空历史失败**再记 1 次失败，限速被正确密码重置。
  3. 两段式第一段成功发挑战 cookie 前也已 `recordSuccess`（165 → 178 行），密码阶段失败次数不带入 TOTP 阶段。T8 要求「错误验证码与错误口令一样走同一指数退避」——第一段清桶后 TOTP 从 0 开始，等于给了第二段额外 5 次。
- **修改文件与位置**：`src/features/password/password-login.ts`
  - `handleTotpSubmit` 第 132–145 行。
  - `handlePasswordSubmit` 第 164–203 行。
  - 限速器本身不改：`src/shared/rate-limit.ts` `recordSuccess` 第 64–69 行。
- **具体改法**：

```ts
// handleTotpSubmit：先拿 store，成功签发前再清桶
const store = deps.sessions();
if (store === undefined) {
  // 系统错误：不计失败、也不 recordSuccess（与 loadUsersOr503「不计失败」对称）
  res.setHeader("cache-control", "no-store");
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("session store unavailable");
  deps.logger.error("login failed: session store unavailable");
  return;
}
deps.limiter.recordSuccess(ip, username);
await issueSession(deps, res, store, username, next, [
  buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure),
]);

// handlePasswordSubmit：删掉第 165 行的提前 recordSuccess
if (await rejectedInvalid(...)) return;

if (deps.totpMode === "required" && user?.totpSecret === undefined) {
  deps.limiter.recordFailure(ip, accountKey); // 不再先 success 再 failure
  reject401(...);
  return;
}
if (needsTotp) {
  // 第一段通过：清桶（密码已证明），然后发挑战。T8「同一 limiter」仍成立：
  // TOTP 错码从 0 计；这是有意选择——密码正确不应继承错密次数。
  deps.limiter.recordSuccess(ip, accountKey);
  // 发挑战 cookie + 302（现有 178–193 行）
  return;
}
const store = deps.sessions();
if (store === undefined) { /* 503，未 recordSuccess */ return; }
deps.limiter.recordSuccess(ip, accountKey);
await issueSession(...);
```

关于第 3 点「第一段是否清桶」：**保持清桶**（密码已通过，不应让之前的错密锁定挡住合法第二段），但在计划的测试里把该语义写死，避免再被当成漏洞来回改。P1 要修的是「失败路径误清桶」和「503 误清桶」，不是「两段共用一个计数器不断档」。

- **影响面**：`required` 下用正确密码撞无-secret 用户，不再重置该账号/IP 的历史失败。503 后错码计数保留。第一段成功后的 TOTP 仍有 5 次额度（与现网一致）。
- **测试**：
  - `password-endpoints.totp-stage2.test.ts`：`TOTP success with missing session store returns 503 and does not clear the failure bucket`：先 4 次错码，`h.setStore(undefined)`，正确码 → 503；再 `setStore` 恢复后第 5 次错码 → 429（若被错误 success 清桶则不会 429）。
  - 同文件或 stage1：`required mode: correct password for a no-secret user does not reset prior failures`：先 4 次错密，再 `setTotpMode("required")` 对 bob 正确密码 → 401；再一次失败 → 429。
  - 密码路径 503 已有 `password-endpoints.login-rate.test.ts` 第 223–238 行；**补一句**「503 前若已有失败，桶不被清」（当前没断言 limiter）。可加在该文件，不必新建套件。

### 3.2 防重放按 counter 拒绝

- **问题**：T7 / §3.2 记录 `(counter, code)`。实现 `TotpReplayGuard.checkAndRecord`（`replay-guard.ts` 第 19–40 行）仅当 **counter 且 code 都相同** 才拒绝（第 31 行）；第 33 行 `entries.set(counter, code)` 在同 counter 不同 code 时会**覆盖**。单测还把这锁成契约：`replay-guard.test.ts` 第 17–21 行 `allows a different code at the same counter`。真实 TOTP 一个 counter 只有一个合法码；按 (counter, code) 配对让「同窗口第二次」有一条无意义的允许路径，也与「本窗口已用过」的运维直觉不符。
- **修改文件与位置**：`src/features/totp/replay-guard.ts` `checkAndRecord` 第 19–40 行；测试 `replay-guard.test.ts` 第 17–21 行。
- **具体改法**：

```ts
if (entries.has(counter)) return false; // 本窗口已用，不论 code
// prune: existingCounter < counter - 1（保持与 §3.2 一致，见 §4.2 T7 内部矛盾的处理）
entries.set(counter, code);
```

值仍存 code（调试/未来审计），比较不再用 code。

- **影响面**：同窗口提交第二个不同的 6 位串，以前 guard 返回 true（端点仍会因 `verifyTotp` 失败而 401），现在 guard 也 false。对外 401 不变；仅在「HMAC 碰撞」或测试假 `verifyTotp` 返回同一 counter 不同 code 时行为更严。重启仍清零。
- **测试**（`src/features/totp/replay-guard.test.ts`）：
  1. **改** `allows a different code at the same counter` → `rejects a different code at the same counter`：第二次 `false`。
  2. 保留 `allows the same code at a different counter`。
  3. `src/features/password/password-endpoints.totp-stage2.test.ts` 已有 `replayed code (guard false)`（第 52–59 行）；加一条：`setVerifyImpl` 对任意 code 都返回 counter `100`，第一次 123456 成功，第二次 654321 + 同一 cookie → 401 且 `replayCalls` 两次。

### 3.3 挑战页 error slot 接线

- **问题**：`totpChallengePageHtml(next, error?)`（`src/shared/login-page.ts` 第 198–218 行）已支持 `<p class="error">`（`renderLoginCard` 第 105–106 行），规格 §3.4 第 123 行要求 error slot（文案仅 `"invalid credentials"`）。但 `handleLogin` GET 第 71 行调用 `totpChallengePageHtml(next)` **从不传 error**；POST 失败是 401 `text/plain` 正文 `"invalid credentials"`（`handleTotpSubmit` 第 125–128 行）。用户用表单提交错码后看到的是空白纯文本，不是带错误条的挑战卡。密码页同款 slot 的 escape 测试在 `password-endpoints.methods.test.ts` 第 156–164 行；挑战页没有。
- **修改文件与位置**：
  - `src/features/password/password-endpoints.ts` `handleLogin` 第 62–72 行。
  - `src/features/password/password-login.ts` `handleTotpSubmit` 失败分支第 112–129 行。
  - HTML：`src/shared/login-page.ts` 第 198–218 行（函数签名不用改）。
- **具体改法**（保持 401 状态码，改的是 **content-type / body**，让浏览器表单能看到 slot；fetch 客户端仍看 status）：

```ts
// 失败：401 HTML，挑战 cookie 不清除（浏览器继续持有，可重试）
function rejectTotp(deps: PasswordLoginDeps, res: ServerResponse, next: string): void {
  deps.logger.info("login rejected");
  res.setHeader("cache-control", "no-store");
  res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
  res.end(totpChallengePageHtml(next, "invalid credentials"));
}
```

`password-endpoints.ts` **不要** import totp slice；`totpChallengePageHtml` 已从 `shared` 进口。把 `rejectTotp` 放在 `password-login.ts` 即可（已 import shared）。

GET 不读 query `error=`（避免开放重定向式的任意文案；slot 文案只允许这一个常量）。不把 query 原文灌进 HTML。

- **影响面**：stage2 里 `expect(res.body).toBe("invalid credentials")`（第 47–48 行等）**会红**。改断言为：`status === 401`、`content-type` 含 `text/html`、body 含 `class="error"` 与 `invalid credentials`、含 `name="code"`、**不含**攻击者可控的 error 串。这是对浏览器用户可见的修复；纯文本 401 契约来自 M3 密码路径，TOTP 失败改为 HTML 需在 `impl-m4.md` §3.4 修订注记写明（P2）。
- **测试**：
  - `password-endpoints.totp-stage2.test.ts` 更新 wrong code / replay / unknown user 的 body 断言。
  - `password-endpoints.methods.test.ts` 的 `passwordLoginPageHtml` describe 旁新增 `totpChallengePageHtml`：escape（复制密码页那条 `bad <script>` 用例）、无 error 时不含 `class="error"`。
  - 集成 `full two-stage... wrong code is rejected`：除 status 401 外可 `text()` 含 `name="code"`（可选，防回归成纯文本）。

### 3.4 `verifyTotpCode` dummy-HMAC 快路径（可选）

- **问题**：`src/features/totp/totp.ts` `verifyTotpCode` 第 92–112 行：`code.length !== 6`（第 98 行）与 `base32Decode` 失败（第 102–103 行）直接 `undefined`，不跑 HMAC。合法 secret + 错码会走 3 次 HMAC。users.yaml 允许任意非空 `totpSecret` 字符串（P4 / T3）。可选加固，**不阻塞 P0**。
- **修改文件与位置**：`src/features/totp/totp.ts` `verifyTotpCode` 第 87–112 行。
- **具体改法**：解码失败时改用 20 字节全零 dummy secret，仍跑 `t0±window` 的 `hotpCode` + `timingSafeEqual`，循环结束仍 `undefined`。长度非 6：保持立即拒绝（客户端 maxlength=6，且不等长无法 `timingSafeEqual`）。**不要**为了计时去 `===` 比较。密码切片继续经 deps 调 `verifyTotp`，本项只改 totp 纯函数。
- **影响面**：畸形 secret 的 CPU 升到与真 secret 同阶（防探测「这个用户的 secret 是否合法 base32」）。无协议变化。
- **测试**（`src/features/totp/totp.test.ts` `rejects wrong code / wrong length / invalid secret` 第 71–77 行）：保留 `undefined` 断言；可选 `it.skip` 不计时（CI 不稳定）。不把「跑了 HMAC」做成 mock，因为 `createHmac` 未注入。文档写清：本项是 best-effort，不作为 0.11.1 验收必选项。

---

## 4. P2 文档与规格回写

`docs/implemented/impl-m4.md` 是冻结规格（文首第 3–11 行）。改正文用 **「修订注记」** 段（文首或对应行旁），不要假装 M4 当时就长这样。中文镜像 `docs/implemented/impl-m4_zh.md` 同步改。ADR 按 `docs/decisions/README.md`：已落地记录用现在时；**推翻**某条时写新记录并链接旧条，不改 archived 哈希。

### 4.1 T10 装配签名（规格 ≠ 实现）

- **规格**（`docs/implemented/impl-m4.md` 第 54 行）：`verifyTotp => Promise<boolean>`，`replayGuard: TotpReplayGuard`。
- **实现**（`password-login.ts` 第 48–51 行）：`verifyTotp => number | undefined`（匹配 counter），`replayCheck: (username, counter, code) => boolean`。装配在 `src/index.ts` 第 188–190 行。D9（`docs/decisions/implemented/2026-08-30-totp-slice-and-injection.zh.md` 第 7–8、29 行）已按实现描述。
- **改法**：T10 修订注记改为与实现一致，并写一句「返回 counter 才能把 T7 的匹配窗口交给 replayCheck；password 不持有 `TotpReplayGuard` 实例，符合 D9」。不要把实现改回 `Promise<boolean>`（会丢 counter，反而要在 password 里重算窗口）。

若方案 A 给 deps 加了 `challengeMacKey`，同一注记列出该字段。

### 4.2 §3.3 first-dot vs 实现 last-dot；T7 prune 口径

- **规格** `docs/implemented/impl-m4.md` 第 86 行：「split on first `.`」。第 85 行又写用户名字符集含 `.`、「与 `.` 分隔符无冲突」——自相矛盾。P5 `USERNAME_RE`（`users-file.ts` 第 8 行）**允许**中间 `.`。
- **实现** `parseChallengeValue` 第 21 行 `lastIndexOf(".")`，对 `alice.bob.<exp>` 才是对的。
- **改法**：**改规格就实现**，不要改成 first-dot（会把 `alice.bob` 切成用户名 `alice`）。修订注记：「按最后一个 `.` 切开 expires；方案 A 再按倒数第二个 `.` 切开 mac。用户名可含 `.`（P5）。」
- T7 表格（第 51 行）写 drop `counter-2` 以前；§3.2 第 78 行写 `counter' < counter - 1`。实现第 27 行按 §3.2。修订 T7 表格与 §3.2 / 代码对齐（保留 window-1，即丢掉早于 `counter-1` 的）。

`CHALLENGE_COOKIE` 规格第 84、160 行写在 `password-endpoints.ts`，实际在 `password-login.ts` 第 8 行（方案 A 迁到 `challenge-cookie.ts`）。蓝图一并改。

### 4.3 T13 `TODO(auth-m5):` 缺失

- **规格**第 57 行：新代码在回头看这些点的地方留 `TODO(auth-m5):`。
- **实现**：`src/` 内 **零条** `TODO`（已 grep）。D8 说「各留 TODO(auth-m5)」。
- **改法**（一行注释，不实现功能）：
  - `src/session/session-store.ts` `revokeByToken` 旁（第 87–90 行）：`// TODO(auth-m5): revokeBySubject — disabled users only block new logins (T13/D8).`
  - `src/features/password/password-endpoints.ts` `handleLogin` 旁：`// TODO(auth-m5): login CSRF token — re-evaluated in T13/D8, still not added.`
  - `src/shared/rate-limit.ts` 类注释第 22–24 行旁、`src/features/totp/replay-guard.ts` 第 7–10 行旁：`// TODO(auth-m5): persist limiter/replay across restart (T13/D8).`

### 4.4 README `required` 措辞

- 英文 `README.md` 第 123 行、中文 `README.zh.md` 第 110 行：`required` 写成「all users must (no code = no login)」——没写「无 secret / 未知用户在密码阶段就统一 401，防枚举」。
- **改成与 T4 一致**，例如：`required`：全员两段式；用户无 `totpSecret` 或用户不存在 → 与错密相同的 401 `invalid credentials`（不 503）。`optional` 保持「有 secret 才第二段」。

### 4.5 README 未签名 cookie / 重启语义

- 现状 `README.md` 第 300–307 行、`README.zh.md` 第 226–229 行：写了限速/防重放重启清零、挑战态 5 分钟、重启后 cookie 仍新鲜则验证码页可用。
- **方案 A**：改成「挑战 cookie 经 HMAC 签名，密钥随进程；重启后必须重新输入密码。cookie 本身无法伪造以跳过密码。」删掉「重启后若 cookie 仍新鲜则验证码页依然可用」。
- **方案 B**：在该段明确：「挑战 cookie **未签名**。攻击者若能伪造该 cookie 且持有当前 TOTP 码，即可跳过密码阶段。真正闸门是 TOTP 码与限速。」

### 4.6 SKILL.md TTL + 防重放

- `.agents/skills/dsh-auth-gate-config/SKILL.md` 限速行第 83 行只写「5 次失败锁 30s（重启清零）」；未写 TOTP 挑战 TTL、防重放重启清零、（A 或 B 的）cookie 语义。
- **改法**：在 Common failures 表加两行：
  - 验证码页转圈 / 提交后回密码页：挑战 5 分钟过期；方案 A 下进程重启也会丢挑战态。
  - 同一码第二次 401：防重放（内存，重启清零）；与限速相互独立。
- 该技能随包分发（`package.json` `files` 含 `.agents/skills`）。改完后部署侧需 `dsh-auth skill install --force` 才更新已安装副本——在 README 技能节加一句。

### 4.7 ADR

- **方案 A**：新建双语 `docs/decisions/implemented/YYYY-MM-DD-totp-signed-challenge-cookie.{zh,en}.md`（四节模板 `_template.zh.md` / `_template.en.md`），索引 `docs/decisions.md` 加 **D10**。D6 文末两行：「签名部分被 D10 取代；无状态、无 pending 会话、不重提交密码 —— 仍成立。」不要改 D6 正文取舍（避免把历史写成现在时谎言）。
- **方案 B**：D6 增「残余风险」小节，或新 D10「接受无签名挑战 cookie」；`docs/decisions.md` D6 摘要补半句风险。
- `npm run decisions:check`（`verify` 链一环）必须绿。不要动 `archived/`。

---

## 5. 测试补齐清单（12 项）

| #   | 缺口（评审名）                            | 落点文件                                      | 用例要点                                                                                                                                                                                                      | 前置                                                          |
| --- | ----------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | TOTP 提交路径不拒绝 disabled              | `password-endpoints.totp-stage2.test.ts`      | alice 置 `disabled: true` + 合法挑战 cookie + verify 返回 counter → 401、无会话 cookie；verify 仍被调用                                                                                                       | **P0.1 的验收**                                               |
| 2   | `totpMode=off` 残留 cookie 仍能 POST code | 同上                                          | `setTotpMode("off")` + 正确码 → 401，`replayCalls` 空                                                                                                                                                         | **P0.2 的验收**                                               |
| 3   | `totpMode=off` GET 仍渲染挑战页           | 同上                                          | GET + 残留 cookie → `name="username"`，无 `name="code"`                                                                                                                                                       | **P0.2 的验收**                                               |
| 4   | 伪造 / 篡改挑战 cookie                    | `challenge-cookie.test.ts`（A）或 stage2（B） | A：错 mac / 旧明文 / 错 key → 视为无挑战；B：锁「伪造可跳过密码」并引用 ADR                                                                                                                                   | **P0.3 的验收**                                               |
| 5   | 点号用户名 / last-dot 解析                | `challenge-cookie.test.ts` 或 stage2          | `alice.bob.<exp>[.<mac>]` round-trip；first-dot 切法不得作为实现                                                                                                                                              | P0.3（A）或 P2 规格（B 也可先补）                             |
| 6   | TOTP 路径 users 文件 503                  | `password-endpoints.totp-stage2.test.ts`      | harness `loadUsers` throw；POST code + 挑战 cookie → 503 `"user store unavailable"`，不计失败（对照 login-rate 第 205–220 行）                                                                                | 规格矩阵 #4，**P0 合入前即可写**（现码已有 `loadUsersOr503`） |
| 7   | TOTP 路径 session store 503 误清桶        | 同上                                          | 4 次错码 → 503 正确码 → 再错码 429                                                                                                                                                                            | **P1.1 的验收**                                               |
| 8   | required 正确密码误重置限速               | `password-endpoints.totp-stage1.test.ts`      | 4 次错密 + required 下 bob 正确密码 401 + 第 5 次 429                                                                                                                                                         | **P1.1 的验收**                                               |
| 9   | 防重放只认 (counter, code) 对             | `replay-guard.test.ts` + stage2               | 同 counter 不同 code → false；端点二次 POST 401                                                                                                                                                               | **P1.2 的验收**                                               |
| 10  | 挑战页 error slot 未接线                  | stage2 + `password-endpoints.methods.test.ts` | 错码 401 HTML 含 `class="error"` 与固定文案；HTML escape                                                                                                                                                      | **P1.3 的验收**                                               |
| 11  | 畸形 secret 跳过 HMAC                     | `totp.test.ts`                                | 非法 base32 / 空 secret → `undefined`；可选 dummy-HMAC                                                                                                                                                        | P1.4 可选，**不挡 0.11.1**                                    |
| 12  | 规格矩阵 #5 集成缺口                      | `integration.totp.test.ts`                    | （a）带 secret 的 disabled 用户卡在密码阶段；（b）`required` 未知用户 401（可与无 secret 合并）；（c）本文件不测 token 模式——token 回归仍由现有 `integration.auth.test.ts` 承担，本项只在注释写明以免重复起栈 | P0.1 后做（a）；其余可并行                                    |

说明：现有 stage1「disabled user with secret is blocked at the password stage」（第 42–48 行）**不算**缺口 1——它只覆盖第一段。现有 stage2「expired challenge cookie」（第 69–75 行）已够用，不进 12 项。现有 integration replay / required / off 保留。

---

## 6. 实施顺序与验收

### 6.1 PR 切分

推荐 **2 个 PR**（均 squash 进 `main`，head=`development`）：

| PR      | 内容                                                                                                                             | commit 类型                                                         | 是否发版                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| PR-fix  | P0.1 + P0.2 + P1.1 + P1.2 + P1.3 + 测试 1–3、6–10、12a + 若已拍板则含 P0.3-A 与测试 4–5；README 行为变化段（限速/禁用/401 HTML） | `fix:`                                                              | **会** → release-please 切 **0.11.1** |
| PR-docs | P2 规格修订注记、T13 TODO、SKILL、ADR D10、`docs/decisions.md`、测试 5（若 B）/ 11                                               | `docs:`（TODO 注释若单独出现可用 `chore:`；与文档同 PR 用 `docs:`） | 否                                    |

不建议把 P0.1 和 P0.2 拆成两次 `fix:`——会打出 0.11.1 与 0.11.2，changelog 碎片化。P1.4 dummy-HMAC 不够稳定就**不要**进 PR-fix。

若负责人尚未在 A/B 间拍板：PR-fix **不含** P0.3 代码，README 暂不改签名句；P0.3 作为第三个 PR（A=`fix:` 再发 0.11.2；B=`docs:` 不发版）。

### 6.2 建议提交说明

PR-fix squash 标题：

```
fix: reject disabled and totp-off on TOTP submit
```

若含签名：

```
fix: sign TOTP challenge cookies and fail-close submit path
```

PR-docs：

```
docs: amend M4 TOTP spec and record challenge-cookie ADR
```

正文建议列：disabled 第二段、off 分流、recordSuccess 后移、replay-by-counter、401 HTML error slot；（可选）HMAC。不要手改 `version` / `CHANGELOG.md` / `.release-please-manifest.json`。

### 6.3 落地步骤（执行者清单）

1. 负责人书面确认 §1.3 A 或 B（issue / PR 描述里写一行即可）。
2. 若 A：先加 `challenge-cookie.ts` + 单测（缺口 4–5），再改 login/endpoints/harness。注意 `password-login.ts` 行数；迁出 cookie helper 后应明显低于 250 有效行。
3. P0.1 → 测试 1 绿；P0.2 → 测试 2–3 绿。
4. P1.1 → 测试 7–8；P1.2 → 测试 9（先改会红的那条 guard 单测再改实现，或反过来，但同一 commit）。
5. P1.3 → 更新所有 `body === "invalid credentials"` 的 TOTP 失败断言，跑 stage2 全文件。
6. 测试 6（503 users 文件）与 12a。
7. `npm run build`（`lib/` 必须与 `src/` 同 commit，CI `git diff --exit-code -- lib`）。
8. `npm run verify`（format + lint + no-emdash + slice:check + lock:check + decisions:check + type-check + coverage 80% + build + bundle:check）。
9. PR-docs：impl-m4 双语修订注记、TODO(auth-m5)、README/SKILL、ADR；再跑 `npm run decisions:check` 与 `verify`。

### 6.4 分步验收标准

| 步骤   | 通过条件                                                                                |
| ------ | --------------------------------------------------------------------------------------- |
| P0.1   | 禁用用户：第一段仍 401；第二段（挑战 cookie + 正确码）401 无会话；verifyTotp 仍调用     |
| P0.2   | `totp: "off"` 时 GET/POST 残留挑战 cookie 等价于无 cookie                               |
| P0.3-A | 无 mac / 错 mac / 错 key → 密码页；合法签名 + 正确码 → 302 双 cookie（清挑战 + 发会话） |
| P0.3-B | README/ADR 出现「未签名 / 可跳过密码」原句；代码格式不变                                |
| P1.1   | 503 与 required 无-secret 不再 `recordSuccess`；4+1 失败仍 429                          |
| P1.2   | `checkAndRecord(u, c, a)` 后 `(u, c, b)` 为 false                                       |
| P1.3   | 错码响应 401 HTML，含 error slot 固定文案，next 仍 escape                               |
| P2     | `impl-m4.md` T10/§3.3/T13 与代码一致；`decisions:check` 绿；SKILL 含 TTL/replay         |
| 门禁   | `npm run verify` 全绿；`lib/` 无 drift                                                  |

slice:check：新文件必须落在 `features/password/`（或 totp 纯函数），password **不得** import `features/totp`。harness 保持在 `test/`。

---

## 7. 回滚与发布影响

- 当前 `package.json` version 为 **0.11.0**。PR-fix 的 squash commit 类型是 `fix:` → 按 `docs/specs/development.md` Releases：0.x 下 `fix:` → **0.11.1**（release-please 开 release PR，禁止手改 version/CHANGELOG/manifest）。
- PR-docs 的 `docs:` / `chore:` / `test:` **不发版**。
- **回滚**：revert 那条 `fix:` squash。行为回退包括：禁用用户可再走完第二段、off 残留 cookie 再生效、401 变回纯文本、（A）挑战 cookie 再变明文。部署侧若已强制用户重新登录（A 的重启失效），revert 后旧明文 cookie 仍可能在 TTL 内——A 的 parse 对旧格式当无效，revert 后旧格式又有效，属于短暂窗口，可接受。
- **升级已有部署**：
  - 必有：禁用 + off 语义变严；required 下正确密码不再洗限速桶。
  - 若 A：发布说明写「升级并重启后，未完成的 TOTP 挑战需重新输入密码」。
  - 若 401 HTML：依赖「TOTP 失败 body 恒为 `invalid credentials` 纯文本」的脚本要改看 status。
- **不回滚的文档**：ADR 一旦 implemented，revert 代码后应再写一条 ADR 说明回滚，而不是删除 D10。
- P1.4 若未进 0.11.1，不写进 changelog。

---

## 附录：关键代码锚点（本次阅读核实）

| 符号                                                       | 位置                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CHALLENGE_COOKIE` / `CHALLENGE_TTL_SECONDS`               | `password-login.ts` 7–11                                                            |
| `buildChallengeValue` / `parseChallengeValue`              | `password-login.ts` 14–33                                                           |
| `PasswordLoginDeps`                                        | `password-login.ts` 35–59                                                           |
| `handlePasswordLogin` 分流                                 | `password-login.ts` 85–96                                                           |
| `handleTotpSubmit`                                         | `password-login.ts` 98–146                                                          |
| `handlePasswordSubmit` `recordSuccess` / required / 发挑战 | `password-login.ts` 164–193                                                         |
| GET 挑战页                                                 | `password-endpoints.ts` 62–71                                                       |
| `totpChallengePageHtml`                                    | `login-page.ts` 198–218                                                             |
| `verifyTotpCode`                                           | `totp.ts` 92–112                                                                    |
| `TotpReplayGuard.checkAndRecord`                           | `replay-guard.ts` 19–40                                                             |
| 装配 `verifyTotp` / `replayCheck` / `totpMode`             | `index.ts` 187–190                                                                  |
| `USERNAME_RE`                                              | `users-file.ts` 8                                                                   |
| D6 否决签名                                                | `docs/decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md` 22–24 |
| T5 未签名 / T10 签名漂移 / §3.3 first-dot / T13 TODO       | `docs/implemented/impl-m4.md` 49、54、57、85–86                                     |
