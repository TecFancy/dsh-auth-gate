# 安全不变量

[English](security.md)

这个插件永远不能破坏的规则。每一条都是**否定式保证**：它说的是什么不能发生，因为这类失败是静默的，而损害不可挽回。代码和测试执行它们；这一页是读者查「有哪些不变量、为什么」的地方。

改守卫、改门、改会话处理、改登录页，或改任何决定「请求是否放行」的东西之前，先读这一页。

## 1. 门失败即关闭

凭证无法确认时，答案是 **deny**，绝不是 allow。

- credentials 服务缺失 → 恒 deny，不是跳过守卫。
- token 或凭证解析失败 → 按「无凭证」处理。
- 无论守卫依赖的服务是否就绪，守卫照常挂载。
- 失败在日志里响亮，在响应里静默：调用方学不到任何原因。

理由是不对称性：误锁可以由运维解开，误放无法追回。

依据：[fail-closed 笔记](../.agents/notes/implemented/architecture/2026-08-30-fail-closed-auth-gate.zh.md)。

## 2. 守卫包装宿主，不 fork 它

插件包装 `webServer` 的四类入口（精确路由、前缀路由、upgrade 路由、fallback 处理器），并在启动时自检。它从不修改 dsh web 宿主。

- 包装是幂等的：第二次包装返回第一次的 unwrap。
- unwrap 逐条回滚，绝不按整表快照还原到别的插件拥有的路由上。
- 启动自检把「门静默没挂上」变成「进程启动即失败」。

依据：[wrap-seam 笔记](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.zh.md)、[逐条 unwrap 笔记](../.agents/notes/implemented/architecture/2026-10-11-guard-unwrap-per-entry.zh.md)。

## 3. 每个入口都被守卫，包括后加的

守卫覆盖它之前注册的路由，也覆盖它之后注册的路由。通过被包装的 `register` 注册的路由，即使注册它的插件后 apply，也受守卫。

`/auth/*` 是唯一刻意的例外：门恒放行它们，因为那是调用方完成认证的入口。

依据：[wrap-seam 笔记](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.zh.md)。

## 4. 跨站顶层导航回一张同源弹回页

门**放行**的跨站顶层导航会收到一张同源弹回页：它发生在门放行之后、放行后的重铸之前（§9）。没有它，dsh 的 `SameSite=Strict` 会话 cookie 在首次导航时不会发送，用户会被拒掉一个他本有权访问的页面。

弹回不是认证绕过：它从同源上下文重新进入同一个门，被拒绝的请求根本到不了它。

降级是刻意接受的：对顶层 `GET` 文档导航，弹回把 dsh 内层 `SameSite=Strict` cookie 降到 `SameSite=Lax` 强度——跨站链接现在会经过一次额外的同源跳转，带着两个 cookie 到达 dsh。外层 `dsh_auth` cookie 本来就会在这些请求上送达，而 dsh 的写操作面无法通过顶层 `GET` 到达。非 `GET` 方法、iframe 和子资源请求保持完整的 `Strict` 行为。

依据：[弹回页笔记](../.agents/notes/implemented/architecture/2026-10-13-cross-site-navigation-bounce.zh.md)。

## 5. 限速的客户端身份只认受信反代头

只有当请求来自 `trustedProxyCidrs` 里的地址时，`clientIpHeader` 才被采信。不受信的 peer 不能靠设一个头来自己选身份。

默认信任列表是回环。反代后面的部署必须同时设这两个选项；只设 `clientIpHeader` 会让限速键落在一个攻击者可控的值上。

依据：[受信反代笔记](../.agents/notes/implemented/architecture/2026-09-22-trusted-proxy-client-ip.zh.md)。

## 6. 凭证变更时撤销会话，不是等它过期

通过 Web 面改密（自助改密或管理员重置）会撤销该用户的全部会话，包括执行改密的那一个；这两条路径同时记录 `password_changed_at`，作为重启后的兜底。

