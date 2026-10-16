# D30. host 半边进 `src/host/` 用 FSD 下三层，client 半边用 FSD 五层

## 决定了什么

`src/` 的两个半边都改用 Feature-Sliced Design 分层，并由 Steiger 守护，结构对齐 dsh-lingualab
（v0.9.0 的 host 重构与更早的 client 重构）：

- **host 半边收进 `src/host/`，只用下面三层**：`shared`、`entities`、`features`。没有 `widgets`、
  `pages`、`app`：host 不组合界面，插件也不拥有自己的外壳。现在的 `gate/`、`session/`、`http/`、
  `features/*`、`shared/` 按下表重新落位。
- **client 半边在 `src/client/` 里最多用五层**：`shared`、`entities`、`features`、`widgets`、`pages` 中
  用得上的几层，没有 `app` 层，`index.tsx` 留在分析树的根上。实际用了 `shared`、`entities`、`features`、
  `widgets`，没有 `pages`。
- **入口与装配留在 `src/` 根，在分析树之外**：`index.ts`、`cli.ts`、`proxy-cli.ts`（`package.json`
  的 `main`、`bin` 指向它们的产物，位置不动），以及 `admin-wiring.ts`、`token-resolver.ts`、
  `launch-token-bridge.ts`、`cli-skill.ts`。D9 定下的「TOTP 能力经根装配注入 password」照旧在这里发生。
- **integration 测试与 helper 搬出 `src/`**，进 `test/integration/`。

本记录取代 D5（src 分层 + 跨 slice 只走 barrel）与 D11（http 层）的目录部分，二者已归档；
「跨切片只走 `index.ts`」「feature 同层互禁」「client 与 host 互不导入」三条纪律保留，改由 Steiger
与缩小后的 `slice:check` 执行。

### host 落位

