# Agent Note: Adopt the fsd-react agent-engineering structure

Status: implemented

[English](2026-11-16-agent-engineering-restructure.md) | 中文

## Problem

这个仓库有 145 个 Markdown 文档、38 条编号 ADR、四份冻结的执行规格、三份交接文档，而没有任何机器检查它们彼此是否自洽。症状是可量化的：

- **47 个文档不可达。** `docs/README.md` 是唯一的导航页，而 `AGENTS.md` 和 `README.md` 都不链它，所以整个 `docs/` 树只能靠知道路径才能走到。
- **导航页是陈旧的。** 它说决策索引到 D32，实际到 D38；说外部评审只有一份，实际有四份；把一个已交付的方案写成「进行中」。
- **决策索引到了容量死线。** `docs/decisions.md` 49803 字节，对 50 KiB 红线是 97.3% 满，再写一条决策就失败。
- **归档封存可以被绕过。** 它拿工作区文件比工作区清单，所以同时改封存文件和它的哈希能通过。
- **四个死链一直绿着。** `docs/conventions.md` 从 `docs/specs/` 里链 `./decisions.md`，那个路径解析不到。
- **30 个中文文档全部没有语言切换链接**，也没有任何东西比较两侧结构，所以翻译可以静默丢掉一个代码块。
- **技能完全没有门禁。** 三个 `SKILL.md` 从没被任何东西解析过；其中一个的 `description` 带未加引号的冒号，YAML 消费者会拒绝它。
- **`check-live-entries.mjs` 是孤儿。** 它不在任何 npm script 和 CI 步骤里，所以没人跑它。

`fsd-react` 用另一套结构解决了同一类问题：事实分类、四生命周期笔记树、带负例自测的门禁注册表、可达性和双语门禁、要求决策笔记的 PR 检查。这条笔记记录在这里采纳那套结构，以及照抄会错的地方。

## Decision

采纳 fsd-react 的 Agent 工程结构，适配一个带大量历史语料的后端插件。

**事实分类。** `AGENTS.md` 现在带一张表，为每类事实指定唯一的家：理由在 `.agents/notes/`，当前状态在 `docs/`，常驻约定在 `docs/conventions.md`，工作令不进 git。这张表是让其余结构可读的东西；没有它，新文档没有显然的家，树就靠堆积生长。

**笔记树。** 38 条编号 ADR 迁进 `.agents/notes/{implemented,archived}/{class}/`，作为三件套（英文、中文、sidecar）。每条笔记保留 `Legacy ID: D<n>` 行，所以 875 处已有的 `D<n>` 引用（其中 141 处在 `src/` 注释里）仍然能解析。`docs/decisions.md` 变成静态兼容表，7619 字节，新决策不再编号。

**文档拆分。** `docs/conventions.md`（2874 词，六个不相关的主题）拆成 `docs/conventions.md`（命令、门禁、CI、发版）、`docs/architecture.md`（源码树和分层规则）和 `docs/security.md`（否定式保证）。安全页是唯一没有 fsd-react 对应物的新增，而且它是前置条件不是锦上添花：失败即关闭、受信反代、签名挑战 cookie 这些规则只写在冻结的 `impl-mN` 规格里，所以不先提取不变量就把那些规格降为历史，会让安全契约失去当前的家。

**历史区。** 46 个文档迁进 `docs/history/{specs,handoff,plans,reviews,evidence}/`，冻结并封存。它们是证据不是指令：`AGENTS.md` 不要求读它们，双语和文风门禁跳过它们，因为重译一份冻结记录等于编辑那份记录。

**门禁注册表。** `scripts/lib/gate-registry.mjs` 是唯一的门禁清单。`run-gates.mjs` 从它推导 `verify`、pre-commit 和自测的运行，并在清单与 npm script、钩子或 workflow 不一致时拒绝启动。旧 runner 的改动面场景保留：只改文档的变更不该付覆盖率和双份构建的代价。

**门禁。** 可达性和链接检查、文档字数预算、笔记树和它的链接、带 trusted baseline 的归档封存、带结构签名的双语配对、技能 front matter 和链接，以及生成的 `.claude/skills/` 镜像。每个都有 `--self-test`，钉住它存在的意义就是拒绝的负例。

