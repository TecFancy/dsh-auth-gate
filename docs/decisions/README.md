# 决策记录

这是对齐 dsh-plugin-framework（参考框架）决策记录制度的落地版本：三个状态目录 + 双语（`.zh.md`/`.en.md`）成对记录。双语与格式脚本是刻意保留的完整性要求，不是可选简化——官方一万次 commit 的实践结论是「习惯未形成时，机器约束更需要」（framework 的 `decision-record-lifecycle` ADR 记载了当天推翻轻量版的过程）。

## 状态

每条记录的状态由它所在的文件夹表达，不写在文件内容里：

- `proposed/` — 提出但还没落地的决定（允许单语）。
- `implemented/` — 已经落地，正文用现在时描述「决定了什么」。
- `archived/` — 已冻结的历史记录。

状态变化是移动文件（改路径），不是编辑内容里的某个字段。

## 什么时候该写一条

不是每次改动都要写。只有当一个决定：

- 有至少一个被认真考虑过、又放弃的替代方案，或
- 三个月后如果没有这条记录，后来的人（人或 AI）会重新犯一遍已经想清楚的错

才值得写。日常的、显而易见的改动不需要。

## 什么时候该归档

**不靠字数，不靠时间。** 唯一的判据是：_未来的人还需不需要靠它来做决定_。短的可能该留，长的可能该归档——判断时问自己：「如果这条记录消失，未来会有人因此做错决定吗？」

## 归档 = 冻结

一旦移进 `archived/`：不再编辑正文（哪怕笔误）、不再修复失效链接、只能被新记录引用为「当时的决定」。内容已不适用时，写一条新记录说明现状并链接回被取代的那条，而不是回去改旧记录。

## 命名与双语

`{状态文件夹}/YYYY-MM-DD-简短主题.{zh|en}.md`。`implemented/` 和 `archived/` 下的每条记录必须同时有 `.zh.md` 和 `.en.md`；`proposed/` 阶段允许单语，落地前补齐。

## 强制执行

不靠自觉，靠脚本：`scripts/verify-decision-records.mjs` 检查文件名格式、必需章节、双语配对、归档哈希冻结（`.manifest.json` 只允许追加）。已接入：

- `npm run decisions:check` — 独立运行
- `npm run verify` — 完整门禁链的一环
- CI（`.github/workflows/ci.yml`）— hygiene job 的一步

新归档一条记录后运行 `node scripts/verify-decision-records.mjs --update-manifest` 登记哈希，之后改动该文件即检查失败。

## 模板

新建记录时复制 [`_template.zh.md`](./_template.zh.md) 和 [`_template.en.md`](./_template.en.md)。索引页：`docs/decisions.md`。