`dsh-auth user passwd` 是独立进程，够不到会话存储：它记录同一个时间戳，插件的会话扫描器在下一轮扫描时吊销**凭证版本更旧**的全部会话——最多 `revokeSweepMs`（默认 5 秒）之后，插件重启后同样生效。会话记录签发时读到的 `password_changed_at`，因此「哈希校验在改密前开始、改密后才签发出会话」的那一条也会被吊销；只比签发时间会把它留下。被禁用的用户，会话在同一扫描周期内失效。从 `users.yaml` 删除的用户会在同一轮
扫描里失去全部会话（bootstrap 会话与内部 `token` subject 豁免）；`dsh-auth user add` 也执行与
Web 写入路径相同的口令策略，CLI 造不出弱口令初始账号。整条机制都靠这轮扫描，所以把
`revokeSweepMs` 设为 `0` 等于关掉它：CLI 路径不再吊销任何会话，只剩 Web 路径立即生效。CLI 会把
这个前提打在提示里；要立即生效，从账号页改密。

依据：[自助改密笔记](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.zh.md)、[口令策略笔记](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.zh.md)。

## 7. 通行密钥本身就是完整登录，passkey-only 关闭口令路径

通行密钥登录同时满足口令因子与 TOTP 策略；`totp` 只约束口令登录。注册凭据、以及删除最后一把凭据，都需要当前口令（账号有密钥时还要 TOTP 验证码），所以会话被劫后既加不了也删不掉后门凭据。

`passkey: "required"` 会为整个实例关闭口令路径：口令分支与 TOTP 挑战分支都在读 `users.yaml` 之前被拒，所以切换之前拿到的挑战 cookie 之后也换不到会话。WebAuthn 配置不可用时**不会**重新打开口令登录；实例保持关闭，登录页显示固定原因。该策略是实例级的，符合这道门的模型（用户之间不做隔离），恢复路径只有一条：在配置文件里把 `passkey` 设回 `"optional"` 并重启。

依据：[passkey 笔记](../.agents/notes/implemented/feature/2026-11-11-passkey-login.zh.md)、[passkey-only 笔记](../.agents/notes/implemented/feature/2026-11-16-passkey-only-login.zh.md)。

## 8. 启动 token 只开第一扇窗，它不是第二把钥匙

dsh 的启动 token（dsh 启动时打印的 `?token=`）只在实例未配置时被采信。一旦令牌或用户存在，`GET /?token=...` 会走到 `/auth/bootstrap?token=...`，该端点回 `302 /auth/login?next=%2F`，既不下发 cookie 也不放行任何东西，所以旧的启动链接不是永久凭证。

它能签发的 bootstrap 会话是有围栏的：最长 `min(sessionTtl, 3600)` 秒、只能到达 `/auth/*`，`/auth/setup` 上的向导完成时即被吊销。只有读取成功且值为空才算未配置；credentials 服务缺失或读取抛错一律按已配置处理、不打开向导，所以磁盘故障开不了门。登录成功后，launch-token 桥只是把普通跳转换成一次相对的 `/?token=` 跳转，让 dsh 签发它自己的浏览器 cookie；桥本身不认证任何东西，它失败时退回普通跳转。

依据：[bootstrap 笔记](../.agents/notes/implemented/feature/2026-10-26-first-run-launch-bootstrap.zh.md)。

## 9. 放行之后，守卫最多重铸一次宿主 cookie

dsh 还有一层浏览器 cookie（`dsh-auth-<sha256(authority)>`，`SameSite=Strict`），这道门从不检查它，所以被放行的请求仍可能撞上 dsh 自己的 `401 dsh web authentication required`。对到 `/` 的顶层 `GET` 文档导航、且 URL 还不带 token 查询时，守卫会通过 `connection.requestRejection` 问 dsh 一次：只有 `401` 才会触发 `302` 到相对的 `/?token=<launchToken>`，并随这次 302 下发一枚一次性标记 cookie。标记还在时不再重铸，所以重铸不成功时留下的是 dsh 自己的 `401`，而不是重定向环。`403` 不重铸，WebSocket 升级也永远不重铸。

依据：[重铸笔记](../.agents/notes/implemented/bug-fix/2026-11-16-host-cookie-rebridge.zh.md)。

