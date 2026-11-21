# Claude Code 评审 — dsh-auth-gate 0.23 全仓评审

- **日期**: 2026-11-22
- **审阅者**: Claude Code（`claude-agent-sdk`，只读），四个并行 agent，范围互不重叠：守卫核心与接线、宿主认证流程、React 客户端半边、工程体系（文档、门槛、CI、发布、打包）
- **范围**: `development` `494df74`（`0.23.0`）下的整个仓库；`main` 在 `5ebedbd`（`0.23.1`）
- **结论**: request-changes —— 11 条 P1，无 P0；fail-closed 主干与凭据路径是可靠的，缺口都在它们周围的不变量上
- **标准**: 仓库 `AGENTS.md`、`docs/security.md`、`docs/conventions.md`、`.agents/skills/dsh-auth-code-review`

## 总评

评审时点的门槛套件是绿的（22 个 gate 加 12 个 gate 自测，exit 0），所以下面没有一条是靠例行检查能抓到的。它们归结为三个主题。

1. **限速与锁定不变量只对串行客户端成立。** limiter 的检查、口令校验和失败记账之间隔着 `await`，中间没有任何占位；锁定退避的指数恒为 0；TOTP 段与口令段共用同一个桶，而这个桶会被一次正确口令清空；token 模式压根没有 limiter。单看每一条都不大，合起来就是：面对并发攻击者，五次失败即锁基本是装饰。
2. **fail-closed 保证只在启动时成立。** 端点注册中途失败没有回滚，别家插件占了同一路径就会留下指向已卸载插件的受守卫路由；`unwrap` 无条件还原 `server.register*`，叠在上面的第三方 wrapper 会被静默丢掉。
3. **文档描述的系统比实际发布物小。** `docs/architecture.md` 和 `docs/security.md` 里 passkey 出现 0 次；`security.md` §4 说跨站 bounce 在门判定之前执行，代码里却是在判定放行之后。在一个「文档即契约」的仓库里，这是缺陷，不是措辞偏好。

工程那半边另外补了两处发布路径的缺口：publish job 完全不跑验证；`lib/` 一致性检查看不见未跟踪的构建产物。

## 方法与边界

四个 Claude Code subagent 并行，读的范围互不重叠，全程只读。其中三个的 Bash 被沙箱拒绝（非交互 `dontAsk` 模式），所以那几份报告只建立在读代码上；工程那位能跑 `grep`、`ls`、`wc`，但没有 `node` 和 `npm`。没有任何 reviewer 跑过 gate、测试、类型检查或 `npm pack`。

协调会话随后把每条 P1 和大部分 P2 结论回到源码读了一遍，并否掉了一条（见「被否掉与更正过的结论」）。下表的 **Status** 列记录这件事：

- **verified** —— 主导会话在 `494df74` 的对应代码里确认了机制；
- **reviewer** —— 具体且可信，但没有复核，当成线索而不是事实。

reviewer 自己的覆盖缺口列在文末。仓库里没有改动任何文件。

## 门槛基线

`npm run verify` 在 `494df74` 上：**OK，22 个 gate 加 12 个 gate 自测，exit 0**（2026-11-22 02:12）。覆盖率来自同一次运行。有了这个基线，下面的结论才该被读成「现有 gate 抓不到这个」，而不是「跑一下 CI 就知道」。

## 发现

级别沿用 reviewer 的 P1/P2 标度：P1 是「下一阶段功能工作前该修」，P2 是「值得排期」，S 是建议。编号按区域分：`G` 守卫与接线，`L` 登录与凭据流程，`C` 客户端，`E` 工程。

### P1 — 建议在下一阶段功能工作前修掉