| 层         | 切片或分段   | 来自                                                                                                                                                                                       |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared`   | `guard`      | `gate/` 整个（`gate.ts`、`guard.ts`、`self-check.ts`）；它只依赖 `shared`                                                                                                                  |
|            | `http`       | `cookie`、`form-body`、`origin`、`host`、`client-ip`、`ip-address`、`auth-common`、`login-redirect`，加上 `http/endpoints.ts` 里与会话无关的 `authCatchAll`、`queryOf`、`methodNotAllowed` |
|            | `login-page` | `login-page.ts`、`login-page-assets.ts`                                                                                                                                                    |
|            | `rate-limit` | `rate-limit.ts`                                                                                                                                                                            |
|            | `skill`      | `skill-install.ts`                                                                                                                                                                         |
|            | `lib`        | 从 `users-file.ts` 拿出来的 `dshHomeDir`（`skill-install` 现在为它反向依赖用户文件）                                                                                                       |
| `entities` | `session`    | `model/` 放 `session-store.ts`；`api/` 放 `http/endpoints.ts` 里的 `handleLogout`、`handleStatus`                                                                                          |
|            | `user`       | `model/` 放 `users-file.ts`、`password-policy.ts`；`@x/session.ts` 只把 `UsersLoadResult` 类型给 `handleStatus`                                                                            |
| `features` | `token`      | `api/auth-endpoints.ts`，`model/token-gate.ts`                                                                                                                                             |
|            | `password`   | `api/` 放端点与改密路由，`model/` 放 gate、登录、会话签发、受限会话、挑战 cookie、禁用清扫，`lib/` 放 scrypt，`ui/` 放服务端渲染的失败页与改密页                                           |
|            | `totp`       | `lib/totp.ts`，`model/replay-guard.ts`，`cli/` 放 enable/disable 子命令                                                                                                                    |
|            | `admin`      | `api/` 放端点与响应，`model/` 放审计、重置步骤、用户列表与 deps                                                                                                                            |
|            | `proxy`      | `model/proxy.ts`、`model/proxy-headers.ts`，只有 `proxy-cli.ts` 消费                                                                                                                       |

切片的单元测试跟着源码走。`shared/` 里那几个测的是包清单而不是某个模块的测试（`host-corridor`、
`manifest-icon`、`manifest-locale`）挪到 `src/` 根，和入口测试放在一起。

### client 落位

| 层         | 切片或分段        | 文件                                                                                                  |
| ---------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `shared`   | `api`             | `context.ts`，宿主槽位上下文的本地镜像（仅类型）                                                      |
|            | `i18n`            | `account-copy.ts`                                                                                     |
|            | `ui`              | `account-styles.ts`、`account-icon.ts`                                                                |
| `entities` | `account`         | `model/` 放 `admin-types.ts`；`api/` 放 `account-status.ts`（它请求 `/auth/status`）                  |
| `features` | `change-password` | `ui/` 放 `account-form`、`account-fields`；`model/` 放 `account-submit`；`lib/` 放 `account-redirect` |
|            | `admin-users`     | `api/` 放 `admin-api`；`lib/` 放 `admin-failure`、`admin-copy`；`ui/` 放 `admin-form`、`admin-fields` |
|            | `logout`          | `ui/logout-action`                                                                                    |
|            | `nav-icon`        | `ui/account-nav-icon`（一个 DOM 垫片）                                                                |
| `widgets`  | `account-section` | `ui/` 放 `account-section`、`admin-block`（组合改密与用户管理）以及挂载整个设置段的测试               |

`shared` 只有分段（`api`、`i18n`、`ui`），各带自己的 `index.ts`，层级本身没有 barrel。`context.ts` 放在
`api`，因为它是 client 与宿主运行时服务（槽位、locale、effect 作用域）之间的边界，这正是 FSD `api`
分段的含义；放 `lib` 会让人以为是通用工具。没有 `pages` 层（插件只有一个设置段，它是 widget），也没有
`app` 层。没有任何文件被改名：Steiger 没有强迫任何一处。

单元测试跟着被测模块走。少数测试放在 widget 里，而不是名字暗示的模块旁边，因为分层不允许另一种放法：
`account-status.test.tsx` 挂载 `SettingsAccountSection` 来测 `useAccountStatus`，而实体不能导入 widget；
`admin-integration.test.tsx` 与 `admin-review-fixes.test.tsx` 同理，测的是真实的设置段。
`logout-action.test.tsx` 与 `admin-integration.test.tsx` 从根 `index.tsx` 导入 `apply`，Steiger 不拦。
用 `vi.mock` 替换模块的测试写的是模块的真实文件而不是 barrel，因为 mock 必须命中生产代码实际解析的
那个说明符。

现有的两处「横向」依赖（`admin-copy` 读 `account-copy`，`admin-fields` 读 `account-styles`）都指向
下沉到 `shared` 的文件，不构成 feature 互引。`src/client/index.tsx` 的位置不变，`exports["./client"]`
的类型路径 `lib/client/index.d.ts` 因此不受影响。唯一按路径读 client 源文件的跨半边钉子测试
（`test/integration/integration.p11-pins.test.ts`）随新路径更新。

## 背景

D5（2026-08-30）把平铺的 `src/` 分了层，当时拒绝完整 FSD 的理由是「client 只有 3 个文件」。
到 0.17.2，`src/client/` 已有 19 个源文件、17 个测试、约 5900 行，全部平铺，靠 `account-`、`admin-`
前缀充当分组；`src/` 根堆着 35 个文件，其中 24 个是测试、4 个是 integration helper。

host 半边的依赖图本身是干净的：feature 之间零互引，`slice:check` 守着 barrel。它的问题在别处：

- **层的名字是自创的**。`gate/`、`session/`、`http/` 叫「核心机制层」，规则写在自写的
  `verify-slice-boundaries.mjs` 里，只有本仓库认识；dsh-lingualab 与 dsh-plugin-framework 用的是
  FSD 的层名与 Steiger。
- **`shared/` 不全是叶子**。`users-file.ts` 与 `password-policy.ts` 是用户这一业务实体，`skill-install.ts`
  为了 `dshHomeDir` 依赖用户文件。
- **`http/` 一半是会话**。D11 不肯把 `methodNotAllowed` 之类塞进 `session/`，理由成立；但
  `handleLogout`、`handleStatus` 本来就是会话操作，只是当时没有放它们的层。
- **大切片没有内部结构**。`features/password/` 有 9 个源文件、约 30 个测试，平铺在一个文件夹里。

另有两处顺带要修的漏洞：

- `tsconfig.build.json` 只排除 `*.test.ts`，4 个 `integration-*-helpers.ts` 因此被编译进 `lib/`，随包发布。
- 构建不清空 `lib/`，CI 的 `git diff --exit-code -- lib` 只能抓内容漂移，抓不到残留。已有孤儿
  `lib/features/session/` 与 `lib/skill-install.*` 被 git 跟踪着；不先修，这次搬家会再留下一批。

## 考虑过的替代方案

- **保持 D5 现状，只整理根目录的测试**：能解决「看着乱」的大半，但 client 的平铺和 host 的自创
  层名都留着，本仓库与 lingualab、plugin-framework 继续是两套说法。
- **只把 client 改成 FSD，host 不动**：这是上一轮评估的建议，前提是误以为 lingualab 的 host
  仍是平铺。lingualab 已把 host 收进 `src/host/` 的三层，只改一半会让两个仓库在 host 侧不一致。
- **host 用 FSD 但不加 `src/host/` 外壳**：少一层目录，但入口、装配、client 与 host 各层挤在
  同一个 `src/` 下，Steiger 也没法只分析 host 半边；lingualab 的结构是有外壳的。
- **照搬 client 的五层到 host**：`widgets`、`pages` 是为组合界面设的，host 没有界面可组合。
- **用 ESLint `no-restricted-paths` 分区代替 Steiger**：lingualab 考虑后否掉：分区只认层的上下
  顺序，同层互引、绕过 barrel、`@x` 都要各写一套规则，Steiger 自带。
- **把 `handleLogout`、`handleStatus` 留在 `shared/http`，把会话当参数注入**：能避开 `@x`，但每个
  调用方都要自己先拼会话依赖；`@x` 是 FSD 给这种情况的惯例，并把依赖写在一个以使用方命名的文件里。
- **integration 测试留在 `src/` 根（lingualab 的做法）**：lingualab 只有 5 个装配测试；这里是 14 个
  加 4 个 helper，留在根上「乱」就没解决，helper 也仍会被 tsc 编进 `lib/`。

## 为什么这样选

- **和兄弟仓库同一套结构**：dsh-lingualab 与 dsh-plugin-framework 都用 FSD 层名，host 用下三层、client
  用五层，在任一仓库里学会的规矩在这里同样成立，agent 也不需要为本仓库单记一套「核心机制层」。
- **检查换成现成工具**：Steiger 自带同层互禁、公共 API、`@x`、命名一致性等规则，自写脚本只需保留
  Steiger 管不到的部分（client 与 host 互不导入、导入无法解析即失败）。
- **层与依赖图重新对齐**：用户文件归实体，会话操作归会话实体，`shared` 回到真正的叶子；
  这些都是现在就成立的依赖关系，只是目录没有表达出来。
- **一次性修掉两个发布漏洞**：helper 不再进包，`lib/` 不再积累孤儿。

## 实施顺序

参照 lingualab 的三步法（实际分四步，均已落地），每一步都让 `npm run verify` 保持通过，`git diff -M` 只见 rename 与导入行：

1. **清理**：`build` 前清空 `lib/`（全部产物都由构建生成），删掉已跟踪的孤儿；integration 测试与
   helper 搬进 `test/integration/`，vitest 的 `include` 加上这一项。
2. **原地解开**（目录不动）：`dshHomeDir` 移出 `users-file.ts`；`http/endpoints.ts` 拆成纯 HTTP 件
   与 logout/status 两份。
3. **host 搬家**：先用一个分支验证 Steiger 能解析 NodeNext 的 `.js` 导入（lingualab 用的是 `.ts`
   后缀，这是本仓库独有的风险；不行就退回扩写自写脚本，并在本记录里改写）；然后 `git mv` 进
   `src/host/`，写 barrel 与 `@x`，`lint:fsd` 接入，`slice:check` 缩成 Steiger 看不到的部分：
   两个半边互不导入、根文件进入 `src/host` 只能经 barrel、导入无法解析即失败、不许有游离文件；更新
   `docs/specs/development.md` 结构图、`AGENTS.md`、随包技能和凡是画了 `src/` 结构的现行文档；重建 `lib/`。
   本步没有动 client 半边。
4. **client 搬家**：按上面的落位表放好，`lint:fsd` 跑第二遍 `src/client`（`steiger src/host && steiger
src/client`）。`slice:check` 的「不许有游离文件」现在也要求每个 client 文件要么是 `src/client/index.tsx`、
   `src/client/index.test.tsx`，要么位于 `src/client/{shared,entities,features,widgets,pages}/` 之下。

第 4 步完成后，本记录已实施，并在 `docs/decisions.md` 登记为 D30；D5 与 D11 已归档（哈希已登记）。
这些收尾放在第 4 步而不是第 3 步，是因为在那之前 client 半边仍遵循 D5，D5 与 D11 对它依然有效。已实施
记录与 `docs/implemented/`、`docs/handoff/` 里引用的旧路径不改：它们记录的是写下时的代码。
`docs/specs/src-refactor-plan*`（D5 的执行方案）加了一条「历史文档」说明。

## 待定

- host 命名（第 3 步已定）：Steiger 的 `ambiguous-slice-names`、`inconsistent-naming` 对 host 目录树
  没有触发，所以没有任何文件夹或文件被迫改名（无）。client 命名（第 4 步已定）：lingualab 被逼改了两个名字，但这里 Steiger 对 client
  目录树同样没有报任何问题，所以没有文件夹或文件被改名（无）。注意 `steiger.config.js` 里
  `fsd/repetitive-naming` 本就是有意关掉的（`account-`、`admin-` 前缀刻意保留），这条规则也就不可能逼出改名。
- `context.ts` 的去向（第 4 步）：`shared/api`，不是 `shared/lib`；理由见「client 落位」。
- `login-notice.ts` 的去向（第 3 步）：它只有一组提示白名单常量加一个纯解析函数，不渲染任何标记，
  所以放进 `features/password/model/`；`api` 段与 `ui` 段（改密页）都从那里引用。
- `features/password` 是否再拆成 `login`、`password-change`、`restricted` 几个 feature：它们共用会话签发，
  拆开会出现 feature 互引，暂按一个切片加分段处理。
