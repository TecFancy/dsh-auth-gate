# docs — 文档导航

dsh-auth-gate 的文档按**生命周期**分层组织（2026-08-30 整理）：

| 目录                                                        | 内容                                                                                                                                                                                                          | 阅读时机                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| [`deployed/`](deployed/)                                    | 部署运维：deployment（验收清单 A–I、升级 5.1）、reverse-proxy（反代部署）、local-proxy（配置面本地代理）                                                                                                      | 部署 / 排障 / 升级时      |
| [`specs/`](specs/)                                          | 路线图与工程：dsh-auth-plan（M0–M5 分期 + 威胁模型）、development（命令/门禁/约定/release）、src-refactor-plan（分层 src）                                                                                    | 接下阶段任务、改代码前    |
| [`handoff/`](handoff/)                                      | 执行交接（每阶段新 session 必读）：handoff-m2 / m3 / m4（m4 含 0.11.1 修订）                                                                                                                                  | 新 session 执行对应规格前 |
| [`implemented/`](implemented/)                              | 已交付规格与规划：impl-m1~m4（当前实现基准，m4 最新）、impl-launch-token-bridge（0.1.2-alpha 兼容层）、impl-client-logout、login-page-polish-plan（已落地视觉基线）、totp-fix-plan（0.11.1 修复计划，已实施） | 核对「当前行为依据」时    |
| [`plans/`](plans/)                                          | 进行中规划：pr53-login-page-fix-plan（#53 移植）                                                                                                                                                              | #53 落地时                |
| [`decisions.md`](decisions.md) + [`decisions/`](decisions/) | 重大决策编号索引 D1–D10（双语记录，proposed / implemented / archived）                                                                                                                                        | 理解「为什么」时          |
| [`demo/`](demo/)                                            | README 效果图（登录页 / TOTP 验证码页 / 实例）                                                                                                                                                                | README 引用               |
| [`reviews/`](reviews/)                                      | 外部评审记录（grok-4.6 launch-token bridge review 等）                                                                                                                                                        | 变更合入前对照            |

## 阅读路径

- **部署/运维**：`deployed/deployment.md`（首次部署走 §0–§4 验收；升级走 §5 + §5.1）→ `deployed/reverse-proxy.md` → `deployed/local-proxy.md`
- **新功能开发（新 session）**：`AGENTS.md` → `implemented/impl-mN.md`（对应阶段规格）→ `handoff/handoff-mN.md`（环境事实与踩坑）→ 落地后补 `docs` 与 ADR
- **当前实现基准**：`implemented/impl-m4.md`（含 0.11.1 修订注记块；正文为历史 M4 契约，注记优先）
- **决策溯源**：`decisions.md` 索引 → 具体 ADR（zh/en 成对）

## 文档规范（doc governance，`npm run docs:check` 强制执行）

1. **双语成对**：除 decisions/ 用官方 `<date>-<slug>.en|zh.md` 外，一律
   `<name>.md`（英文正文）+ `<name>_zh.md`（中文正文）成对。单语豁免仅限
   `README.md`（导航）、`decisions.md`（索引）、`demo/`、`design/`。
2. **命名历史例外**：`totp-fix-plan.md` 是中文、`totp-fix-plan.en.md` 是英文
   （反转），冻结不再新增此类。
3. **模板**：新建文档从模板起步 —— `implemented/_template(_zh).md`（实施规格）、
   `reviews/_template(_zh).md`（评审记录）、`handoff/_template(_zh).md`（交接）、
   `decisions/_template.(en|zh).md`（ADR）。
4. **大小红线**：单文件 ≤ 50 KiB；超限必须切片（骨架 + `references/`）。冻结中的
   frozen spec（impl-m3、totp-fix-plan）在豁免清单里，下次大 revision 时再分，
   不许继续膨胀。
5. 新文档无法满足 1/2/4 时先改这里的规则再提交，不让 `docs:check` 静默变红。
