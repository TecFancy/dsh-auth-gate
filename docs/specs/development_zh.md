# dsh-auth-gate 开发约定

工程基线改编自 `rsp/com` 项目：最严格的 TypeScript 预设（strictest preset）、启用类型检查
规则的 flat ESLint、Prettier、Husky/lint-staged/commitlint 门禁，以及 80% 覆盖率红线的
Vitest。所有环节都收敛到一条命令。

## 命令

| Task                       | Command                                                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check（类型检查）     | `npm run type-check` (`tsc -p tsconfig.json --noEmit`)                                                                                                                                                                                   |
| Lint（代码检查）           | `npm run lint` (flat ESLint，启用类型检查)                                                                                                                                                                                               |
| FSD layering（FSD 分层）   | `npm run lint:fsd` (Steiger 分析 `src/host` 与 `src/client`；层级顺序、同层隔离、公共 API、命名)                                                                                                                                         |
| Format（格式化）           | `npm run format` / `npm run format:check`                                                                                                                                                                                                |
| Tests（测试）              | `npm run test` (Vitest, `vitest run`)                                                                                                                                                                                                    |
| Watch tests（监听测试）    | `npm run test:watch`                                                                                                                                                                                                                     |
| Coverage（覆盖率）         | `npm run test:coverage` (v8，80% branches/functions/lines/statements)                                                                                                                                                                    |
| Build（构建）              | `npm run build` (先清空 `lib/`，再 tsc 输出 + client bundle；LF 换行，declarations + source maps)                                                                                                                                        |
| Scenario gates（场景门禁） | `npm run gates` (自动探测变更面；pre-push 时运行)                                                                                                                                                                                        |
| Full gate（全量门禁）      | `npm run verify` (format:check + lint + lint:no-emdash + slice:check + lint:fsd + lock:check + decisions:check + docs:check + readme:parity + type-check + test:coverage + build + bundle:check；完整组合 - CI 跑全套，并非每次本地运行) |
| Docs gate（文档门禁）      | `npm run docs:check` (双语配对 + 50 KiB 大小红线 + 同文件 H2-H4 重复标题（含根 README）；已挂 verify 链与 CI hygiene - 规则见 `docs/README.md`「文档规范」)                                                                              |

跑单个测试文件：`npm run test -- src/host/shared/guard/guard.test.ts`
按名称跑测试：`npm run test -- -t "guard"`

## Git 钩子

- `pre-commit`：lint-staged（在暂存文件上跑 Prettier + `eslint --fix`）。
- `commit-msg`：commitlint —— Conventional Commits，固定的 type 集合
  （`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`）。
- `pre-push`：`npm run gates -- --base @{u}` —— 按变更面（未推送的提交 + 未提交的改动）
  选取最小证据集；完整覆盖率是 CI 的职责。

## 目录结构

Feature-Sliced Design 分层布局（D30，见 [`docs/decisions.md`](./decisions.md)）。host 半边在
`src/host/` 下只用 FSD 六层中的下三层；入口与装配留在 `src/` 根，位于被分析的目录树之外。
client 半边在 `src/client/` 下按需使用五层中的若干层（没有 `app`：插件不拥有应用外壳），`index.tsx`
留在它的树根。

