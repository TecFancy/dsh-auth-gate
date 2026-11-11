# 通行密钥（passkey）登录

## 决定了什么

在 `password` 模式下新增**第二种登录方式**：用户可注册通行密钥（WebAuthn，`attestation: "none"`，UV 必须），
登录页可选择「Sign in with a passkey」，无需用户名；注册必须在已登录会话之外再做一次当前口令（+ TOTP）验证。
服务端校验用 **`@simplewebauthn/server`**（MIT，21 个传递包、解包约 870 KiB，只进 Host 侧），浏览器侧手写
约 60–80 行 `get`/`create` glue；RP ID / origin 只从既有 `publicHost`
派生；v1 只提供 `passkey: "off" | "optional"`，不做 passkey-only；条件 UI 默认关、管理员可在「账号安全」
设置页打开；passkey 登录恒为完整认证
（对齐 GitHub 的 passkey 模型：passkey 同时满足口令与 2FA 要求，`totp` 只约束口令登录）；不接受同步 passkey
的环境用 `passkey: "off"`。方案见 `docs/plans/passkey-login-plan_zh.md`。

## 背景

登录门现在只有「共享 token」或「口令 + 可选 TOTP」。TOTP 解决不了钓鱼（实时转发 OTP 仍然有效），也不减少
口令复用、喷洒与拖库后的离线破解面。passkey 把口令从登录路径上拿掉，凭据绑定 origin，是同时提升安全性与
便利性（一次触摸/生物识别）的标准做法。仓库已有全部前置件：服务端渲染登录页 + 渐进增强内联 JS、TLS 反代
前提、`publicHost` 配置、统一会话签发、限速、CSRF 校验与失败卡片。约束是：运行时依赖预算很小（本方案
显式接受一个校验库）、登录页零第三方资源、无 JS 时密码必须可用、`/auth` 前缀由门整体放行（端点自负责）。

## 考虑过的替代方案

- **维持口令 + TOTP，不做 passkey** —— 不解决钓鱼与口令面，产品上缺「更安全且更方便」的选项。
- **接 OAuth/OIDC 外部身份提供商** —— 可行但引入外部依赖与跳转配置，自托管场景多一个要维护的服务；
  passkey 是浏览器标准能力，无服务端依赖。
- **邮件魔术链接 / 邮箱 OTP** —— 需要邮件基础设施，安全性弱于 origin 绑定的凭据，且同样可被钓。
- **只支持硬件安全密钥（FIDO2，不可同步）** —— 对没有硬件密钥的用户不可用，排除掉「方便」这一半收益；
  同步 passkey 的云端复制风险在文档中明确，并由设备绑定凭证的计数器策略覆盖。
- **passkey-only（关闭口令）** —— 锁定与恢复路径不成熟（丢失全部设备且无口令 = 永久锁死），v1 不做。
- **自写校验器（`node:crypto` + 最小 CBOR/COSE，0 运行时依赖）** —— 依赖面最小，但 CBOR/COSE/签名边界是
  最容易写错的安全代码（调研稿自己就把 COSE `crv` 标签写错过），需要 250–400 行实现 + 300–400 行测试兜底；
  用户评估后选择引库，把风险交给成熟实现。
- **无用户名登录 vs 先输用户名** —— 无用户名（discoverable）少一步、天然不泄露账号是否存在，故选它。

## 为什么这样选

passkey 是唯一同时满足「抗钓鱼、无口令、浏览器原生、无外部服务」的选项；仓库已有全部前置件，新增面集中在
一条校验路径上。校验器引 `@simplewebauthn/server`：它覆盖的正是 CBOR/COSE/签名/attestation 这些最容易写错
的安全边界，而我们保留 ceremony 存储、凭证事务、限速、审计与 UI 这些策略层；依赖代价（21 个传递包、约
870 KiB，只进 Host 侧）显式接受并精确锁版。注册再认证是安全红线：会话被劫后加后门 passkey 是 passkey 相对 TOTP
唯一新增的持久化攻击面，必须堵住。v1 不碰 passkey-only 与 attestation，把改动面、锁定风险与评审成本都压在
可控范围；`publicHost` 作为唯一 RP ID 锚点，避免在既有半外壳反代（改写 `Host`、剥 `Origin`）下出现
「永远登录不上」的错配。
