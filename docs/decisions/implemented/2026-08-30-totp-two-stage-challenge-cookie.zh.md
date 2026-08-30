# TOTP 两段式登录采用无状态挑战 cookie

## 决定了什么

M4 在 `mode: "password"` 上叠加 TOTP 两段式：密码通过后，对启用 TOTP 的用户发一个
**无状态挑战 cookie**（`dsh_auth_challenge = <username>.<expiresEpochMs>`，TTL 300 秒，
HttpOnly/Secure/SameSite=Lax），随后 GET 渲染验证码页，POST 验证码通过才发正式会话
并同帧清零挑战 cookie。不引入 pending 会话状态，不依赖 storageDomain。

## 背景

M3 已把 `totpSecret` 作为用户记录的可选字段解析（P4），两段式是 M4 的主体。难点在于
「密码已过、验证码未验」这段中间态怎么表达：它必须有短生命周期、必须能防重放、
且实现要尽量薄，不能给单门模型引入新的状态域负担。

## 考虑过的替代方案

- **内存 pending 会话** — 密码通过后往内存 Map 写一条记录，验证码通过后删除。
  被否：多一个状态域、需要过期清理、重启丢失、与 storageDomain 持久化哲学不一致。
- **单页重提交密码 + 验证码** — 挑战表单把 username/password/code 一起再 POST 一次。
  被否：密码在挑战页二次过网络，扩大了明文凭证暴露面。
- **签名挑战令牌** — 用密钥对挑战 cookie 值签名防篡改。
  被否：挑战 cookie 只是「密码阶段通过」的凭证，真正的关卡是验证码；
  无签名不会产生越权面（篡改 username 只影响验证谁的 secret，攻方没有 code）。

## 为什么这样选

无状态挑战 cookie 把中间态压缩成一个短 TTL 的浏览器状态：服务端零存储、重启无感、
与现有 cookie 工具（`parseCookieHeader`/`buildSetCookie`）完全复用；服务端对
`expiresEpochMs` 二次校验让手工重放的旧 cookie 在 300 秒后失效。安全边界仍然落在
TOTP 验证码本身，挑战 cookie 的泄漏不足以完成登录。