| ID  | 区域   | 发现                                                       | Status   |
| --- | ------ | ---------------------------------------------------------- | -------- |
| G1  | 守卫   | 后续 `register` 抛错时，已注册的路由泄漏，且无法重新挂载   | verified |
| L1  | 流程   | 重新提交正确口令即可重置 TOTP 的猜码上限                   | verified |
| L2  | 流程   | 锁定退避从不升级，`maxDelaySeconds` 是死配置               | verified |
| L3  | 流程   | 限速的检查、校验与记账不是原子的                           | verified |
| L4  | 流程   | token 模式没有限速，也没有熵下限                           | verified |
| L5  | 流程   | CLI `user passwd` 不撤销会话，与 `security.md` §6 矛盾     | verified |
| C1  | 客户端 | 会话过期与 `bad_origin` 被显示成「当前密码错误」           | verified |
| C2  | 客户端 | 登出顺序探针可能漏掉一次已挂载的设置项                     | verified |
| C3  | 客户端 | 列表刷新失败是空操作，旧列表留在「成功」提示旁边           | reviewer |
| E1  | 工程   | publish job 不做验证，也没有和 CI 挂钩                     | verified |
| E2  | 工程   | `lib/` 一致性检查看不见未跟踪的构建产物                    | verified |

#### G1 — 注册中途失败会泄漏路由，并挡住重新挂载

- **位置**: `src/bootstrap-wiring.ts:133-142`，以及 token、password、passkey、admin 四个端点收集器里同样的内联写法。
- **问题**: `const disposers = [register(a), register(b), register(c)]` 在一个表达式里构造数组。第二个 `register` 抛错时，第一条路由已经进了宿主表，它的 disposer 却从没被存下。
- **影响**: `apply` 中止，但先注册的路由还留在表里、还带着守卫，指向的是已卸载插件的 handler。重试会在残留上撞「duplicate route」，只能重启进程。`security.md` §2 对 `wrapServer` 要求的逐条回滚纪律，没有用在端点收集器上。
- **修法**: 抽一个共享的 `mountRoutes()`，拿到一个 disposer 就 push 一个，失败时逆序执行；五份副本就不会各自漂移。
- **状态**: 在 `bootstrap-wiring.ts` 已复核；四个收集器形状相同。

#### L1 — TOTP 的猜码上限实际不存在

- **位置**: `src/host/features/password/model/password-login.ts:178-184`；`src/host/features/password/model/password-login.totp.ts:28,38,48,57`。
- **问题**: 发挑战 cookie 之前，第一段调用 `limiter.recordSuccess(ip, accountKey)`，同时删掉 IP 桶和账号桶。TOTP 段随后用**同一组** `(ip, username)` 键做检查和记账。
- **影响**: 已经拿到口令的攻击者，错 4 次验证码后把正确口令再 POST 一次就清零，然后无限循环。对 6 位数字码、±1 步窗口来说这是可用的爆破，而它打掉的正是第二因子存在的意义——撞库后的第二道门。
- **修法**: 给 TOTP 单独一个桶，或者只在完整登录成功时清桶。
- **注**: 上面几行的 `totp: required` 分支恰恰拒绝了 `recordSuccess`，注释写着「正确密码不得重置该账号/IP 的历史失败」。`needsTotp` 分支没有遵守自己的规则。
- **状态**: 已复核。

#### L2 — 锁定退避从不升级

- **位置**: `src/host/shared/rate-limit/rate-limit.ts:83-95`（`checkBucket`）、`:97-107`（`recordBucket`）。
- **问题**: `recordBucket` 计算 `exponent = failures - maxFailures`，但锁一到期 `checkBucket` 就把 `failures` 归零，而锁定期间端点 429 短路、从不记账。于是设锁时 `failures` 恒等于 `maxFailures`，指数恒为 0，延迟永远是 `baseDelayMs`。
- **影响**: 类注释承诺指数退避，`maxDelaySeconds` 承诺上限，两者都不存在。真实速率是每账号、每 IP 每 30 秒 5 次尝试，约每天 1.4 万次，永久如此。
- **修法**: 保留一个能跨过锁到期的 `strikes` 计数，只按 `windowSeconds` 衰减。
- **状态**: 已复核。

#### L3 — 限速的检查与记账不是原子的

- **位置**: `src/host/features/password/model/password-login.ts:154-182`；`passkey-login-finish.ts:105-121`；TOTP 段。
- **问题**: 放行路径上 `check` 是同步且无副作用的，随后 handler 依次 `await` 读用户文件、`await` scrypt 校验，最后才 `recordFailure`。中间没有任何占位。
- **影响**: 同一账号的 N 个并发请求全都先看到「未锁定」，突发请求的上限变成服务器并发度，而不是五次失败策略。
- **修法**: `check` 通过时预占一个 in-flight 名额，成功或失败时释放。
- **状态**: 已复核。

