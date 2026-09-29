# Grok 4.6 评审 — dsh 0.2 宿主走廊（peer/engines + dev cohort + 证据文档）

- **日期**：2026-09-29
- **评审者**：grok-4.6（xAI 订阅通道，`high` 档），两个并行 agent——一个正确性评审、一个对抗性核验，
  都有工具权限（仓库只读 + 对隔离实例只读探测）
- **范围**：`fix/dsh-0.2-host-corridor` 工作区相对 `origin/development`（`4402caa`）
- **结论**：approve-with-notes（正确性 agent）／「不要把**这份产物**当 `0.15.0` 发」（对抗 agent）——
  走廊改动本身没有被推翻
- **标准**：仓库 `AGENTS.md`、D12（宿主需求声明）、D26（本次变更）、`scripts/check-live-entries.mjs`

## 摘要

两个 agent 都确认了核心主张：dsh `0.2.0-rc.2` 的插件闸门只读 `@deepseek-ai/dsh*` peer
（判定带 `includePrerelease: true`），所以给 storage-domain peer 追加 `^0.2.0-rc.1` 即可过闸，
而 `^0.1.x` 那几个替代项保住生产线。他们还用宿主自己的 `evaluatePluginCompatibility` 复核了机制，
并直接探测了隔离实例。

这次评审真正的价值在于它拒绝"照单全收"：两处文档互相打架、入口覆盖脚本其实从未断言过它声称覆盖的
浏览器导航分支、走廊测试是子串包含而不是 semver 判定、以及隔离证据来自工作区构建（带着未发布的 P2
改动、版本串仍是 `0.15.0`）而不是 npm 上已发布的 `0.15.0`。以上都已在本分支修掉；版本串那条属于
发版流程约束，处理办法记录在下面。

## Findings

| ID  | 严重度  | 标题                                                            |
| --- | ------- | --------------------------------------------------------------- |
| F1  | major   | README 与 D26 对"生产宿主版本"的说法互相矛盾                    |
| F2  | minor   | `docs/specs/development` 仍把 storage-domain 钉在 `^0.1.0-rc.6` |
| F3  | minor   | 升级清单仍只指向 0.1.5 的入口覆盖记录                           |
| F4  | minor   | 走廊测试用字符串包含，没有用 `semver.satisfies`                 |
| F5  | nit     | `docs/README.md` 仍写「D1–D25」                                 |
| F6  | nit     | README 对闸门的描述说过头                                       |
| F7  | nit     | 入口覆盖记录声称了一个探针从未产生过的 302                      |
| F8  | minor   | 67/67 用"非 2xx 即通过"判定，500 或被摘掉的门也能过             |
| F9  | minor   | 公开端点未认证返回 200，而记录写的是"没有任何 2xx"              |
| F10 | major\* | 版本串 `0.15.0` 无法标识被评审的产物                            |

\* F10 是发版流程问题，不是代码缺陷；处置见下。

### F1 — major — 生产版本自相矛盾

**位置**：`README.md` / `README.zh.md`（环境要求）对照
`docs/decisions/implemented/2026-09-29-dsh-020-host-corridor.{en,zh}.md` 与 `docs/decisions.md` D26。

**问题**：README 说生产是 `0.1.5-rc.2`，D26 说 `0.1.7-rc.2`。两处都是本次改动碰过的，必有一处错：
生产在 2026-09-25 已升到 `0.1.7-rc.2`（`notes/tech/dsh-ops/27-upgrade-runbook-017rc2.md`），
README 那行是升级前留下的。

**修法**：README 现在写「`0.1.5-rc.2` 与 `0.1.7-rc.2`（生产，按此顺序），以及 `0.1.7-alpha.1`、
`0.2.0-rc.2`（隔离实例）」；D26 保持 `0.1.7-rc.2`。

### F2 — minor — 依赖纪律过时

**位置**：`docs/specs/development.md:247`、`docs/specs/development_zh.md:222`。

**问题**：现行的工程文档仍在教人把 `@deepseek-ai/dsh-storage-domain` 钉在 `^0.1.0-rc.6`，
与本次引入的 peer/dev 范围互相矛盾。

**修法**：两语版本都改成现行规则——peer 与 `engines.dsh` 用同一条走廊串，dev/测试宿主 cohort 跟随
走廊下界（`^0.2.0-rc.1`）；并注明 `impl-m1` §3 的那条钉法是冻结历史，不是现行纪律。

### F3 — minor — 升级清单指向旧记录

**位置**：`docs/deployed/deployment.md` §5 第 3 步、`docs/deployed/deployment_zh.md`（同一步）、
`docs/README.md` 阅读路径。

**问题**：「最近一次已验证运行」只引用 `0.1.5-rc.2` 那份记录，阅读路径也只指向它的 §5。

**修法**：两处都同时列出 `0.1.5-rc.2` 与 `0.2.0-rc.2` 两次运行，并把导航探针必须带
`Sec-Fetch-Mode` 这件事写进步骤。

### F4 — minor — 走廊测试太弱

**位置**：`src/shared/host-corridor.test.ts`。

**问题**：`toContain("^0.2.0-rc.1")` 连 `^0.2.0-rc.10` 都会放行，且没有任何断言覆盖闸门真正的判定语义
（`includePrerelease` 满足性）。

