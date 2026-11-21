# docs/history - 冻结的历史区

[English](README.md) | 中文

**这个区不是当前权威。** 它保存的是写下来时为真、现在只作证据不作指令的文档。

这里没有任何东西是任务的必读前置。`AGENTS.md` 和 skill 不得把这个树写成前置条件。历史文档与当前代码冲突时，以代码为准。

## 这里有什么

| 目录 | 内容 | 为什么留着 |
| --- | --- | --- |
| [`specs/`](specs/) | M1-M4 的执行规格（`impl-m1` 到 `impl-m4`）、原始路线图（`dsh-auth-plan`）、D30 之前的重构方案，以及已交付的修复计划（`totp-fix-plan`、`login-page-polish-plan`、`impl-client-logout`、`impl-launch-token-bridge`、`impl-m2-admin`） | 它们记录每个里程碑被要求交付什么、冻结了哪些契约。追溯某个行为为什么存在的人可能需要；改那个行为的人不需要。 |
| [`handoff/`](handoff/) | 每阶段的 session 交接（`handoff-m2`、`m3`、`m4`） | 它们记录每个里程碑所在机器的环境事实和踩坑。耐久的部分已提取进 `docs/deployed/`；其余是快照。 |
| [`plans/`](plans/) | 通行密钥可行性方案和 PR #53 移植方案 | 两者都已交付或已关闭。它们产生的决定现在是 Agent Note。 |
| [`reviews/`](reviews/) | 外部评审原文（Grok 4.6、Kimi K3.1） | 它们是修复背后的证据。评审不是决定；决定是它产生的笔记。 |
| [`evidence/`](evidence/) | 版本化的入口覆盖报告（`entry-coverage-0.1.5-rc.2`、`0.2.0-rc.2`、`0.2.2-rc.1`） | 每份记录某个具体版本上每个受守卫入口都被探测并拒绝。 |

## 索引

这里每个文件，所以整棵树都能从本页走到。

### specs

- [dsh-auth-plan](specs/dsh-auth-plan.md) - 原始路线图和威胁模型（M0-M6）
- [impl-m1](specs/impl-m1.md) - 守卫、包装缝、会话存储
- [impl-m2](specs/impl-m2.md) - 共享 token 门
- [impl-m2-admin](specs/impl-m2-admin.md) - 管理面切片
- [impl-m3](specs/impl-m3.md) - 口令流程
- [impl-m4](specs/impl-m4.md) - TOTP
- [impl-client-logout](specs/impl-client-logout.md) - client 退出动作
- [impl-launch-token-bridge](specs/impl-launch-token-bridge.md) - 0.1.2-alpha 兼容层
- [login-page-polish-plan](specs/login-page-polish-plan.md) - 已交付的视觉基线
- [totp-fix-plan](specs/totp-fix-plan.md) - 0.11.1 加固计划（中文）
- [totp-fix-plan.en](specs/totp-fix-plan.en.md) - 同一份计划的英文侧
- [src-refactor-plan](specs/src-refactor-plan.md) - D30 之前的分层重构

### handoff

- [handoff-m2](handoff/handoff-m2.md) - 环境事实和 M1 踩坑
- [handoff-m3](handoff/handoff-m3.md) - M3 的 session 交接
- [handoff-m4](handoff/handoff-m4.md) - M4 的 session 交接，含 0.11.1 修订

### plans

- [passkey-login-plan](plans/passkey-login-plan.md) - 通行密钥可行性研究（作为 M6 交付）
- [pr53-login-page-fix-plan](plans/pr53-login-page-fix-plan.md) - PR #53 移植方案（已关闭）

### reviews

- [grok46-dsh-020-host-corridor-review](reviews/grok46-dsh-020-host-corridor-review.md)
- [grok46-launch-token-bridge-review](reviews/grok46-launch-token-bridge-review.md)
- [grok46-d21-token-failure-card-review](reviews/grok46-d21-token-failure-card-review.md)
- [kimi-k3.1-passkey-review](reviews/kimi-k3.1-passkey-review.md)
- [claude-code-0.23-full-repo-review](reviews/claude-code-0.23-full-repo-review.md) - 四个 Claude Code agent 评审 0.23：守卫、认证流程、客户端、工程体系（11 条 P1，无 P0）

### evidence

- [entry-coverage-0.1.5-rc.2](evidence/entry-coverage-0.1.5-rc.2.md)
- [entry-coverage-0.2.0-rc.2](evidence/entry-coverage-0.2.0-rc.2.md)
- [entry-coverage-0.2.2-rc.1](evidence/entry-coverage-0.2.2-rc.1.md)

## 规则

- **冻结。** 这里的文档不为了匹配当前行为而编辑。行为变了，改的是当前文档；这一份留作「当时为真」的记录。
- **不受双语门禁约束。** 这些文档保持它们原有的语言配对。不重译、不补 sidecar、不重排格式。
- **出站链接不修。** 历史文档可能链到已不存在的路径。修它等于编辑一份冻结记录。从当前文档**指向**这个树的链接会被检查。
- **封存。** `manifest.json` 记录这里每个文件的 SHA-256。清单只允许追加，CI 与 PR base 比对，所以同时改历史文件和它的哈希仍然失败。

## 某个事实的当前版本在哪

| 你要找 | 改读 |
| --- | --- |
| 源码怎么组织 | [`../architecture.md`](../architecture.md) |
| 插件永远不能做什么 | [`../security.md`](../security.md) |
| 命令、门禁、发版 | [`../conventions.md`](../conventions.md) |
| 某个决定为什么这样定 | [`.agents/notes/`](../../.agents/notes/) |
| 怎么部署或排障 | [`../deployed/`](../deployed/) |
