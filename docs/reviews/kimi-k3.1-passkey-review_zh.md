# Kimi K3.1 Pro Review — 通行密钥（passkey / WebAuthn）登录可行性方案

- **日期**: 2026-11-11
- **审阅者**: Kimi K3.1 Pro（Kimi Code API，`k3.1-pro`，reasoning effort low，提示约 42k 字符；非 DSH subagent 路由，理由见文末）
- **范围**: `docs/plans/passkey-login-plan(_zh).md` 与 D35 `docs/decisions/proposed/2026-11-11-passkey-login(_zh).md`（worktree `feat/passkey-login`，未提交）
- **结论**: **request-changes（针对规格，不是代码）**——方案方向成立，但开工前必须修 TOTP 降级、注册事务、登录 BE 一致性三处
- **标准**: 仓库 `AGENTS.md`、`docs/specs/dsh-auth-plan_zh.md` 威胁模型、WebAuthn L3/RFC 8152

## 总评

可做。v1 砍掉 passkey-only、attestation、条件 UI 是合理的。但现稿有两处必须在开工前修正：
**`totp: "required"` 被 warn 后静默绕过**（等于让管理员误以为策略仍生效），以及**凭据唯一性/数量上限未明确在
写盘事务内检查**（并发注册可绕过）。此外，自写校验器不是天然更安全，现有测试策略也证明不了浏览器端
glue 的正确性，必须补畸形样本与差分测试。

## Findings

| ID  | 级别     | 标题                                                                  |
| --- | -------- | --------------------------------------------------------------------- |
| F1  | critical | `totp: "required"` 与 passkey 同时配置时 warn 后继续降级              |
| F2  | critical | 注册的唯一性/上限/userHandle 生成没有明确放进同一次写盘事务（TOCTOU） |
| F3  | major    | 登录 finish 缺少「当前 BE 与注册时一致」校验                          |
| F4  | major    | 计数器「尽力写盘」与「可靠克隆检测」的语义自相矛盾                    |
| F5  | major    | 匿名 ceremony Map 可被用于驱逐他人条目（可用性），方案未定义限速      |
| F6  | major    | 调研输入把 COSE `crv` 标签写成 3（实为 -1），暴露手写解析器的测试缺口 |
| F7  | minor    | 「自写 = 更安全」论证不成立；估算（6–8 人日）偏乐观                   |
| F8  | minor    | 条件 UI 被当成「~40 行」的可稳定小改动                                |

### F1 — critical — `totp: "required"` 被降级

**位置**: `docs/plans/passkey-login-plan_zh.md` §5.8（修订前）「记一条 warn，README 写清要严格 TOTP 就关 passkey」。

**问题**: 启动只 warn 然后让 passkey 绕过 `totp: "required"`，管理员会以为强制 TOTP 仍生效。同步 passkey
（BE=1）把私钥同步到云端，不能无条件替代部署策略声明的独立第二因子。

**改法**: 不做 warn 后降级。`totp: "required"` 与 `passkey !== "off"` 是配置矛盾：要么启动拒绝，要么明确把
passkey 按 off 处理（口令 + TOTP 保持强制）；要 passkey 就把 `totp` 显式降为 `off/optional`。若 v1 就要
「passkey 后继续要 TOTP」，先把 TOTP 第二段从 password slice 下沉为共享步骤。

