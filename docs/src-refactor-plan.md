# dsh-auth-gate src 目录重构方案（参考 framework 分层约定）

> 状态：**已实施（2026-08-30）**——verify 自检全绿、与 framework 交叉验证通过，待 review 后提交/开 PR
> 分支：`development`
> 性质：**纯结构性重构**——只移动文件 + 机械更新 import，零行为变更
> 参考：`dsh-plugin-framework` / `dsh-collab` 的 `features/ + shared/ + client/` 分层约定

## 1. 背景与动机

| 项            | 现状                                                                                                                                                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/` 文件数 | 52（26 源码 + 26 测试），共 8202 行                                                                                                                                                                                                                                          |
| 目录结构      | 除 `client/` 外 **17 个服务模块全平铺在根目录**                                                                                                                                                                                                                              |
| 模块清单      | gate / guard / cookie / token-gate / auth-endpoints / password / password-gate / password-endpoints / password-login / session-store / users-file / login-page / rate-limit / form-body / auth-common / self-check / skill-install / proxy / proxy-headers / cli / proxy-cli |

根目录 21 个入口级文件名并排，已经过了「扫一眼就知道系统长什么样」的临界点；M4 TOTP 还没开工，此刻重构 **成本最低**（v0.10.0 已发布、PR #53 挂起不合并）。

## 2. 原则：参考，不照搬

框架的四层树（`entities/ + features/ + shared/ + client/{features,shared}`）是给**带 UI 的功能插件**设计的教学模板。auth-gate 是**服务端认证插件**，client 半边只有 3 个文件，照搬会过度设计。适配原则：

1. **按认证面分组**：token / password / session 各成 feature；守卫是跨模式核心机制，独立一层；通用件进 `shared/`
2. **cli 入口留根**：`package.json` bin 指向 `lib/cli.js` / `lib/proxy-cli.js`，移动会扩大改动面，不值当
3. **纯移动**：`git mv` 保历史，import 路径机械更新，**不顺手改任何逻辑**
4. **一个 PR 一件事**：重构 PR 与后续 TOTP / 主题 / i18n 工作严格分离

## 3. 目标目录树

```
src/
├── index.ts                    # 插件门面：apply / Config / AuthService（不动）
├── cli.ts                      # bin: dsh-auth（留根）
├── proxy-cli.ts                # bin: dsh-auth-proxy（留根）
├── client/                     # 不变：context.ts / index.tsx / logout-action.tsx
│
├── gate/                       # 守卫核心机制（跨模式）
│   ├── index.ts                #   barrel（跨 slice 唯一入口）
│   ├── gate.ts                 #   Gate 接口
│   ├── guard.ts                #   webServer 包装
│   └── self-check.ts           #   启动自检（仅依赖 guard）
│
├── session/                    # 会话层（核心机制层，与 gate 并列）
│   ├── index.ts                #   barrel
│   └── session-store.ts        #   token/password 两个认证面共同消费
│
├── features/                   # 认证面（同层 slice 互不 import）
│   ├── token/
│   │   ├── index.ts            #   barrel（跨 slice 唯一入口）
│   │   ├── token-gate.ts
│   │   └── auth-endpoints.ts
│   ├── password/
│   │   ├── index.ts
│   │   ├── password.ts
│   │   ├── password-gate.ts
│   │   ├── password-endpoints.ts
│   │   └── password-login.ts
│   └── proxy/
│       ├── index.ts
│       ├── proxy.ts
│       └── proxy-headers.ts
│
└── shared/                     # 通用件（叶子层）
    ├── index.ts                #   barrel
    ├── auth-common.ts          #   validateNext（3 处使用）
    ├── cookie.ts               #   cookie 解析（4 处使用）
    ├── form-body.ts
    ├── login-page.ts           #   两种 mode 共用（token 模式也渲染 loginPageHtml）
    ├── rate-limit.ts
    ├── skill-install.ts        #   cli 支持件（仅 cli 使用）
    └── users-file.ts           #   users.yaml 仓库 + dshHomeDir 解析，三方共用