```
src/
├── index.ts               # plugin entry + auth 服务接线（mode 二选一装配 password 或 token 流）
├── cli.ts                 # dsh-auth 用户管理 CLI（bin 入口）
├── proxy-cli.ts           # dsh-auth-proxy（bin 入口）
├── admin-wiring.ts        # 管理路由的 root 侧装配（P2）
├── token-resolver.ts      # 共享 token 凭证解析器（token 模式）
├── launch-token-bridge.ts # 0.1.2-alpha launch-token 兼容层（M2）
├── cli-skill.ts           # `dsh-auth skill install`
├── *.test.ts              # 根测试：入口、CLI、包清单检查（host-corridor、manifest-*）
├── protocol/              # 跨半边契约（D31）：/auth 路径与登录 URL 构造；不 import 任何东西
├── host/                  # host 半边：FSD 下三层，由 Steiger 分析（`npm run lint:fsd`）
│   ├── shared/            #   无 slice 的层：只有 segment，各带自己的 index.ts
│   │   ├── guard/         #     Gate 词表、webServer 包装与拒绝管线、启动自检
│   │   ├── http/          #     cookie / 表单体 / Origin / Host / 客户端 IP / `next` / 登录跳转，
│   │   │                  #     以及与会话无关的 authCatchAll、queryOf、methodNotAllowed
│   │   ├── login-page/    #     自包含登录页（token、password、TOTP 挑战三版）
│   │   ├── protocol/      #     进入 src/protocol 的桥（host 半边唯一入口）
│   │   ├── rate-limit/    #     双桶登录限速器
│   │   ├── skill/         #     `dsh-auth skill install`
│   │   └── lib/           #     叶子小件（`dshHomeDir`）
│   ├── entities/
│   │   ├── session/       #     model/ session-store；api/ logout 与 /auth/status（AuthHttpDeps）
│   │   └── user/          #     model/ users-file（users.yaml）、password-policy；
│   │                      #     @x/session.ts 只向 session 实体暴露 `UsersLoadResult`
│   └── features/          #     slice 之间互不 import；跨 slice 只走 index.ts
│       ├── token/         #       api/ /auth 端点；model/ TokenGate
│       ├── password/      #       api/ 端点与改密；model/ 门、登录、会话签发、受限会话、
│       │                  #       挑战 cookie、禁用用户清扫、登录提示；
│       │                  #       lib/ scrypt；ui/ 服务端渲染的失败页与改密页
│       ├── totp/          #       lib/ RFC 6238；model/ 防重放；cli/ enable、disable 子命令
│       ├── admin/         #       api/ 端点与响应；model/ 审计、重置步骤、用户列表、deps
│       └── proxy/         #       model/ 本地反向代理与头过滤
└── client/                # client 半边：FSD 五层，由 Steiger 分析，不 import host 半边
    ├── index.tsx                 # bundle 入口（tsdown）与宿主槽位接线；分析树的根
    ├── shared/                   # 只有 segment，各带自己的 index.ts
    │   ├── api/                  # `AuthContext`：宿主槽位上下文的本地镜像（仅类型）；
    │   │                         # `protocol.ts`：client 半边进入 src/protocol 的桥
    │   ├── i18n/                 # 账号文案：键、中英词典、translate 辅助
    │   └── ui/                   # 共用内联样式与账号图标路径
    ├── entities/
    │   └── account/              # model/ 账号与管理视图类型；api/ `useAccountStatus`
    ├── features/                 # slice 之间互不 import；跨 slice 只走 index.ts
    │   ├── change-password/      # ui/ 表单与字段；model/ 校验与提交；lib/ 改密后跳转
    │   ├── admin-users/          # api/ 列表与重置请求；lib/ 文案与失败映射；ui/ 表单
    │   ├── logout/               # ui/ 退出设置动作
    │   └── nav-icon/             # ui/ 设置导航图标垫片（DOM）
    └── widgets/
        └── account-section/      # ui/「账号安全」设置段；组合改密与用户管理
```

单元测试与源文件同居，放在同一个 segment 里。

```
test/               # src 外的测试代码（不编译进 lib、不进 coverage）
├── integration/    #   integration.*.test.ts：真实 cordis/webserver/storage 栈集成测试
│                   #   + integration-*-helpers.ts（经 slice 或 segment 的 index.ts 引 src）
└── *-harness.ts    #   单元测试共享 harness（非 .test.ts，vitest 不自动收集）
lib/                # build output（host 在 lib/host/ 下）- 已提交入库（见下），绝不手工编辑
```