**PR 检查。** `.github/workflows/require-decision-record.yml` 在 PR 改代码、工具或配置时要求一条笔记（或写明豁免）。release-please 的豁免很窄：生成的分支名加上恰好那四个版本文件，所以夹带了变更的 release PR 仍然失败。

## Alternatives considered

**整套照抄 fsd-react。** 拒绝：它是前端模板。它的 FSD slice 指南、设计 token、Stylelint、Betterer 和 SonarQube 技能在这里没有对应物，它的 `docs/` 是五个文件，而这里是 145 个。

**保留编号 ADR 索引，只修它的大小。** 拒绝：索引 97.3% 满且没有机器检查，所以一条决策之内就会再撞红线。从笔记树生成紧凑表同时解决容量和陈旧两个问题。

**增量迁移 ADR（strangler fig）。** 考虑过，用户选择一次性迁移。增量的理由是 36 条笔记需要旧 ADR 没有的 `Consequences` 段，而编造一段等于陈述一个没人记录过的代价。所以迁移保留 `## Why`，只在源文档本来就有 `## Consequences` 时才加；没有的笔记是诚实的，生成的不是。

**保留 `docs/conventions.md` 一个文件，加个预算。** 拒绝：那个文件混了命令、门禁、架构、安全、发版和依赖政策。预算只会封顶它的增长，不会给这些主题任何家，安全不变量仍然埋在冻结规格里。

**立刻把中文文风门禁设为阻断。** 暂时拒绝：规则集已校准，但存量语料有 38 个文档 319 处发现。在结构重构里设为阻断，等于要么重写 38 个文档，要么降低规则。它先以报告形式发布（`npm run zh:prose -- --status`），带登记的 `manualReason`，等语料干净后再成为门禁。

**保留 legacy `docs/decisions/archived/` 的封存，与新封存并存。** 拒绝：内容已迁进笔记树，留着旧目录等于制造第二份权威。归档门禁把缺失的 legacy 目录视为已退役，仍然对半删除的目录失败。

## Consequences

**换来的。** 每个现役文档都从入口可达，每个链接都解析。决策索引从 49803 降到 7619 字节。归档封存现在能抓到「改文件同时改哈希」。丢掉一个代码块的翻译会失败。front matter 不可加载的技能会失败。停止拒绝自己负例的门禁会失败。改代码不带笔记的 PR 会失败。

**花掉的。** 门禁从 15 个变成 20 个，`verify` 现在也跑自测，所以完整本地运行更慢。笔记树是 114 个文件，而 ADR 目录是 76 个，因为每条笔记带一个 sidecar。双语门禁现在要求每个现役配对都有语言切换链接和一致的结构签名，这对每次翻译都是实打实的工作。

**放弃的。** `D<n>` 编号关闭了：新决策由路径识别，不由编号。冻结规格不再是当前行为的权威，所以想知道守卫做什么的读者必须读 `docs/security.md` 和代码，不是 `impl-m1`。历史区的出站链接封存后不再修，所以冻结文档里的链接可能指向已不存在的路径。

**没做的。** 中文文风门禁是报告不是门禁。`agent-notes-heartbeat.yml` 的每周巡检没有采纳：还没有 `proposed/` 笔记时它只会产生噪音。`gen-zh-brief` 和本地 blob pinning 没有采纳：sidecar 记录了确认状态，而简报工具只有在更新一对配对的成本被测量过之后才值得加。

双语门禁的欠债机制有两个已知弱点，暂时都接受：

- **豁免按配对，不按发现。** 在已知漂移清单上的配对豁免所有结构规则，所以那五对里出现新缺陷不会失败。清单不能增长（从 base 起新增的条目失败），也不能停留（配对变干净后条目必须移出），所以暴露面被限制在已经标记待修的五对。按发现豁免需要每条发现一个稳定签名，而 25 条里大部分是「代码块字节不一致」，位置随任何编辑变化。
- **清单从脚本源码里解析。** `readKnownDriftAt` 读 base ref 上的文件，用正则提取 `KNOWN_DRIFT` 数组。改清单的写法会让读取抛错，这是 fail-closed（门禁 exit 2）而不是放过，但清单应该放在脚本旁边的 JSON 文件里。