```

> 📌 执行期修正（与初稿的两处差异，已按依赖方向调整）：
>
> 1. **`features/session/` → `session/`（降层为核心机制层）**：边界规则「features 同层 slice 互不 import」逮住了 token/password → session 的现实依赖——session 是被两个认证面共同消费的会话基础设施，不是平级兄弟功能，降层让「层」匹配依赖图（方案 §5 本来就画了这条边）
> 2. **`features/login/` → `shared/login-page.ts`**：login-page 被 token/password 两个 slice 共用，放任何 feature 都会制造跨 slice 引用；它本身是无依赖叶子模块，归 shared 最贴切（同理避免 features 同层互引）
> 3. 每个 slice/层目录补 `index.ts` barrel（首版 `export *` 保证 API 面不变，后续可收紧为显式清单）

## 4. 移动清单（含测试文件）

| 目标                 | 移入的源码（+ 同居测试）                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gate/`              | gate.ts〔+test〕、guard.ts〔+test〕、self-check.ts〔+test〕                                                                                                  |
| `session/`           | session-store.ts〔+test〕（核心机制层，非 feature）                                                                                                          |
| `features/token/`    | token-gate.ts〔+test〕、auth-endpoints.ts（+ login/methods/status 4 个测试）                                                                                 |
| `features/password/` | password.ts〔+test〕、password-gate.ts〔+test〕、password-endpoints.ts（+ 本体/login/login-rate/login-reject/methods/status 共 6 个测试）、password-login.ts |
| `features/proxy/`    | proxy.ts〔+test〕、proxy-headers.ts〔+test〕                                                                                                                 |
| `shared/`            | auth-common.ts、cookie.ts〔+test〕、form-body.ts〔+test〕、login-page.ts、rate-limit.ts〔+test〕、skill-install.ts〔+test〕、users-file.ts〔+test〕          |
| **留在根**           | index.ts〔+test、+password.test〕、cli.ts〔+test〕、proxy-cli.ts〔+test〕、`integration.*.test.ts` ×5、`guard-proxy-deny.test.ts`、`client/`                 |

> integration 测试横跨多模块，跟 index 测试一样留在根（测试的是整插件装配），不强行塞进某个 feature。

## 5. 依赖方向检查（基于现有 import 边）

```
根(index/cli/proxy-cli) ──> gate / session / features/* / shared（一律走 barrel）
features/token ──> gate / session / shared（一律走 barrel）
features/password ──> gate / session / shared（一律走 barrel）
session、features/proxy ──> 叶子；shared 内部可互相引用（skill-install → users-file 同层，无碍）
```

- **无循环依赖** ✓
- **token 与 password 互不依赖** ✓（login-page 归 shared 后无跨 feature 引用）
- **features 同层 slice 互不 import**（边界规则，见 §10.2；session 因被两认证面消费而降层）
- 全部为相对路径 import，无别名——机械替换即可，无构建器配置变更

## 6. 执行步骤

1. **基线**：`git status` 干净（pr53 计划文档先放着不动），`npm run verify` 绿
2. **git mv 批量移动**（源 + 测试同移，保留历史）——✅ 已执行（60 文件）
3. **import 路径机械更新**（按 §4/§5 的边表逐文件替换）——✅ 已执行（44 文件 + 39 文件后缀修复）
4. **`npm run build` 重建 lib**（tsc rootDir=src → lib，目录结构自动映射）——✅ 已执行（含 `bundledSkillDir()` 深度修复：模块从 src 根移到 src/shared 后包根向上两层）
5. **提交 lib 变更**——CI 有 `git diff --exit-code -- lib` 门禁，**待提交时执行**
6. **`npm run verify` 全绿**（format / lint / type-check / coverage 80% / lock）——✅ 已执行（扩展链 9 项全绿）
7. **开 PR 到 development**，review 用 `git diff -M`（rename 识别）核对「纯移动」，并过一遍仓库 `.agents/skills/dsh-auth-code-review` 清单（enforcement / lifecycle / disposal / 真实路径测试覆盖）——**待主人确认后执行**

## 7. 风险与对策