分层由两道门禁强制。`npm run lint:fsd` 对两个半边各跑一遍 Steiger，分别分析 `src/host` 与 `src/client`（层级顺序、同层隔离、经
`index.ts` 的公共 API、`@x` 跨引、命名）。`npm run slice:check` 只保留 Steiger 看不到的部分：
client 与 host 两个半边互不 import，根文件进入 `src/host` 只能经 slice 或 segment 的
`index.ts`，`src/protocol/` 不 import 自身以外的任何文件、只能经它的 `index.ts` 由两个桥
（`src/host/shared/protocol/index.ts`、`src/client/shared/api/protocol.ts`）进入，
无法解析的相对 import 即失败，`src/` 下每个文件都必须是根文件、位于 `src/protocol/`、位于
`src/host/{shared,entities,features}/`、是 `src/client/index.tsx` 或 `src/client/index.test.tsx`，
或位于 `src/client/{shared,entities,features,widgets,pages}/`。增删 slice 请同步本结构图。

## 已提交的构建产物

`lib/` 由 `npm run build` 生成（`scripts/clean-lib.mjs` 先清空，再依次 `tsc -p tsconfig.build.json`、
`tsdown`、`tsc -p tsconfig.client.build.json`），且**提交入库**、绝不手工编辑，所以它恰好等于构建产物、没有孤儿文件：

- 从 git 安装本包的消费者（`dsh plugin add <git-url>`）拿到的是开箱即用的包，
  服务器上无需任何构建工具链；
- `npm pack`/`npm publish` 产出完全相同的目录树（`prepack` 会先重建）；
- CI 校验一致性：全新构建后 `git diff --exit-code -- lib` —— 谁的提交里带了过期产物，
  CI 任务就会失败。

`tsconfig.build.json` 固定 `newLine: "lf"`，保证产出的产物在 Windows/Linux 构建机之间
逐字节一致。

## 约定

- **TypeScript strictest preset（最严格预设）**：`strict`、`noUncheckedIndexedAccess`、
  `exactOptionalPropertyTypes`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、
  `noUnusedLocals/Parameters`。NodeNext 模块解析：相对导入以 `.js` 结尾。
- **测试中不引入 ambient 全局**：`describe/it/expect` 一律从 `vitest` 导入。
- **`src/` 内禁止 `console.*`**（ESLint error）。一律经 cordis 的 `ctx.logger` 记录；
  scripts/配置文件豁免。
- **复杂度/长度上限**（ESLint error，不允许基线豁免）：
  复杂度 ≤ 15、单文件 ≤ 250 行、函数 ≤ 80 行（空行/注释行不计）。超出就拆分，而不是破例。
- **`.sort()`/`.toSorted()` 必须显式传比较器** —— 默认字典序在纯 ASCII 之外不可靠。
- **行尾一律 LF**（`.editorconfig` + `.gitattributes`），Prettier 默认值：
  宽度 100、双引号、尾逗号。
- **示例域名**：真实部署域名不写进仓库。文档、部署样例、测试、代码默认值与截图统一用
  RFC 2606 保留域名 `example.com`（`dsh.example.com`；隔离实例 `dsh-test.example.com`）
  —— 发布产物会随 `lib/`、`docs/demo/`、`.agents/skills/` 一起出去（D16）。
- **提交风格**：`type(scope): subject`，scope 是模块名（`guard`、`session-store`、`ci`）。
  Conventional commits 驱动发布（见下文）。
- **行文（Prose）**：写到足以保住契约为止，然后删掉其余部分。
  - 公开 JSDoc 记录调用方可感知的返回差异、throws/rejections、副作用、所有权、时机、
    取消与持久性。
  - 注释只陈述非显然的契约（不变量、竞态顺序、安全边界）；不做控制流叙述、不重复代码。
  - README 承载消费者契约：配置、语义、失败模式、限制、扩展点。
  - 一个解释只有一个归属地；只在本地重复必要的契约事实，并把论证出处链过去。
  - 不泄漏推理过程稿：不引用未提交的草稿或设计讨论产物（决策编号、草稿的 `§N`）、
    不做变更叙述（"used to"、"no longer"、"this PR"）、不写面向评审者的辩解。
    只陈述当前行为；推迟的工作写成 `TODO(<tag>):` 或 issue 引用。
    允许引用可解析的已提交文档（`docs/specs/dsh-auth-plan.md` §4）。