#### L4 — token 模式没有限速

- **位置**: `src/endpoints-wiring.ts:93-114`（token 分支）；`src/host/features/token/api/auth-endpoints.ts`。
- **问题**: token 分支没有把 `limiter` 传进 `registerAuthEndpoints`；`validateToken` 只做 `safeEqual`。password、passkey、改密各有自己的 limiter，而 `security.md` §5 把按客户端 IP 限速写成通用不变量。
- **影响**: 共享 token 可在线无限猜。只有 token 永远高熵生成时才无所谓，但没有任何地方保证这点：没有最小长度、没有熵检查、README 也没写生成方式。
- **修法**: 接上共享登录 limiter，或在启动时强制 token 熵下限。
- **状态**: 已复核。

#### L5 — CLI 改口令后所有会话仍然有效

- **位置**: `src/cli.ts:195-219`（`passwdUser`）；`docs/security.md:77-83`。
- **问题**: 安全页说改口令会撤销该用户全部会话，包括执行这次改动的那个。自助改密（`makeSessionRevoker`）和管理员重置都做到了；CLI 只重写哈希，除了一条 TOTP 警告什么都不打印。
- **影响**: 运维手动重置正是怀疑泄露时的标准动作，而最该生效的这条路径，把被盗的 cookie 和 Bearer 会话留到 TTL 到期。
- **修法**: 要么让 CLI 能访问会话域（`src/host/entities/session/`），要么把 §6 限定到 Web 路径并打印醒目警告——不能维持现在的静默缺口。
- **状态**: 两侧均已复核。

#### C1 — 会话过期被读成「当前密码错误」

- **位置**: `src/client/features/change-password/model/account-submit.ts:60-67`；`src/protocol/payloads.ts`（`PasswordChangeErrorBody`）。
- **问题**: `describeFailure` 把所有非 `invalid_totp` 的 401 都映射成 `current` 字段的 `invalidCredentials`。契约同样允许 401 `unauthorized`（会话过期或被撤销）和 403 `bad_origin`；两者都落进通用文案，`account-redirect.ts` 只在成功时用。
- **影响**: 表单打开期间会话失效的用户会被告知口令错，焦点还被移到口令框。他可以拿着正确口令无限重试，永远不知道需要重新登录。
- **修法**: 把 `unauthorized`（给重新登录入口）和 `invalidCredentials` 分开；admin 与 passkey 的映射器已经这么做了。
- **状态**: 已复核。

#### C2 — 登出顺序探针可能漏掉一次注册

- **位置**: `src/client/index.tsx:99-122`。
- **问题**: `dispose` 在 `mount(order)` 之后的 `.then` 里被重赋，没有 `AbortController`、没有 disposed 标志，`res.json()` 之前也不检查 `res.ok`。
- **影响**: 插件在 fetch 返回前就卸载时，`() => dispose?.()` 已经对默认注册执行过，迟到的 `.then` 又挂上一个，没人再收。热重载或慢网窗口里停用插件，就会留下一个重复的登出项。
- **修法**: 捕获 disposed 标志，卸载时 abort fetch，检查 `res.ok`，并按字段校验响应体而不是强转。
- **状态**: 已复核。

#### C3 — 列表刷新失败是空操作

- **位置**: `src/client/widgets/account-section/ui/admin-block.tsx:57`；`src/client/features/passkey/model/use-passkey-list.ts:25`。
- **问题**: 两个 hook 都用 `attempt === 0` 判定加载、错误和空态，所以成功变更之后的刷新如果失败，不会走到首屏错误分支。
- **影响**: 增、删、重置之后刷新失败，屏幕上是旧列表配着「成功」状态，重试按钮只把 `attempt` 加一，界面毫无变化。
- **修法**: 把刷新失败当成需要渲染的错误态，而不是「保留旧数据」。
- **状态**: 仅 reviewer 报告；值得补一个让第二次 fetch 失败的测试。

#### E1 — publish job 不做验证就发布

