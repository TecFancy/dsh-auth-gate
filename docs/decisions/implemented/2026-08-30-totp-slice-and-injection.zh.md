# TOTP 独立 slice，能力经根装配注入 password

## 决定了什么

TOTP 实现落在新 slice `src/features/totp/`（`totp.ts` 算法 / `replay-guard.ts` 防重放 /
`cli.ts` 命令 / barrel），与 token、password、proxy 并列；password 端点**不 import**
totp 切片（features 同层互禁），而是通过 `index.ts`（根装配层）把 `verifyTotp` /
`replayCheck` / clock 作为 deps 注入 `PasswordLoginDeps`。

## 背景

分层约定（D5）禁止 features 内部互引，即使经由 barrel。但 TOTP 两段式天然是 password
流的延伸（挑战 cookie 的颁发在 `password-login.ts`、提交路径也在同一端点）。
需要在不打破同层互禁的前提下把两段式织进密码流。

## 考虑过的替代方案

- **TOTP 放 `shared/` 叶子层** — password 经 shared barrel 拿到 TOTP 能力。
  被否：TOTP 是认证面的业务能力而非通用件（shared 里是 next 校验/cookie/表单这类
  无状态工具）；日后若加 HOTP 或其他 feature 会膨胀 shared。
- **password 直接 import features/totp** — 被机器门禁拒绝（D5 的 slice:check）。
- **把两段式全部写进 password slice** — 算法 + 防重放 + CLI 全塞进 password，
  文件行数爆表（P24 行预算）且职责混杂。

## 为什么这样选

独立 slice 保持「一个 feature 一块地」的依赖图清晰度，slice:check 自动守护；
deps 注入复用 M3 已有的注入模式（`verify: verifyPassword` 就是 index.ts 注入的），
没有发明新机制。password 端点侧只看到三个函数签名（verifyTotp/replayCheck/now），
可测试性也更好（测试注入 fake 实现，与生产 `verifyTotpCode` 解耦）。