- **TODO 纪律**：行内 TODO/FIXME 带稳定 tag 点明问题（如 `TODO(auth-token-gate):`）、
  说明为什么值得回访、并写出要采取的动作。不为臆测性的抱怨写 TODO。
- **GUI 演示**：任何改变用户可见 web 行为（登录页、重定向、握手拒绝）的改动，都必须附带
  从真实流程录制的演示 —— 用该分支启动的真实服务器、干净的浏览器状态、无 fixture 或
  mock 传输。在嵌入旁边写明这段录制证明了什么。

## 决策记录

重大决策记 ADR（对齐 dsh-plugin-framework 制度，见 [`docs/decisions/README.md`](./decisions/README.md)）：

- **三态目录** `docs/decisions/{proposed,implemented,archived}/`，状态由路径表达，移动文件即改状态。
- **双语成对** `YYYY-MM-DD-slug.{zh|en}.md`，`implemented/`/`archived/` 必须齐全；`proposed/` 允许单语。
- **四段式**：决定了什么（Decision）/ 背景（Context）/ 考虑过的替代方案（Alternatives Considered）/ 为什么这样选（Why）——「为什么层」是记录的核心价值。
- **强制检查** `npm run decisions:check`：文件名、必需章节、双语配对、归档哈希冻结（`.manifest.json` 只追加）；已挂 verify 链与 CI。
- **写与归档的判据**：有被认真考虑过的替代方案、或将来的人会重新踩一遍想清楚的坑 → 写；未来还需不需要靠它做决定 → 决定归档与否；归档 = 冻结，改动走新记录 + 链接。
- 索引页 `docs/decisions.md`（一句话摘要 + 链接）；M1–M3 冻结表仍以 `docs/implemented/impl-mN.md` 为执行权威。

## CI

`.github/workflows/ci.yml` 在每次推送到 `main` 和每个 PR 上运行，且同时跑在
**ubuntu-latest 与 windows-latest**（关闭 fail-fast）：`npm ci`、格式检查、lint、
no-emdash、slice 边界、FSD 分层（Steiger）、决策记录、类型检查、覆盖率测试、构建、bundle 检查，
然后是两道一致性门禁：

1. **已提交产物一致性（Committed artifact parity）**：全新构建后 `git diff --exit-code -- lib`
   —— 提交的 `lib/` 必须与一次干净构建完全一致。
2. **消费者安装模拟（Consumer install simulation）**：全新 clone + `npm install --omit=dev` ——
   受守护的 `prepare` 脚本（husky 是 devDependency）不得失败；这正是
   `dsh plugin add <git-url>` 运行的环境。

## 发布（release-please）