- **位置**: `.github/workflows/release.yml:32-79`；`.github/workflows/ci.yml`。
- **问题**: `publish` job 是 checkout、`setup-node`、版本对 tag 的检查（仅 dispatch 路径）、`npm ci`、`npm publish`。没有 gate、没有测试、没有 diff 步骤，也没有指向 CI 的 `needs`。`prepack` 会重建 `lib/`，也就是说发布物是「构建出来的」，不是「验证过的」。release-please 用 `secrets.GITHUB_TOKEN` 开 PR，这类推送通常不触发其他 workflow。
- **影响**: 进 npm 的产物可能从未在那个 commit 上测过；而且发布走 Trusted Publishing，发错了不能悄悄替换。
- **修法**: 加 `needs: ci`（或在 publish job 里跑 `npm run verify`），并在构建后加一步 `git diff --exit-code -- lib`。
- **状态**: 步骤表已复核；「release PR 不触发 CI」是从机制推出的，未实测。

#### E2 — `lib/` 一致性检查看不见未跟踪文件

- **位置**: `.github/workflows/ci.yml:105`（`git diff --exit-code -- lib`）。
- **问题**: `git diff` 比较的是工作树与索引，开发者从没 `git add` 过的构建产物对它不可见。
- **影响**: 新增源文件而编译产物没提交，CI 照样绿；提交的 `lib/` 与发布时重新构建的 tarball 就此分叉，`lib/` 入库的意义（`security.md` §10）被削弱。
- **修法**: 在 diff 之后再跑 `git status --porcelain -- lib`（或 `git add -N lib`），对未跟踪产物报错。
- **状态**: 已复核。

### P2 — 值得排期