| 风险                     | 对策                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| lib 漂移门禁             | 构建后必须提交 lib；若出现意外 diff 说明构建配置先有问题，停下排查       |
| bin 路径变化             | cli / proxy-cli 留根，package.json bin 与 tsdown 均不动                  |
| PR #53 漂移（基于旧树）  | 已知可接受：反正不合并；将来 hand-merge 或请贡献者 rebase                |
| review 噪音大            | `git diff -M` 看重命名识别；移动 PR 内**禁止夹带逻辑改动**               |
| vitest / eslint 目录敏感 | 已核实：include/coverage 均按 `src/**` 通配，eslint 全域扫描，与目录无关 |
| 验收口径                 | verify 绿 + lib 一致 + `git diff -M` 里无逻辑 diff + 覆盖率不降          |

## 8. 明确不做（本次范围外）

- 模块改名 / 合并（如把两个 endpoints 抽象成通用端点注册器）
- `index.ts` 拆分（245 行配置装配，后续可仿框架拆 `shared/config`，另开 PR）
- `client/` 重组（3 个文件，不值得）
- 主题 hook、登录页 i18n、M4 TOTP（各自独立 PR）

## 9. 后续建议顺序

1. ~~本重构 PR（纯移动）~~ ✅ 已实施，待提交/开 PR
2. `shared/config` 拆分 + index.ts 瘦身
3. 脚本兜底迁移（§10）——✅ 已实施（P1 verify-bundle / P2 slice-boundaries / P3 no-emdash 全部迁入并挂 verify 链）
4. docs 制度加固（§11）：对齐官方 ADR 全套（三态目录 + 双语 + verify 脚本 + 精选回填 3–5 条），M4 前生效
5. M4 TOTP（落进 `features/totp/`）
6. 登录页 i18n / 主题（独立）

## 10. 脚本与规范兜底迁移（framework 对齐评估）

### 10.1 迁移决策表

| framework 脚本                       | 用途                          | auth-gate 判断                                                                                                                                                                                                                                                       | 时机          |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `check-lockfile-registry.mjs`        | lockfile 仅公共 npm 源        | ✅ 已有同款，不迁                                                                                                                                                                                                                                                    | —             |
| `run-gates.mjs`                      | 门禁编排                      | ✅ 已有同款，不迁                                                                                                                                                                                                                                                    | —             |
| `verify-bundle.mjs`                  | 校验 client bundle 单文件契约 | ✅ **已迁**——修剪 framework 特有的 Typert / data-plugin-css / patch-name 三检查（无对应机制），保留 banner/footer/id/单文件/大小/style.css 契约；已核实 lib/client.js 契约一致                                                                                       | P1 已实施     |
| `verify-slice-boundaries.mjs`        | 分层边界（防依赖回潮）        | ✅ **已迁（参数化适配）**——去 entities/别名/css 逻辑；分层 = root/gate/session/shared/features/client；规则：跨 slice 只能落 barrel、features 同层互禁、client 与 host 隔离、无法解析即失败（fail-closed）。**执行中发现 session 被双认证面消费 → 降层为核心机制层** | P2 已实施     |
| `check-no-emdash.mjs`                | 源码禁用 `—`（U+2014）        | ✅ **已迁**——存量实际 22 处（含执行期新增注释），全部改写为合规标点/连字符，框架原版脚本直跑通过                                                                                                                                                                     | P3 已实施     |
| `generate-typert.mjs`                | Typert 远程类型生成           | ❌ 不迁——无 Typert 边界                                                                                                                                                                                                                                              | —             |
| `verify-decision-records.mjs`        | ADR 决策记录校验              | 🔥 **迁**——官方一万次 commit 验证的制度核心（见 §11）：习惯未形成时机器约束更需要                                                                                                                                                                                    | docs 制度批次 |
| `check-aliases.mjs` + `aliases.json` | client 路径别名一致性         | ❌ 不迁——全相对路径、无别名                                                                                                                                                                                                                                          | —             |
| `create-slice.mjs`                   | FSD slice 脚手架              | ❌ 不迁——简化分层，新建 feature 成本低                                                                                                                                                                                                                               | —             |
| `install-to-profile.mjs`             | 本地冒烟安装                  | ❌ 不迁——`dsh-extension-testing` 技能 + deployment.md 已覆盖                                                                                                                                                                                                         | —             |