**修法**：测试现在钉住**确切的走廊串**，用 `semver.satisfies` 加闸门同款参数跑遍我们声称支持的宿主线
（`0.1.5-rc.2`、`0.1.7-alpha.1`、`0.1.7-rc.2`、`0.2.0-rc.2`、`0.2.0`、`0.2.1`），断言
`0.1.0-rc.5`、`0.3.0`、`0.3.0-rc.1` 不满足，并断言 `@deepseek-ai/dsh*` peer 恰好只有一条。
`semver` + `@types/semver` 进 devDependencies，这样测试量的是宿主真正用的那个判定。

### F5/F6/F7/F9 — nit — 措辞与记录准确性

**修法**：`docs/README.md` 改为 D1–D26；README 把闸门描述改为「`0.2.0-rc.2`（已在 `next` 线上）会拒绝
安装、并在启动时静默跳过……这条判定只读 peer，不读 `engines.dsh`，而完全没有这类 peer 的插件根本不会
被检查」；入口覆盖记录改为「没有任何**受守卫**入口在无凭证时返回 2xx」，并把公开端点
（`/auth/login`、`/auth/status` 按设计 200，`/manifest.webmanifest` 依 D13）单列一组。

### F8 — minor — 探针判定可能放过坏掉的门

**问题**：通用规则是「任何非 2xx 即通过」，所以 500、或非导航探测下直接返回 200 的 SPA 都能过；
而浏览器导航那一行只发 `Accept: text/html`，在 fail-closed 的 `Sec-Fetch-*` 判定下拿到 401，
又被同一条通用规则判成 PASS——302 分支写在文档里，却从未被断言。

**修法**：`scripts/check-live-entries.mjs` 增加 `extraHeaders` 参数与 `navigation` 判定类型：该行现在会发
`Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document`，并按**确切结果** `302 -> /auth/login` 判定。
对隔离 `0.2.0-rc.2` 实例重跑：`67/67 PASS, 0 FAIL`，该行显示 `302 → /auth/login?next=%2F`。
「500 算 PASS」这半条**按原样接受**：工具契约是「无凭证不可达」，把 5xx 判成失败会把"宿主坏了"和
"入口没守"混为一谈；运行输出逐行打印状态码，5xx 对运维是可见的。

### F10 — major — 版本串无法标识产物

**问题**：工作区、打包 tarball、隔离安装三处都写 `0.15.0`，但它们带着未发布的 P2 内容；npm 上的
`dsh-auth-gate@0.15.0`（gitHead `4f362a7`）是另一个产物，peer 范围也没加宽。

**处置（接受，并立规矩）**：版本由 release-please 掌管（仓库 `AGENTS.md`），所以本分支不许手改
`version`。由此产生三条约束，记录在此与 D26：

1. 隔离证据一律标注为「本分支的工作区构建」，绝不写成「0.15.0 已在 0.2.0 上验证」；
2. 带上这条走廊的发布必须是一个新版本号（由 release-please 决定）；
3. **先插件、后宿主**：在带加宽 peer 的插件版本发布之前，生产不得先把 dsh 升到 `0.2.x`——否则闸门会
   跳过 bundle，登录门消失（fail-open）。

## 第二轮——修复验证

第二个 grok-4.6 agent 带着 F1–F10 清单复核本分支，并被明确要求**证伪**这些修复而不是采信。当时判定：
**NEEDS-WORK**——走廊改动本身站得住（重新推导了 semver 矩阵、用宿主自己的 `evaluatePluginCompatibility`
复跑、重跑了真实探测），但还剩四处文档缺陷，其中三处是修第一轮时带进来的。四处均已在分支内修掉：

| 项  | 问题                                                                                                       | 修法                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | F10 的三条发版约束只写在评审里，D26 正文没有，而处置表却声称"记录在此与 D26"                               | D26（中英）`为什么这样选` 末尾现在写了三条有约束力的规矩：隔离证据描述的是工作区构建；走廊随新版本出海；**先插件、后宿主**。`docs/deployed/deployment.md` §5 与中文版补上对应的「先插件、后宿主」步骤 |
| R2  | D26 内部测试数字打架（证据条 964、`为什么` 与 `docs/decisions.md` 写 962），且 CI 取舍段只有中文有         | 数字统一为 111 文件 / 968 例（`npm run verify` 的实际值）；英文记录补上取舍段                                                                                                                         |
| R3  | 0.2.0 覆盖记录声称 `/manifest.webmanifest` 属于公开探测组，但工具的 `SUPPLEMENTS` 与逐字输出里都没有这一行 | 该路径加回 `SUPPLEMENTS` 的 `group: "public"`（期望 200，依据 D13），重跑探测并重新生成中英记录：公开组 5 行，`/manifest.webmanifest` 200 PASS，受守卫行仍是 67/67                                    |
| R4  | `deployment.md` §5 仍写"任一入口答 2xx 就失败"，与公开端点设计相矛盾                                       | 中英均改为"任一**受守卫**入口"；公开组单列判定                                                                                                                                                        |

第二轮还给出了 F4 的变异证据：在走廊测试就位的前提下，三种 `package.json` 变异都会让它变红
（只改 peer → `^0.2.0-rc.10`、只改 engines、两处都改成 `^0.2.0-rc.10`——后者
`semver.satisfies("0.2.0-rc.2", ...)` 为 false，而旧的子串检查会放行），未变异的基线 6/6 绿。
