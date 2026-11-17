# 常驻约定

[English](conventions.md)

常驻规则：命令、钩子、门禁、代码风格、提交信息、CI 和发版。每个 agent 和每个贡献者都按这份文件工作。

源码树和它的分层规则见 [architecture_zh.md](architecture_zh.md)。插件永远不能破坏的否定式保证见 [security_zh.md](security_zh.md)。某个决定为什么这样定，看它链接的 Agent Note。

## 命令

| 任务 | 命令 |
| --- | --- |
| 类型检查 | `npm run type-check`（`tsc -p tsconfig.json --noEmit`） |
| Lint | `npm run lint`（flat ESLint，带类型检查） |
| FSD 分层 | `npm run lint:fsd`（Steiger 跑 `src/host` 和 `src/client`；层序、同层隔离、公共 API、命名） |
| 格式化 | `npm run format` / `npm run format:check` |
| 测试 | `npm run test`（Vitest，`vitest run`） |
| 监听测试 | `npm run test:watch` |
| 覆盖率 | `npm run test:coverage`（v8，分支/函数/行/语句 80%） |
| 构建 | `npm run build`（先清空 `lib/`，再 tsc emit + client bundle；LF 换行，声明文件 + source map） |
| 场景门禁 | `npm run gates`（自动检测改动面；pre-push 跑这个） |
| 完整门禁 | `npm run verify`（门禁 runner 跑每个登记的门禁，加上门禁自测；完整集合是 CI 的事，不是每次本地跑） |
| 宿主契约 | `npm run host:check`（先自测，再查：包名 = Loader 行 = client 注册 id = 宿主 `name`；manifest 目标存在；client 的 `require` 是宿主播种的模块；`src/protocol/` 外无路由字面量，每个协议路径都被注册，README 里的路由存在） |
| 文档门禁 | `npm run docs:check`（从入口可达、相对链接与 fragment、大小红线、重复 H2-H4 标题） |
| 市场截图 | `npm run screenshots:check`（根 `screenshots.json`：1-8 张位图，相对路径在仓库内，每个文件存在；市场卡片读这个列表，不读 README） |
| 文档预算 | `npm run docs:budgets`（`AGENTS.md` 和 `docs/conventions.md` 不超过 `scripts/doc-budgets.json` 里的词数上限） |
| 笔记门禁 | `npm run notes:check`（`.agents/notes/` 树形、`Status:` 与 lifecycle 目录一致、正文骨架） |
| 笔记链接 | `npm run notes:links`（笔记树里的相对链接可解析、不逃出仓库、locale 匹配） |
| 归档封存 | `npm run archives:check`（每个封存件与它的 SHA-256 一致；清单只允许追加，CI 里与 PR base 比对） |
| 双语门禁 | `npm run bilingual:check`（配对、sidecar 哈希、语言切换链接、标题结构、结构签名） |
| 中文文风 | `npm run zh:prose`（全角标点、「」引号、中英混排空格、术语表禁止的译法） |
| 技能 | `npm run skills:check` / `skills:frontmatter` / `skills:links`（生成的镜像、消费者解析的 front matter、技能内的链接） |
| 门禁 runner | `npm run gates:check`（每个登记的门禁）/ `npm run gates:self-test`（这些门禁存在的意义就是拒绝的负例） |

跑单个测试文件：`npm run test -- src/host/shared/guard/guard.test.ts`
按名字跑测试：`npm run test -- -t "guard"`

## Git 钩子

- `pre-commit`：lint-staged（对暂存文件跑 Prettier + `eslint --fix`），然后跑 `node scripts/run-gates.mjs --stage pre-commit`。
- `commit-msg`：commitlint，Conventional Commits，固定类型集（`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`）。
- `pre-push`：`npm run gates -- --base @{u}`，按改动面（未推送提交 + 未提交改动）选最小证据集；完整覆盖是 CI 的事。

## 提交进仓库的构建产物

