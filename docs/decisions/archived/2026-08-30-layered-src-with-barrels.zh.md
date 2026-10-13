# src 分层 + 跨 slice 只走 barrel（2026-08-30）

## 决定了什么

把平铺的 `src/` 根（21 个入口模块、52 个文件）重构为分层：`gate/` 与 `session/` 为核心机制层，`features/{token,password,proxy}/` 为认证面 slice，`shared/` 为叶子通用层，`client/` 不变。跨 slice import 只能落在目标 slice 的 `index.ts` barrel；feature slice 之间互不 import；`client/` 与 host 半边相互隔离。verify 链新增 `slice:check`、`bundle:check`、`lint:no-emdash`、`build`（移植自 dsh-plugin-framework），重构保持零行为变更（230 测试全绿，`git diff -M` 只见 rename）。

## 背景

`src/` 膨胀到扫一眼看不出系统结构的地步，而 M4（TOTP）在即。dsh-plugin-framework——参考框架，其约定在 dsh 官方代码库中久经考验——规定了 features/shared 分层；它的门禁脚本就是为了让这种布局不腐化而存在的。

## 考虑过的替代方案

- **完整 FSD（entities/pages/widgets/ui 树）**——拒绝：auth-gate 是服务端插件，client 只有 3 个文件；框架式 client/ui 树在这里是过度设计（见「参考，不照搬」原则）。
- **保持平铺，以后再说**——拒绝：在 M4 前做比事后把 TOTP 从平铺根里搬出来成本低。
- **session 作为 feature slice**——执行中被拒：边界检查逮住了 token/password → session 的引用边；session 被两个认证面共同消费，降为核心机制层与 `gate/` 并列。
- **轻量 ADR 制度（单语、无门禁脚本）**——拒绝：官方制度（上万 commit 血统）表明习惯未形成时机器约束最需要。

## 为什么这样选

层必须匹配依赖图：shared 是叶子，session 在两个认证面之下，features 彼此独立。机器检查（slice 边界、bundle 契约、no-emdash）防止静默漂移；扩展后的 verify 链把 lib 漂移门禁从「CI 事后发现」前移到「本地 verify 拦截」。`login-page` 被两种 mode 共用，因此归 `shared/` 而非任一 feature。