| ID  | 发现                                                                     | 位置                                                              | Status   |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------- |
| G2  | `unwrap` 无条件还原 `server.register*`，会丢掉后加的第三方 wrapper        | `src/host/shared/guard/guard.ts:317-326`                          | verified |
| G3  | 幂等 wrap 没有 owner 或引用计数，第二个 disposer 会解除第一个             | `guard.ts`（`if (existing !== undefined) return existing`）        | reviewer |
| G4  | `guardUpgrade` 不捕获门抛错；`denyUpgrade` 先 write 再 destroy socket     | `guard.ts`（`guardUpgrade`、`denyUpgrade`）                        | reviewer |
| G5  | 拿不到 `webServer` 时 `apply` 静默返回，守卫被无声卸下且不记日志          | `src/index.ts:170-172`                                            | verified |
| G6  | 会话域挂载：迟到的 `.then` 可能在卸载后发布 store；打开失败则永久拒绝     | `src/index.ts`（`mountSessionDomain`）                             | reviewer |
| G7  | 代理标记拒绝匹配原始路径；百分号编码与双斜杠变体没有测试                  | `src/host/shared/guard/http.ts`（`isProxyDeniedRequest`）          | reviewer |
| G8  | `remoteAddress` 缺失被当作本地可信传输                                    | `src/host/shared/http/client-ip.ts`                                | reviewer |
| G9  | `security.md` §4 说 bounce 在判定前执行，代码里在放行之后                 | `docs/security.md:54-61` 对 `guard.ts:123-133`                     | verified |
| G10 | 注释引用了一个不存在的 `docs/decisions/...` 路径                          | `src/passkey-wiring.ts:38`                                        | verified |
| G11 | `denyBootstrap`、`/auth/*` 放行规则、`routeTarget` 在两个门里各有一份     | `token-gate.ts`、`password-gate.ts`、`guard/self-check.ts`         | reviewer |
| G12 | 会话 kind 用拒绝清单；bootstrap 的固定 subject 是合法用户名形状           | admin 端点、`password-change.ts:194`、`bootstrap-endpoint.ts`       | reviewer |
| G13 | `parseFormBody` 的 413 路径可能重置 socket，测试喂的是同步生成器          | `src/host/shared/http/form-body.ts`、`form-body.test.ts`           | reviewer |
| L6  | TOTP 重放守卫在 `counter - 1` 处裁剪，且只在内存里                        | `src/host/features/totp/model/replay-guard.ts:28-32`              | reviewer |
| L7  | `users.yaml` 写盘不 fsync、临时文件名固定、锁 10 秒后可被无条件抢走       | `src/host/entities/user/model/users-file.ts:132-152,263-270`       | verified |
| L8  | `user add` 跳过口令策略，`setDisabledUser` 跳过 `USERNAME_RE`             | `src/cli.ts:170-192,283`                                          | reviewer |
| L9  | 会话存储每次 `create` 都裁剪，且边迭代边删除                              | `src/host/entities/session/model/session-store.ts:87-88`           | reviewer |
| L10 | limiter 与 ceremony 表按插入顺序驱逐，轮换 IP 的攻击者能挤掉受害者条目    | `rate-limit.ts:109-127`、`ceremony-store.ts`                      | reviewer |
| L11 | 任何一次成功登录都清掉共享 IP 桶，而不只是账号桶                          | `rate-limit.ts:65-70`                                             | verified |
| L12 | 禁用用户清扫器每进程只警告一次；被删除的用户会话仍然有效                  | `disabled-sweeper.ts:30-31`                                       | reviewer |
| L13 | passkey 计数器先读、`await` 之后才推进，两个断言可以都通过                | `passkey-login-finish.ts:155-161,197`                             | reviewer |
| C4  | 管理员重置失败后焦点丢失；live region 与内容同时渲染                      | `admin-reset-hooks.ts`、`admin-fields.tsx:100`                    | reviewer |
| C5  | 管理员重置的 `setValue` 用渲染时闭包，不使用函数式更新                     | `admin-reset-hooks.ts`                                            | reviewer |
| C6  | passkey 界面：状态节点没有 `tabIndex`、表单嵌在 `<th>` 里、无 IME 保护、共用一个锁 | `passkey-fields.tsx:91`、`passkey-table.tsx:96-103`               | reviewer |
| C7  | `formatPasskeyDate` 可能抛错，且没有 error boundary                       | passkey 表格行                                                    | reviewer |
| C8  | 服务端数据在 `toCreationOptions` 和状态探针里用 `as` 强转而非校验         | `passkey-codec.ts`、`account-status.ts:83`、`index.tsx:104`       | reviewer |
| C9  | 状态请求瞬时失败被归结为「需要登录」，且 `/auth/status` 最多取 3 次        | `account-status.ts:83`、`logout-action.tsx:74`                    | reviewer |
| C10 | `PasskeyAdminErrorBody` 没有 `invalid_totp`，客户端只能比字符串字面量      | `passkey-form.ts:111-114,167`、`payloads.ts`                      | reviewer |
| C11 | 三个客户端 feature 里重复的字段、状态与锁逻辑，以及无用的导出              | `account-header.tsx:119`、`passkey-fields.tsx:31`、`admin-form.tsx` | reviewer |
| C12 | 口令策略文案把 14 与 256 写死，而不是读契约常量                            | `shared/i18n/account-copy.ts`                                     | reviewer |
| C13 | `aria-expanded={false}` 是常量；导航图标在宿主 DOM 上跑 `MutationObserver` | `admin-block.tsx:263`、`passkey-block.tsx:189`、`account-nav-icon.ts` | reviewer |
| E3  | 门槛路由对 `*.config.ts`、`tsconfig*`、`vitest.config.ts` 的改动跳过构建与测试 | `scripts/run-gates.mjs`（`RULES`）                                | reviewer |
| E4  | `no-emdash` 的自测是空转：脚本里没有 `--self-test` 分支                    | `scripts/check-no-emdash.mjs`、`gate-registry.mjs`                | verified |
| E5  | 死引用：`skills:updates`、`notes:seal`、一个不存在的 decisions gate、缺失的 README 标题 | `package.json`、`.agents/notes/README.md`、`docs/README.md`        | verified |
| E6  | `architecture.md` 与 `security.md` 从不提 passkey、bootstrap 和 launch token | `docs/architecture.md`、`docs/security.md`                         | verified |
| E7  | 发布包带上贡献者技能与 301 个 source map，而 map 指向的 `.ts` 不发布       | `package.json`（`files`）、`tsconfig.build.json`                  | reviewer |
| E8  | workflow 缺 `permissions`、`concurrency`、`timeout-minutes`；action 固定到 tag | `.github/workflows/*.yml`                                         | reviewer |
| E9  | README 把安装步骤放在约第 147 行，升级示例还停在 0.11.0→0.11.1             | `README.md`、`docs/deployed/deployment.md`                        | reviewer |
| E10 | `require-decision-record` 的匹配规则漏掉发布与打包文件                    | `.github/workflows/require-decision-record.yml`                   | reviewer |
| E11 | 覆盖率只有全局 80% 下限，单个安全文件掉下去会被均值掩盖                    | `vitest.config.ts`                                                | reviewer |
| E12 | release-please 没设 `bump-minor-pre-major`，0.x 上的破坏性变更会跳到 1.0.0 | `release-please-config.json`                                      | verified |