`lib/` 由 `npm run build` 生成（`scripts/clean-lib.mjs` 先清空，然后 `tsc -p tsconfig.build.json`、`tsdown`、`tsc -p tsconfig.client.build.json`），并且**提交进仓库**，从不手改，所以它就是构建输出本身，没有孤儿文件：

- 从 git 安装这个包的消费者（`dsh plugin add <git-url>`）拿到一个不需要构建工具就能用的包；
- `npm pack`/`npm publish` 发布完全相同的树（`prepack` 会先重建）；
- CI 校验一致性：全新构建后 `git diff --exit-code -- lib`，有人提交了过期的产物就失败。

`tsconfig.build.json` 固定 `newLine: "lf"`，让产物在 Windows/Linux 构建器之间字节稳定。

## 约定

- **TypeScript 最严预设**：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`noUnusedLocals/Parameters`。NodeNext 模块解析：相对 import 以 `.js` 结尾。
- **测试里不用环境全局**：从 `vitest` import `describe/it/expect`。
- **`src/` 里不用 `console.*`**（ESLint error）。通过 cordis 的 `ctx.logger` 记日志；脚本和配置文件豁免。
- **复杂度/长度上限**（ESLint error，不做基线豁免）：复杂度 ≤ 15，文件 ≤ 250 行，函数 ≤ 80 行（空行和注释行不计）。超了就拆。
- **`.sort()`/`.toSorted()` 必须给显式比较器**，默认的字典序在纯 ASCII 之外不可靠。
- **换行一律 LF**（`.editorconfig` + `.gitattributes`），Prettier 默认：100 列、双引号、尾逗号。
- **示例域名**：真实部署域名永不进仓库。文档、部署样例、测试、代码默认值和截图一律用 RFC 2606 保留的 `example.com`（`dsh.example.com`；隔离实例 `dsh-test.example.com`）。发布的 tarball 包含 `lib/`、`docs/demo/` 和 `.agents/skills/`（D16）。
- **提交风格**：`type(scope): subject`，scope 是模块名（`guard`、`session-store`、`ci`）。Conventional commits 驱动发版（见下）。
- **行文**：写到能保住契约就停，其余删掉。
  - 公开 JSDoc 记录调用方可见的返回值区分、抛出/拒绝、副作用、所有权、时序、取消和持久性。
  - 注释只写不显然的契约（不变量、竞态顺序、安全边界）；不叙述控制流，不复述代码。
  - README 承载消费者契约：配置、语义、失败模式、限制、扩展点。
  - 一个解释只有一个家；只在本地说必要的契约事实，理由用链接。
  - 不泄漏推理过程：不引用未提交的草稿或设计会话产物（决策编号、草稿的 `§N`），不写变更叙述（「曾经」「不再」「这个 PR」），不写面向评审者的辩解。陈述当前行为；推迟的工作写成 `TODO(<tag>):` 或 issue 引用。可解析的已提交文档引用（`docs/history/specs/dsh-auth-plan.md` §4）是允许的。
- **TODO 纪律**：内联 TODO/FIXME 带一个稳定的 tag 命名这个味道（例如 `TODO(auth-token-gate):`），说明为什么可以安全地回头看，并写明动作。不为推测性的抱怨留 TODO。
- **GUI 演示**：改动用户可见的 web 行为（登录页、重定向、握手拒绝）必须附带从真实流程录制的演示：从那个分支启动真实服务器、干净的浏览器状态、不用夹具或 mock 传输。在嵌入旁边说明这段录制证明了什么。

## CI

`.github/workflows/ci.yml` 在每次推送到 `main` 和每个 PR 上跑，**ubuntu-latest 和 windows-latest 两个平台**（fail-fast 关闭）：`npm ci`、格式检查、lint、no-emdash、slice 边界、FSD 分层（Steiger）、门禁 runner（`gates:check` + `gates:self-test`）、类型检查、覆盖率测试、构建、bundle 检查、宿主契约检查，然后两道一致性门禁：

