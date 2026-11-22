# docs - 文档导航

[English](README.md) | 中文

这个仓库的文档按**事实种类**分目录，不按时间。每类事实只有一个家，规则见
[`AGENTS.md`](../AGENTS.md) 的「Where each kind of fact lives」。

## 现役文档

| 路径 | 内容 | 什么时候读 |
| --- | --- | --- |
| [`architecture.md`](architecture_zh.md) | 源码树的形状和分层规则：host/client 两个半边、FSD 层、`src/protocol/` 跨半边契约、两道分层门禁 | 加 slice、在层之间移动文件、写路由字面量之前 |
| [`security.md`](security_zh.md) | 插件永远不能破坏的否定式保证：失败即关闭、包装不 fork、每个入口都被守卫、跨站弹回、受信反代、会话撤销、通行密钥登录与 passkey-only、启动 token 的首次引导窗口、放行后重铸、签名挑战 cookie、scrypt、示例域名、构建一致性，以及刻意不防的东西 | 改守卫、门、会话、登录页之前 |
| [`conventions.md`](conventions_zh.md) | 常驻约定：命令、钩子、门禁、代码风格、提交信息、CI、发版、分支卫生、依赖政策 | 每个会话 |
| [`deployed/`](deployed/) | 部署运维：[deployment](deployed/deployment_zh.md)（验收清单 A-J、备份、升级）、[reverse-proxy](deployed/reverse-proxy_zh.md)（反代部署）、[local-proxy](deployed/local-proxy_zh.md)（配置面本地代理）、[known-limitations](deployed/known-limitations_zh.md)（README 短清单的完整版） | 部署、排障、升级 |
| [`decisions.md`](decisions_zh.md) | D1-D40 的**兼容表**，不是活索引。决策本身在 [`.agents/notes/`](../.agents/notes/) | 代码注释引用了 `D<n>` 时 |
| [`demo/`](demo/) | README 效果图（登录页、TOTP 验证码页、账号安全页、通行密钥区块；统一英文界面 + 浅色主题） | README 引用 |
| [`design/`](design/) | 设计稿导出（HTML + 上传的图片） | 视觉基线对照 |
| [`i18n/`](i18n/) | [术语表](i18n/terminology.md)和[中文写作规则](i18n/prose-rules.md) | 写或改中文文档时 |

## 历史文档

[`history/`](history/) 是**冻结的历史区**，不是当前权威。它保存 M1-M4 的执行规格、每阶段的交接文档、已交付或已失去执行效力的旧方案、外部评审原文和版本化的入口覆盖证据。

历史区可以被引用为证据，但不能被 `AGENTS.md` 或 skill 写成每个任务的必读前置。当前行为以代码、测试、`architecture.md`、`security.md` 和 `deployed/` 为准。

## 阅读路径

- **新 session 接手一个任务**：`AGENTS.md` → `docs/architecture.md`（结构）→ `docs/security.md`（不能破坏什么）→ `docs/conventions.md`（命令和门禁）→ 相关 Agent Note（为什么）
- **部署/运维**：`deployed/deployment.md`（首次部署走 §0-§4 验收；升级走 §5 + §5.1）→ `deployed/reverse-proxy.md` → `deployed/local-proxy.md`
- **理解某个决定为什么这样定**：`docs/decisions.md` 查编号 → 打开对应 Agent Note
- **改代码**：`docs/conventions.md` 的「Commands」（`verify` 与 `gates` 两行）→ 相关 slice 的测试

## 文档规范

由 `npm run docs:check` 强制执行：

1. **可达性**：每个现役文档必须从 `AGENTS.md` 或本页沿相对链接走到。孤儿文档失败。
2. **链接可解析**：相对链接和 `#fragment` 必须指向存在的文件和标题。
3. **双语成对**：除豁免外，`<name>.md`（英文）+ `<name>_zh.md`（中文）成对。豁免：本页、`decisions.md`、`demo/`、`design/`、`history/`、`.agents/skills/`、`AGENTS.md`、`CLAUDE.md`。
4. **大小红线**：单文件 ≤ 50 KiB，超限必须切片（骨架 + `references/`）。
5. **禁止重复标题**：同一文件内同一个 H2/H3/H4 标题不得出现两次。
6. **字数预算**：`AGENTS.md` 和 `conventions.md` 受 `scripts/doc-budgets.json` 约束，只增不减的常驻文档会被拦下。

新文档无法满足 1-6 时先改这里的规则再提交，不让 `docs:check` 静默变红。