### 建议

| ID  | 建议                                                                          |
| --- | ----------------------------------------------------------------------------- |
| S1  | `zh-prose` 目前只报告、有 319 条发现；加一条基线棘轮，而不是等一次全量重写     |
| S2  | 20 个门槛脚本既没有类型检查也没有类型化 lint（缺 `allowJs`/`checkJs`）         |
| S3  | 把 README 重排成自托管者优先，并写清要备份什么（`users.yaml` 及其 `.bak`）     |
| S4  | 在 README 与配置 schema 里写明 token 熵要求                                   |

### 被否掉与更正过的结论

- **否掉——「管理员再认证忽略 `totpMode`」**（host-flows reviewer）。`reauthAccepted` 在 actor 有 TOTP secret 时一律要求验证码（`src/host/features/admin/model/reset-steps.ts:129-137`）。`totp: "required"` 模式下没有 secret 的用户根本登不进来，所以 actor 一定有 secret。不算缺陷，无需动作。
- **更正——「跨站 bounce 是认证绕过」**。host-flows reviewer 把它说成漏洞；guard reviewer 读同一段代码和那条 note（`2026-10-13-cross-site-navigation-bounce`），结论是对的。bounce 只在 `decide` 返回 `allow` 之后执行，不是绕过。错的是 `security.md` §4 的措辞（G9）。
- **更正——「TOTP 挑战 cookie 有效期过长」**。cookie 用 HMAC 签名，过期时间在 MAC 覆盖的载荷里，TTL 5 分钟；真正的问题在尝试计数（L1），不在 cookie。

### 做得好的地方

- **fail-closed 主干**：缺 session service、token 解析抛错、畸形 URL 全部落到 deny 或 400，`guardResource` 把错误往上抛而不是放行。
- **会话不变量**：`randomBytes` 256 位 token，只以 sha256 摘要落盘，cookie 走同一个 `buildCookie` 模板（`Path=/; HttpOnly; Secure; SameSite=Lax`）。
- **`wrapServer` 的逐条回滚**，并有测试断言外来路由要活下来。
- **凭据路径**：scrypt 参数随哈希存，未知用户走 `DUMMY_HASH`，恒时比较，未知用户、错口令、禁用用户同一响应。
- **`mutateUsersFile`**：锁加过期检测、mtime/size 比较交换、`.bak`、原子 rename、最后一个 admin 不变量、写前校验 passkey store。
- **门槛 registry**：一份 registry 同时驱动 verify、pre-commit、CI 和自测链；registry 与磁盘脚本、npm scripts、hook 不一致时 runner 拒绝启动。
- **依赖面**：4 个运行时依赖，`sideEffects: false`，显式 exports，客户端包 181 KB。

### 覆盖缺口

- 未审：`passkey/api/*management*`、`passkey/cli`、`features/proxy/`、`shared/telemetry/`、`shared/skill/`、`shared/login-page/`、`src/cli-usage.ts`、`src/cli-skill.ts`、`src/proxy-cli.ts`、password 的 `ui/` 页面，以及更深的集成测试（`host-corridor`、`guard.resource*`、`guard.cross-site`），只看过它们的形状。
- 没有 reviewer 执行过测试、类型检查或打包；所有关于运行时行为的「影响」都是从代码推出来的。
- `lib/` 与 tarball 的数字（301 个 map、1.6 MB）来自目录列表，不是 `npm pack --dry-run` 的输出。

### 本评审不决定什么

本评审没有改动任何代码。这份 P1 清单是工作单，不是发版裁决：每一条都要有自己的改动和回归测试；两处文档问题（G9、E6）还要先决定是契约错还是代码错。发版同步（`development` 在 `0.23.0`，`main` 在 `0.23.1`）属于运维跟进，不是评审发现。

这份文档是证据，不是权威。它和代码冲突时，代码赢。