1. **提交产物一致性**：全新构建后 `git diff --exit-code -- lib`，提交的 `lib/` 必须等于一次干净构建。
2. **消费者安装模拟**：全新 clone + `npm install --omit=dev`，被守卫的 `prepare` 脚本（husky 是 devDependency）不能失败，这是 `dsh plugin add <git-url>` 运行的环境。

## 发版（release-please）

版本完全由 `main` 上的 conventional commits 自动决定（[release-please](https://github.com/googleapis/release-please)）：

- 把 `feat:`/`fix:` 提交合进 `main` 会让 Release workflow 开一个**发版 PR**，它升 `package.json`、更新 `CHANGELOG.md`、把新版本记进 `.release-please-manifest.json`；
- 合并那个 PR 会创建 git tag + GitHub Release；
- 永不手改 `version`、`CHANGELOG.md` 或 manifest，只能本地重跑 release-please（或让 PR 拥有它们）；
- 发版 PR 合并后，Release workflow（`release.yml`）还会发布到 npm（`dsh-auth-gate`，MIT 许可）；消费者也可以从 git 或本地 tarball（`npm pack`）安装。

**npm 认证是 Trusted Publishing（OIDC），不是 token。** `publish` job 持有 `id-token: write`，不存在 `NPM_TOKEN` secret。npm 用这个 job 的 GitHub 签名身份换一个短期发布 token，所以没有长期凭据可泄漏或轮换。三件事必须保持成立，否则发布会以裸 `ENEEDAUTH` 失败：

- npmjs.com 上的 trusted publisher 指向这个仓库和 workflow 文件名 `release.yml`，改文件名意味着先改 npm；
- job 保留 `id-token: write`（顶层 `permissions` 块不授予它）；
- `actions/setup-node` **不**给 `registry-url`。那个输入会往 `.npmrc` 写 `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}`；没有 token 时它展开成空字符串，npm 读成「认证已配置」，跳过 OIDC 交换并失败（[actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)）。仓库的 `.npmrc` 已经固定了公共 registry。

Node 24 是固定的，因为 Trusted Publishing 需要 npm ≥ 11.5.1，而 Node 22 带的是 npm 10.9.x。不传 `--provenance`：trusted publish 自动 attest。

**合并策略。** 功能/PR 流程用 **squash** 合进 `main`，每个 PR 落成恰好一个 conventional commit（PR 标题）：`gh pr merge <n> --squash`。squash 是必须的，不是可选的：release-please 解析被合并分支的提交**以及**（对 merge commit 而言）merge commit 关联的 PR 标题，所以 merge-commit 合并会把每个变更在 CHANGELOG 里记两次。0.6.0–0.6.4 的说明里，同一个 `client:`/`fix:` 变更各出现两次（分支提交 + merge commit）。用 squash 就没有 merge commit，每个 PR 恰好贡献一条 changelog 条目。

`docs:`/`chore:`/`ci:`/`test:` 提交不触发发版。0.x 语义：`fix:` → 0.0.x，`feat:` → 0.x.0。

**Release notes 与 changelog 的区别。** release-please 从 `main` 上每个提交的**主题行**同时写 CHANGELOG 条目和 GitHub Release 正文：提交正文、PR 描述和隐藏类型（`docs:`/`chore:`/`ci:`/`test:`/`build:`/`refactor:`/`style:`）永不出现，所以 changelog 只有 `Features` 和 `Bug Fixes` 两节。一个 promotion PR 被 squash 成一个提交，所以一起提升的**一批**变更只产出一条条目：每个值得单独一行的变更单独开 PR，或者接受简短的条目，在 tag 存在后整理发布页（`release-pr`，然后 `wait-publish`，然后）：

```bash
gh release edit v<version> --notes-file notes.md
```

整理发布正文是唯一被认可的手改；`CHANGELOG.md` 本身保持生成（见上），所以两个表面按设计不同。把 PR 编号留在 squash 主题里（`<title> (#<n>)`），这样生成的条目仍然链到讨论。

## 分支卫生

2026-08-30 的 promotion 跑出过两个错误，各花了一个修复周期，现在都记下来，免得有人重新踩：

- **在 promotion PR 上用 `--delete-branch` 会删掉远端 `development`。** 当 PR 的 head 分支是 `development`（正常的 development→main 路径），`gh pr merge <n> --squash --delete-branch` 会在合并后删掉远端 `development` 分支。后果：下一次 `git push origin development` 打印 `[new branch]`，任何对 `development` 的 fetch/pull 都以 `couldn't find remote ref development` 失败。→ 永不在 promotion PR 上带 `--delete-branch`；用 `gh pr merge <n> --squash` 合并。万一发生了，立刻重建：`git push origin development`（本地分支历史完好）。
- **提交可能意外落到本地 `main`**（例如你在 `main` 上却没注意）。`main` 只接受 squash 合并，所以把提交挪回去并重置本地指针：`git checkout development && git cherry-pick <sha> && git branch -f main origin/main`。那个过期提交留在 reflog 里；`origin/main` 在你推送之前不受影响，**绝不在 `main` 偏离时推送它**。

## 依赖说明

- **Registry 纪律**：`package-lock.json` 严格针对公共 npm registry 生成，`npm run lock:check`（`verify` 和 CI 的一部分）在任何其他 host 上失败。GitHub runner 到不了这台机器 `NPM_CONFIG_REGISTRY` 指向的内部 Nexus。`.npmrc` 设了 `replace-registry-host=never`，让本地安装逐字取公共 URL（这台机器直连 npmjs）。增删依赖时总是跑 `npm install --registry=https://registry.npmjs.org/`。
- `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`zod`、`yaml` 是运行时依赖（都在 npmjs 上公开）。
- `@deepseek-ai/dsh-storage-domain` 是 **peer**，用与 `engines.dsh` 相同的走廊字符串声明（`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || >=0.2.0-rc.1`，见 D28）。三个 caret 备选记录了验证过的宿主线；末尾的下界让每个更晚的宿主版本都兼容，所以新的 dsh 线永远不需要手工追加备选。门禁用 `includePrerelease` 求值 peer 范围，它拒绝的插件会被静默跳过，这就是声明宁可宽的原因。dev/test 宿主队列（`dsh-host-webserver`、`dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`）固定在 `0.2.2-rc.1`，这是第一条路由可以是 `{ resource }` 的线；这个固定让集成测试能挂载真实的 `/plugins` resource 前缀和 SPA resource fallback（`@deepseek-ai/cordis` 跟到 `4.1.0`）。上面的 peer 声明无论如何保持宽走廊。`docs/history/specs/impl-m1.md` §3 把原来的 `^0.1.0-rc.6` 固定记为冻结历史，不是当前政策。
- `lint-staged` 留在 `^16.1.0`：17.x 要求 Node ≥ 22.22.1，开发机可能跑更早的 22.x。

## 决策记录

一个有真实替代方案、或者未来读者会重新争论的决定，在 `.agents/notes/` 里写一条 Agent Note。规则见 [.agents/notes/README.md](../.agents/notes/README.zh.md)；简版：

- `proposed/` 放未落地的工作，`implemented/` 放已交付的，`rejected/` 放被否决的，`archived/` 放冻结的历史。
- 每条笔记是三件套：`foo.md`（英文）、`foo.zh.md`（中文）、`foo.i18n.yaml`（确认一致时的 blob 哈希）。
- 笔记记录决定，不记录工作令：不放整份文件内容、不放编号步骤、不放命令配方。
- `npm run notes:check` 执行树形和文件内格式；`npm run notes:links` 执行链接；`npm run bilingual:check` 保持配对诚实。

旧的编号 ADR（D1-D38）已迁进这棵树；每条笔记保留 `Legacy ID: D<n>` 行，所以代码注释里引用 `D31` 仍然能解析。