### 10.2 verify 链调整

```
现状：  format:check + lint + type-check + test:coverage + lock:check
已实施：format:check + lint + lint:no-emdash + slice:check + lock:check
        + type-check + test:coverage + build + bundle:check
```

`build + bundle:check` 进 verify 链后，lib 漂移门禁从「CI 事后查 diff」前置为「本地 verify 拦截」，与现有 CI `git diff --exit-code -- lib` 双保险；代价是本地 verify 多一次 build。与 framework 的 verify 链仅差 `aliases:check`（无别名）与 `decisions:check`（随 ADR 批次迁入）。

### 10.3 执行批次（✅ 已全部实施）

- **P1**：verify-bundle 迁入 + verify 链加 build/bundle:check ✅
- **P2**：slice-boundaries 参数化适配 + slice 目录补 `index.ts` barrel + `slice:check` 进 verify ✅
- **P3**：em-dash 存量清理 + check-no-emdash 迁入 ✅

## 11. ADR 决策记录评估（framework vs auth-gate）

### 11.1 背景修正（重要）

framework 的 ADR 制度是从 **dsh 官方仓库（一万次 commit 验证）** 沉淀下来的，不是教学模板装饰。关键证据是 framework 自己的 `decision-record-lifecycle` ADR：

- 该决策作者初始方案恰是「轻量版：跳过双语、跳过格式脚本」，**当天即被 supersede 推翻**
- 官方结论原话：_「before the habit is formed, a mechanical constraint is needed more」_——**习惯未形成时，机器约束更需要**
- 官方报告「what not to copy」节还点名：**无真实使用样例就定脚本规则**，会编码错误规则

对照检查：auth-gate 现有文档本就是双语模式（9 对 `.md`/`_zh.md`）；commit 规模 131 vs 官方上万。**此前「双语是维护税、脚本是维护税、量小不需要」三条论据全部不成立**——量小正需要机器约束，双语是沿用现有模式而非新增负担。

### 11.2 修正后结论：对齐官方全套，只保留节奏控制

**采用（全套）：**

1. **三态目录** `docs/decisions/{proposed,implemented,archived}/`——状态用路径编码（移动文件即改状态；路径移动比 front-matter 难绕过，官方论据）
2. **双语对儿**——`docs/decisions/` 内用官方命名 `YYYY-MM-DD-slug.(en|zh).md`（目录内自治，AI 辅助翻译成本可控）
3. **四段式**（Decision/Context/Alternatives Considered/Why）——「为什么层」正是 auth-gate 缺的（60+ 冻结决策只有 final 状态）
4. **迁入 `verify-decision-records.mjs`** 挂 verify 链——防「习惯未形成时制度腐化」，这是一万次 commit 验证出的核心价值
5. **`docs/decisions.md` 编号索引 + 模板 + README**——沿用 framework 的 D1/D2 编号风格

**只保留节奏控制（非简化制度）：**

- **不全量回填 M1–M3**（60+ 条，成本远超收益；官方也不回填历史）
- **但精选 3–5 条重大决策补记**作启动样例（fail-closed 原则、scrypt 选型、guard 包装 seam、logoutOrder 默认值……）——既立习惯，又避开官方点名的「无真实样例定规则」坑
- **M4 TOTP 起新决策全部走 ADR**；修改已冻结决策时补记一条
- 落地为**独立 docs 批次**（不塞重构 PR），M4 开工前生效；约定写入 `docs/development.md`，AGENTS.md 只挂索引

### 11.3 遗留细节（开工时定）

- 脚本 `FILENAME_RE` 要求 `(en|zh).md` 后缀，与仓库其他文档的 `_zh.md` 习惯不同——`docs/decisions/` 目录内自治采用官方命名（脚本零改成本最低），或参数化脚本匹配 `_zh`
