# dsh-auth-gate 开发约定

工程基线改编自 `rsp/com` 项目：最严格的 TypeScript 预设（strictest preset）、启用类型检查
规则的 flat ESLint、Prettier、Husky/lint-staged/commitlint 门禁，以及 80% 覆盖率红线的
Vitest。所有环节都收敛到一条命令。

## 命令

| Task                       | Command                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Type-check（类型检查）     | `npm run type-check` (`tsc -p tsconfig.json --noEmit`)                                                       |
| Lint（代码检查）           | `npm run lint` (flat ESLint，启用类型检查)                                                                   |
| Format（格式化）           | `npm run format` / `npm run format:check`                                                                    |
| Tests（测试）              | `npm run test` (Vitest, `vitest run`)                                                                        |
| Watch tests（监听测试）    | `npm run test:watch`                                                                                         |
| Coverage（覆盖率）         | `npm run test:coverage` (v8，80% branches/functions/lines/statements)                                        |
| Build（构建）              | `npm run build` (tsc 输出到 `lib/`，LF 换行，declarations + source maps)                                     |
| Scenario gates（场景门禁） | `npm run gates` (自动探测变更面；pre-push 时运行)                                                            |
| Full gate（全量门禁）      | `npm run verify` (format:check + lint + type-check + test:coverage；完整组合 —— CI 跑全套，并非每次本地运行) |

跑单个测试文件：`npm run test -- src/guard.test.ts`
按名称跑测试：`npm run test -- -t "guard"`

## Git 钩子

- `pre-commit`：lint-staged（在暂存文件上跑 Prettier + `eslint --fix`）。
- `commit-msg`：commitlint —— Conventional Commits，固定的 type 集合
  （`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`）。
- `pre-push`：`npm run gates -- --base @{u}` —— 按变更面（未推送的提交 + 未提交的改动）
  选取最小证据集；完整覆盖率是 CI 的职责。

## 目录结构

分层布局（2026-08-30 重构，见 [`docs/decisions.md`](./decisions.md) D5）：

```
src/
├── index.ts           # plugin entry + auth 服务接线（M3：mode 二选一装配 password 流）
├── cli.ts             # dsh-auth 用户管理 CLI（bin 入口，M3 新增）
├── proxy-cli.ts       # dsh-auth-proxy（bin 入口）
├── gate/              # 守卫核心机制层（跨模式）
│   ├── index.ts       #   barrel：跨 slice 唯一入口
│   ├── gate.ts        #   Gate 词表 + noopGate
│   ├── guard.ts       #   webServer 路由/升级/fallback 包装与拒绝管线 + AUTH_PATH_PREFIX
│   └── self-check.ts  #   包装覆盖自检（fail loud）
├── session/           # 会话层（核心机制层，token/password 共同消费）
│   ├── index.ts
│   └── session-store.ts  # storage-domain 会话持久化
├── features/          # 认证面（同层 slice 互不 import，跨 slice 只走 barrel）
│   ├── token/
│   │   ├── index.ts
│   │   ├── token-gate.ts      # TokenGate：白名单/cookie/Bearer 共享 token + safeEqual
│   │   └── auth-endpoints.ts  # token 模式 /auth 兜底 + 三个 exact 端点
│   ├── password/
│   │   ├── index.ts
│   │   ├── password.ts        # scrypt 哈希/恒时验证 + DUMMY_HASH（M3 新增）
│   │   ├── password-gate.ts   # PasswordGate：白名单/cookie/Bearer 会话 token
│   │   ├── password-login.ts  # POST /auth/login 逻辑（限速/用户文件/恒时验证/发会话）
│   │   └── password-endpoints.ts # password 模式 /auth 兜底 + 三个 exact 端点
│   ├── totp/
│   │   ├── index.ts
│   │   ├── totp.ts            # RFC 6238：自写 base32 + HOTP/TOTP + 恒时验证（M4 新增）
│   │   ├── replay-guard.ts    # 防重放：内存记录已验 (counter, code)（M4 新增）
│   │   └── cli.ts             # dsh-auth user totp enable/disable（M4 新增）
│   └── proxy/
│       ├── index.ts
│       ├── proxy.ts           # 本地反向代理（HTTP/WS 透传，dsh-auth-proxy）
│       └── proxy-headers.ts   # 请求/响应头过滤 + Set-Cookie 重写
├── shared/            # 叶子通用层
│   ├── index.ts
│   ├── auth-common.ts  # 端点共享纯函数（validateNext，M3 提取）
│   ├── cookie.ts       # Cookie 头解析
│   ├── form-body.ts    # urlencoded body 读取
│   ├── login-page.ts   # 自包含登录页（token + password + TOTP 挑战三版）
│   ├── rate-limit.ts   # 双桶登录限速器（M3 新增）
│   ├── skill-install.ts # dsh-auth skill install（M3 新增）
│   └── users-file.ts   # users.yaml 加载/校验/原子写 + 默认路径解析（M3 新增）
├── client/            # client 半边（与 host 互不 import）
├── *.test.ts          # 单元测试（与源码同居；integration 测试留在根）
└── integration.*.test.ts  # 真实 cordis/webserver/storage 栈集成测试

test/               # src 外共享测试 harness（vitest 不自动收集、不编译进 lib、不进 coverage）
lib/                # build output — COMMITTED (see below), never hand-edited
```

分层纪律由 `npm run slice:check` 强制（跨 slice import 只落 barrel、features 同层互禁、
client/host 隔离、无法解析即失败）；增删切片请同步本结构图与门禁脚本。

## 已提交的构建产物

`lib/` 由 `tsc -p tsconfig.build.json` 生成，且**提交入库**、绝不手工编辑：

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
no-emdash、slice 边界、决策记录、类型检查、覆盖率测试、构建、bundle 检查，
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
- `@deepseek-ai/dsh-storage-domain` 由 `docs/implemented/impl-m1.md` §3 锁定在 `^0.1.0-rc.6`：
  已核实公共 registry 上存在，且与部署环境 dsh checkout 的 `0.1.0-rc.6` 一致。
- `lint-staged` 保持在 `^16.1.0`：17.x 要求 Node ≥ 22.22.1，开发机可能跑更早的 22.x。