版本号完全由 `main` 上的 conventional commits 自动推进
（[release-please](https://github.com/googleapis/release-please)）：

- 把 `feat:`/`fix:` 提交合并进 `main` 后，Release 工作流会打开一个**发布 PR**：
  提升 `package.json` 版本、更新 `CHANGELOG.md`，并把新版本记入
  `.release-please-manifest.json`；
- 合并该 PR 会创建 git tag 与 GitHub Release；
- 绝不手工编辑 `version`、`CHANGELOG.md` 或 manifest —— 只能通过本地重跑
  release-please 修改（或让发布 PR 独占这些文件）；
- 发布 PR 合并后，Release 工作流（`release.yml`）还会发布到 npm
  （`dsh-auth-gate`，MIT 许可）；消费者也可以从 git 或本地 tarball（`npm pack`）安装。

**合并策略（Merge policy）。** 功能/PR 流程以 **squash** 合并进 `main` ——
每个 PR 恰好落成一个 conventional commit（即 PR 标题）：`gh pr merge <n> --squash`。
Squash 是强制项而非可选项：release-please 会解析被合并分支的提交
_以及_（对 merge commit 而言）该 merge commit 关联的 PR 标题，所以 merge-commit 合并
会把每个变更在 CHANGELOG 里记录两次 —— 0.6.0–0.6.4 的说明中，同一个 `client:`/`fix:`
变更都出现在两个 SHA 下（分支提交 + merge commit）。squash 之后没有 merge commit，
每个 PR 恰好贡献一条 changelog 条目。

`docs:`/`chore:`/`ci:`/`test:` 提交不触发发布。0.x 语义：`fix:` → 0.0.x，
`feat:` → 0.x.0。

**发布说明 vs. CHANGELOG。** release-please 只用 `main` 上每个 commit 的**主题行**生成 CHANGELOG 条目
与 GitHub Release 正文：commit 正文、PR 描述，以及被隐藏的类型（`docs:`/`chore:`/`ci:`/`test:`/
`build:`/`refactor:`/`style:`）都不会出现 —— 所以 changelog 里只有 `Features` 与 `Bug Fixes`
两种小节。又因为 promotion PR 会被 squash 成一条 commit，**一次批量晋升只得到一条条目**：想让每个变更
各占一行，就一次只晋升一个变更；否则接受这条简短条目，在 tag 发布后手工把 release 正文补全
（`release-pr` → `wait-publish` 之后）：

```bash
gh release edit v<版本> --notes-file notes.md
```

手工编辑 release 正文是唯一被认可的手改；`CHANGELOG.md` 本身保持自动生成（见上），两个界面因此
**有意**不同。squash 标题里保留 PR 编号（`<标题> (#<n>)`），生成的条目才能链到那次讨论。

## 分支卫生

2026-08-30 晋升（promotion）演练中犯过两个错误，各花掉一个修复周期 —— 现在都写进文档，
免得有人再踩一遍：

- **晋升 PR 上加 `--delete-branch` 会删掉远程 `development`。** 当 PR 的 head 分支是
  `development`（常规 development→main 路径）时，`gh pr merge <n> --squash --delete-branch`
  会在合并后删除远程 `development` 分支。后果：下一次 `git push origin development`
  打印 `[new branch]`，任何对 `development` 的 fetch/pull 都会报
  `couldn't find remote ref development`。→ 晋升 PR 上永远不要传 `--delete-branch`；
  用普通的 `gh pr merge <n> --squash` 合并。万一已经发生，立即重建：
  `git push origin development`（本地分支历史完好无损）。
- **提交可能意外落到本地 `main` 上**（比如没注意就停在 `main` 分支上）。
  `main` 只接受 squash 合并，所以把提交挪回去并重置本地指针：
  `git checkout development && git cherry-pick <sha> && git branch -f main origin/main`。
  过期提交留在 reflog 里；在你 push 之前 `origin/main` 不受影响 ——
  `main` 偏离时绝不 push。

## 依赖注意事项

- **Registry 纪律**：`package-lock.json` 严格只对公共 npm registry 生成，
  `npm run lock:check`（属于 `verify` 与 CI）在任何其他 host 上都会失败 ——
  GitHub runners 无法访问本机 `NPM_CONFIG_REGISTRY` 指向的内部 Nexus。
  `.npmrc` 设置 `replace-registry-host=never`，本地安装原样拉取公共 URL
  （本机可直接访问 npmjs）。新增或更新依赖时，一律用
  `npm install --registry=https://registry.npmjs.org/`。
- `@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`zod` 是运行时依赖（npmjs 上均公开）。
- `@deepseek-ai/dsh-storage-domain` 是 **peer**，与 `engines.dsh` 用同一条走廊串
  （`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || >=0.2.0-rc.1`，见 D28）。
  前面三个 caret 替代项记录验过的宿主线；末尾的下界接住之后的所有宿主版本，所以 dsh 换新线时
  不需要人来追加替代项。闸门判定 peer 范围时带 `includePrerelease`，而被它拒绝的插件会被静默
  跳过，所以声明宁可偏宽。dev/测试宿主
  cohort（`dsh-host-webserver`、`dsh-storage`、`dsh-storage-domain`、`dsh-storage-json`）
  跟随走廊下界（`^0.2.0-rc.1`）。`docs/implemented/impl-m1.md` §3 里的 `^0.1.0-rc.6` 是冻结的
  历史记录，不是现行纪律。
- `lint-staged` 保持在 `^16.1.0`：17.x 要求 Node ≥ 22.22.1，开发机可能跑更早的 22.x。
