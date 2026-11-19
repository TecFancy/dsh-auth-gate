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

## 4. 跨站顶层导航先回同源弹回页

跨站顶层导航在门做决定之前，先被回一张同源弹回页。没有它，`SameSite=Strict` 的会话 cookie 在首次导航时不会发送，用户会被拒掉一个他本有权访问的页面。

弹回不是认证绕过：它从同源上下文重新进入同一个门。

依据：[弹回页笔记](../.agents/notes/implemented/architecture/2026-10-13-cross-site-navigation-bounce.zh.md)。

## 5. 限速的客户端身份只认受信反代头

只有当请求来自 `trustedProxyCidrs` 里的地址时，`clientIpHeader` 才被采信。不受信的 peer 不能靠设一个头来自己选身份。

默认信任列表是回环。反代后面的部署必须同时设这两个选项；只设 `clientIpHeader` 会让限速键落在一个攻击者可控的值上。

依据：[受信反代笔记](../.agents/notes/implemented/architecture/2026-09-22-trusted-proxy-client-ip.zh.md)。

## 6. 凭证变更时撤销会话，不是等它过期

改密会撤销该用户的全部会话，包括执行改密的那一个。被禁用的用户，会话立即失效。

依据：[自助改密笔记](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.zh.md)、[口令策略笔记](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.zh.md)。

## 7. TOTP 挑战 cookie 是签名的

两段式 TOTP 登录把状态放在无状态 cookie 里，那个 cookie 带 HMAC 签名。不签名的挑战 cookie 会让调用方伪造「口令已验证」的状态。

依据：[签名挑战 cookie 笔记](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.zh.md)。

## 8. 口令用 scrypt 哈希，参数随哈希存储

`node:crypto` scrypt，参数记录在存储值里，验证时按存储的参数重新派生。提高成本是滚动变更，不是全员失效。比较是恒时的。

依据：[scrypt 笔记](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.zh.md)。

## 9. 真实部署域名永不进仓库

文档、部署样例、测试、代码默认值和截图一律用 RFC 2606 保留的 `example.com`。发布的 tarball 包含 `lib/`、`docs/demo/` 和 `.agents/skills/`，写进这些地方就等于离开这台机器。

依据：[示例域名笔记](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.zh.md)。

## 10. 发布产物就是构建输出

`lib/` 提交进仓库，CI 在全新构建与它不一致时失败（`git diff --exit-code -- lib`）。从 git 安装的消费者拿到一个不需要构建工具就能用的包，也没有人能手改发布出去的代码。

## 11. 带 Peer 的进程内读由调用方放行

`webServer.readResource(request, peer)` 是宿主内部读取「同一 URL 经 HTTP 会收到什么」的入口。调用方已经放行这个读者，`peer` 就是那次放行。守卫不能对这样的读再认证一次：它不带 cookie，浏览器门只能回 `401`，而读者的权限来自 `Peer`，不是会话。这条旁路不会给进程内调用方任何它本来没有的东西——它已经在宿主进程里。LiveShare 能隔着门提供 owner 的 viewer 页面，靠的就是这条路径。

依据：[peer 读笔记](../.agents/notes/implemented/bug-fix/2026-11-19-peer-reads-admitted-by-caller.zh.md)。

## 12. 刻意不防的东西

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
| 受信反代 | `src/host/shared/http/client-ip.ts` |
| 会话撤销 | `src/host/entities/session/`、`src/host/features/password/model/` |
| 签名挑战 cookie | `src/host/features/password/model/challenge-cookie.ts` |
| scrypt | `src/host/features/password/lib/password.ts` |
| 示例域名 | 评审执行，加上 `docs:check` |
| 构建一致性 | `.github/workflows/ci.yml` |

某个版本的入口覆盖证据在 `docs/history/evidence/entry-coverage-*.md`。