## 10. TOTP 挑战 cookie 是签名的

两段式 TOTP 登录把状态放在无状态 cookie 里，那个 cookie 带 HMAC 签名。不签名的挑战 cookie 会让调用方伪造「口令已验证」的状态。

依据：[签名挑战 cookie 笔记](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.zh.md)。

## 11. 口令用 scrypt 哈希，参数随哈希存储

`node:crypto` scrypt，参数记录在存储值里，验证时按存储的参数重新派生。提高成本是滚动变更，不是全员失效。比较是恒时的。

依据：[scrypt 笔记](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.zh.md)。

## 12. 真实部署域名永不进仓库

文档、部署样例、测试、代码默认值和截图一律用 RFC 2606 保留的 `example.com`。发布的 tarball 包含 `lib/`、`docs/demo/` 和 `.agents/skills/`，写进这些地方就等于离开这台机器。

依据：[示例域名笔记](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.zh.md)。

## 13. 发布产物就是构建输出

`lib/` 提交进仓库，CI 在全新构建与它不一致时失败（`git diff --exit-code -- lib`）。从 git 安装的消费者拿到一个不需要构建工具就能用的包，也没有人能手改发布出去的代码。

## 14. 带 Peer 的进程内读由调用方放行
`webServer.readResource(request, peer)` 是宿主内部读取「同一 URL 经 HTTP 会收到什么」的入口。调用方已经放行这个读者，`peer` 就是那次放行。守卫不能对这样的读再认证一次：它不带 cookie，浏览器门只能回 `401`，而读者的权限来自 `Peer`，不是会话。这条旁路不会给进程内调用方任何它本来没有的东西——它已经在宿主进程里。LiveShare 能隔着门提供 owner 的 viewer 页面，靠的就是这条路径。

依据：[peer 读笔记](../.agents/notes/implemented/bug-fix/2026-11-19-peer-reads-admitted-by-caller.zh.md)。

## 15. 刻意不防的东西
这些是已知且接受的，不是疏漏。每一条都有笔记解释取舍：

- **没有登录 CSRF token。** 单门模型没有用户间隔离，唯一影响是会话主体审计值被污染。`SameSite=Lax` 加上现代浏览器的第三方 `Set-Cookie` 限制进一步收窄它。
- **限速不持久化。** 重启清空桶。
- **没有 `revokeBySubject`。** 会话按用户撤销，不按主体。

依据：[M3 遗留项笔记](../.agents/notes/implemented/simplification/2026-08-30-totp-disposition-of-m3-leftovers.zh.md)。

## 执行位置

| 不变量 | 由谁执行 |
| --- | --- |
| 失败即关闭 | `src/host/shared/guard/`、`src/host/features/token/model/`、`src/host/features/password/model/` |
| 包装不 fork | `src/host/shared/guard/guard.ts`、`self-check.ts` |
| 每个入口都被守卫 | `src/host/shared/guard/guard.ts`、`test/integration.*.test.ts` |
| 调用方放行的 peer 读 | `src/host/shared/guard/resource.ts` |
| 跨站弹回 | `src/host/shared/guard/cross-site-bounce.ts` |
| 通行密钥策略 | `src/passkey-wiring.ts`、`src/host/features/passkey/`、`src/host/features/password/model/password-login.ts` |
| 启动 token 与首次引导 | `src/host/features/bootstrap/`、`src/launch-token-bridge.ts`、`src/bootstrap-wiring.ts` |
| 放行后重铸 | `src/host/shared/guard/rebridge.ts`、`src/rebridge-wiring.ts` |
| 受信反代 | `src/host/shared/http/client-ip.ts` |
| 会话撤销 | `src/host/entities/session/`、`src/host/features/password/model/` |
| 签名挑战 cookie | `src/host/features/password/model/challenge-cookie.ts` |
| scrypt | `src/host/features/password/lib/password.ts` |
| 示例域名 | 评审执行，加上 `docs:check` |
| 构建一致性 | `.github/workflows/ci.yml` |

某个版本的入口覆盖证据在 `docs/history/evidence/entry-coverage-*.md`。
