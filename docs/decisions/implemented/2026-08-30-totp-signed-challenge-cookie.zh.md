# D10. TOTP 挑战 cookie 加 HMAC 签名（取代 D6 的「不签名」）

## 决定了什么

挑战 cookie 值从 `<username>.<expiresEpochMs>` 改为 `<username>.<expiresEpochMs>.<mac>`，
`mac = HMAC-SHA256(进程级随机密钥, <username>.<expiresEpochMs>)`（base64url）。密钥在
`apply()` 内 `randomBytes(32)` 生成，与限速器 / 防重放守卫同寿命；解析时恒时比较 MAC，
无效一律视为无挑战（走密码路径）。D6 的其余决定（无状态、无 pending 会话、不重提交密码、
TTL 300s、SameSite=Lax、成功后同帧清零）不变。

## 背景

D6 否决了签名挑战令牌：cookie 只证明「密码阶段最近通过」，真正闸门是 TOTP 码；伪造
username 只改变验证谁的 secret。Grok 4.6 安全评审（2026-08-30）指出残余风险：未签名
cookie 可被**伪造跳过密码阶段**——攻击者构造 `dsh_auth_challenge=<victim>.<未来时间戳>`
后，只要持有受害者当前 6 位码（肩窥、恶意软件、90s 窗口窃码）即可完成登录；2FA 的
AND 语义（密码**且**验证码）退化为仅 TOTP。`off` 模式与 `disable` 的第二段缺口（D10
配套修复：`totpMode` 分流与 `user.disabled` 检查）进一步放大了「密码阶段可被绕过」的后果。

## 考虑过的替代方案

- **D6 原状（不签名，只文档化）** — 代码零改动、重启后新鲜 cookie 仍可续挑战；但
  「持有 TOTP 码者即可跳过密码」需写进 README 作为接受的风险，两段式字面保证不成立。
  仅适合明确接受「TOTP 码等同登录」的内网门。
- **服务端 pending 挑战** — 引入存储/清理状态，与无状态架构冲突（D6 已论证），被拒。
- **一次性随机 token 绑定挑战** — 等价于 pending 状态，同上被拒。

## 为什么这样选

「跳过密码」把 TOTP 从第二因素降成唯一因素，单门公网部署不可接受。进程级 HMAC 签名：
不新增配置项、不新增依赖、不碰存储，与既有内存限速/防重放同模型，符合 T4「无其他新
配置」与 D1 fail-closed。代价（重启/插件重载后在途挑战失效，用户需重新输入密码，窗口
≤ 5 分钟）与 README「挑战态 5 分钟」同量级，可接受并已写明。

## 影响

- 新模块 `src/features/password/challenge-cookie.ts` 承载构建/解析（password slice 内）；
  password 经 deps 注入密钥（`challengeMacKey: Uint8Array`），不 import totp（D9）。
- 升级到含本决策的版本并重启后：旧明文 cookie 解析为「无挑战」→ 用户回密码页重新登录。
- 测试：`challenge-cookie.test.ts`（篡改 / 旧明文格式 / 错 key / 点号用户名 / 过期）；
  stage2 端点测试同步更新。