**用户决议（2026-11-11，本条不采纳）**: 参考 GitHub 登录模型——
[GitHub Docs: About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
写明 passkey 同时满足口令与 2FA 要求，开了 TOTP 的账号用 passkey 也是一步登录。故方案改为：passkey 登录恒为
完整认证，`totp` 只约束口令登录；同步 passkey 的残留风险写进文档，需要独立第二因子的环境设 `passkey: "off"`。
本条的「不许 warn 后静默降级」仍保留（不做降级，而是明确语义）。

### F2 — critical — 注册写盘事务

**位置**: §5.4「上限/全局唯一」与 §5.6 注册第 6 步（修订前）。

**问题**: 方案只写了「全局唯一、每用户 ≤ 10、首次生成 userHandle」，没有说明它们与写盘在同一个
`mutateUsersFile` mutator 内复核；锁外预检 + 锁内直接写会让并发注册绕过上限或覆盖记录。

**改法**: 三项检查全部移到同一次 `mutateUsersFile`（锁 + CAS）内，先复核再写；并在负样本测试里加并发注册用例。

### F3 — major — 登录缺少 BE 一致性校验

**位置**: §5.6 登录 finish 第 3 步（修订前）。

**问题**: 调研稿要求登录时当前 BE 必须等于注册值（§7.2），方案漏了；`BE=0 && BS=1` 的非法组合只在注册侧拒绝。

**改法**: 登录校验 `credential.be === recorded.be`，不一致拒绝；`BS` 仅记诊断；注册侧同时记录 BE。

### F4 — major — 计数器语义

**位置**: §5.4 与 §5.6 第 5 步（修订前）「尽力写盘 + `passkeyEnforceCounter`」。

**问题**: 写盘失败只记日志，则「跨重启的克隆检测」依据已经失效；并发使用同一凭据也会制造计数器回退，
`enforce=true` 会误锁。方案不能既宣称可靠克隆检测、又承认写盘不可靠。

**改法**: 计数只存进程内，`lastUsedAt` 节流落盘；`passkeyEnforceCounter` 明确为**尽力检测**，只在
`be=false && bs=false` 时拒绝，文档不得宣称克隆防护承诺。

### F5 — major — ceremony 驱逐攻击

**位置**: §5.5（修订前）。

**问题**: 1024 条目上限防内存泄漏，但不防匿名方反复建条目把他人 ceremony 挤掉；方案没有给 options 限速。

**改法**: `/auth/passkey/options` 按客户端 IP + 全局限速（独立 `LoginRateLimiter` 实例），注册 options 另按
用户限速；cookie/条目/browser timeout 使用同一 TTL；写明单进程假设（多副本需黏性会话，v1 不支持）。

### F6 — major — COSE 标签错误

**位置**: 调研输入 `data/tmp/passkey-research/webauthn-brief.md`（不入库）§1.3。

**问题**: 稿件写 `crv = coseKey.get(3)`，暴露「手写解析器」的典型缺口；评审本身给的「crv 是标签 2」也不准确。

**改法**: 以 RFC 8152 为准钉死：`kty=1`、`alg=3`、`crv=-1`、`x=-2`、`y=-3`，并在单测里覆盖标签错位与
COSE 非常规形状（重复键、截断、尾随字节）。

### F7 — minor — 「自写 = 更安全」论证与估算

**位置**: §6（修订前）。

**问题**: 「21 个传递包 / 870 KiB」是维护成本，不是漏洞证据；250–400 行 + 6–8 人日的估算偏乐观。

**改法**: 选 A 的理由改为「attestation 链不需要 + 依赖预算 + 可差分测试」；估算上调到 8–10 人日，并要求
畸形/截断/尾随数据/非规范整数的负样本表 + 差分测试；若维护成本过高，最小回退是只把 CBOR 换成
`@levischuck/tiny-cbor`。

**用户决议（2026-11-11，采纳并更进一步）**: 不再自写校验器，服务端校验改用 `@simplewebauthn/server@14.1.0`
（精确锁版；21 个传递包、解包约 870 KiB，只进 Host 侧），浏览器侧 `get`/`create` glue 仍手写；估算
6–7 人日（含条件 UI 设置页开关）。

### F8 — minor — 条件 UI 估算

**位置**: §9 第 6 项（修订前）。

**问题**: 条件 UI 涉及 AbortController、与按钮 ceremony 的竞争、密码登录时取消 mediation，不是稳定的 40 行。

**改法**: 从「~40 行」改为「不是可稳定估的小改动」；仍列为 v1 不做。

## 关注点逐条回应

| 决策                  | 评审结论                  | 处理                                                                                             |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| 1 自写 vs 引库        | 有条件同意自写            | **已改**：用户拍板用 `@simplewebauthn/server` 做服务端校验，浏览器 glue 手写；不再自写 CBOR/COSE |
| 2 passkey 是否免 TOTP | 不同意「required 还免」   | **未采纳**：用户按 GitHub 官方模型拍板（passkey 满足口令 + 2FA），`totp` 只约束口令登录          |
| 3 删除凭据再认证      | 有条件同意仅会话          | 采纳：完整会话 + Origin + 独立限速 + 审计；删最后一把或 `--all` 要求再认证                       |
| 4 CLI 一次性注册链接  | 同意 v2                   | 维持 v2                                                                                          |
| 5 默认 off            | 同意                      | 维持 off                                                                                         |
| 6 条件 UI v1 不做     | 同意，但反对「40 行」估算 | **已改**：v1 提供条件 UI（默认关，管理员可在设置页打开，+1 人日）；措辞按评审修改                |

## 建议落地顺序（合入前）

1. 按 GitHub 模型写清 TOTP 与 passkey 的关系，并把同步 passkey 的残留风险写进文档（F1 不采纳）。
2. 改存储事务与计数器章节（F2 / F4）。
3. 改校验与 ceremony 验收：库参数（expected*/UV/算法白名单）、BE 一致性、Origin 覆盖、匿名限速、畸形样本测试（F3 / F5 / F6）。
4. 再进入 PR1；PR2/PR3 不按修订前的稿子直接开工。

## 范围外（明确不作为 finding）

- attestation 策略 / MDS / related origin requests / passkey-only：v1 明确不做，评审同意。
- 浏览器端 glue 的 e2e（Playwright/CDP）：仓库无浏览器测试层，v1 用真机手工矩阵替代，评审未反对。
- DSH subagent 路由：本次评审通过 Kimi Code API 直接调用（`KIMI_CODE_API_KEY`），因为当前会话的
  subagent 模型路由不含 Kimi；把 Kimi 接进 review 位是另一个待办（`memory/open-items.md`）。
