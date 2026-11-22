# 决策记录

[English](decisions.md)

这个插件做过的编号决策，D1 到 D40。**这一页是兼容表，不是活索引。** 决策本身在
[`.agents/notes/`](../.agents/notes/) 里，一条决策一条笔记，笔记树就是索引：按 lifecycle 和 class 目录浏览，或在仓库里搜索。

这张表只为一件事存在：代码注释和更早的文档按编号引用决策（`D31`），那个引用必须一直能解析。每条笔记在 `Legacy ID:` 行带着同一个编号，所以 `git grep D31` 同时找到引用和笔记。

新决策通常不再编号。它得到一条笔记，放在与它状态匹配的 lifecycle 目录里，笔记的路径就是它的身份。

| # | 决策 | 状态 | 笔记 |
| --- | --- | --- | --- |
| D1 | 认证门失败即关闭（fail-closed） | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-fail-closed-auth-gate.zh.md) |
| D2 | 守卫包装 webServer，不 fork | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.zh.md) |
| D3 | scrypt 参数随哈希存储，验证按存储值重派生 | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.zh.md) |
| D4 | 退出按钮槽位 order 可配置 | implemented | [note](../.agents/notes/implemented/feature/2026-08-30-configurable-logout-order.zh.md) |
| D5 | src 分层 + 跨 slice 只走 barrel（已归档，被 D30 取代） | archived | [note](../.agents/notes/archived/architecture/2026-08-30-layered-src-with-barrels.zh.md) |
| D6 | TOTP 两段式登录采用无状态挑战 cookie | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-two-stage-challenge-cookie.zh.md) |
| D7 | TOTP 三态配置，默认 off | implemented | [note](../.agents/notes/implemented/feature/2026-08-30-totp-config-off-by-default.zh.md) |
| D8 | M3 遗留评估项维持不实施 | implemented | [note](../.agents/notes/implemented/simplification/2026-08-30-totp-disposition-of-m3-leftovers.zh.md) |
| D9 | TOTP 独立 slice，能力经根装配注入 password | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-slice-and-injection.zh.md) |
| D10 | TOTP 挑战 cookie 加 HMAC 签名（取代 D6 的「不签名」） | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.zh.md) |
| D11 | 认证 HTTP 端点公共件独立成 http 层（已归档，被 D30 取代） | archived | [note](../.agents/notes/archived/architecture/2026-09-13-http-endpoint-layer.zh.md) |
| D12 | 宿主要求声明 + storage-domain 转 peer | implemented | [note](../.agents/notes/implemented/process/2026-09-14-host-requirement-declaration.zh.md) |
| D13 | PWA manifest 列入免守卫公开静态路径 | implemented | [note](../.agents/notes/implemented/feature/2026-09-18-public-static-manifest.zh.md) |
| D14 | 身份块 host 走 publicHost 配置（空值回退请求头 Host） | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-public-host-identity.zh.md) |
| D15 | 登录页视觉语言：冷中性检查点卡 | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-login-page-identity-redesign.zh.md) |
| D16 | 示例域名一律用 example.com（真实部署域名不随包发布） | implemented | [note](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.zh.md) |
| D17 | `dsh-auth-proxy` 的 `--target` 改必填（不再有默认上游） | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-required-proxy-target.zh.md) |
| D18 | 随包技能保持单文件 SKILL.md（不启用 references/） | implemented | [note](../.agents/notes/implemented/process/2026-09-22-single-file-bundled-skill.zh.md) |
| D19 | 限速桶的客户端身份改走受信反代头（`clientIpHeader` + `trustedProxyCidrs`） | implemented | [note](../.agents/notes/implemented/architecture/2026-09-22-trusted-proxy-client-ip.zh.md) |
| D20 | 登录失败渲染登录卡片（HTML），不再返回裸文本页 | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-login-failure-html-card.zh.md) |
| D21 | token 模式登录失败渲染登录卡片（HTML），不再返回裸文本页 | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-token-failure-html-card.zh.md) |
| D22 | 设置面板自助改密：POST /auth/password，写盘成功后全踢会话 | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.zh.md) |
| D23 | 口令策略（≥14 位四类字符）与 users.yaml 变更面（独立锁 + CAS） | implemented | [note](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.zh.md) |
| D24 | 改密后的去向、登录页原因提示，与设置导航身份（文案/order/图标） | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-post-change-redirect-and-nav-identity.zh.md) |
| D25 | 管理员重置口令与强制改密登录门 | implemented | [note](../.agents/notes/implemented/feature/2026-09-24-admin-password-reset.zh.md) |
| D26 | 宿主走廊扩到 0.2.x：engines 与 storage-domain peer 同时声明 `^0.2.0-rc.1` | implemented | [note](../.agents/notes/implemented/process/2026-09-29-dsh-020-host-corridor.zh.md) |
| D27 | 守卫 unwrap 逐条回滚，不按快照整表还原 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-11-guard-unwrap-per-entry.zh.md) |
| D28 | 宿主走廊末尾改用下界：两处声明 `>=0.2.0-rc.1`，不再随宿主换线追加 | implemented | [note](../.agents/notes/implemented/process/2026-10-07-host-corridor-floor.zh.md) |
| D29 | 跨站顶层导航先回一张同源弹回页 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-13-cross-site-navigation-bounce.zh.md) |
| D30 | host 半边进 `src/host/` 用 FSD 下三层，client 半边用 FSD 分层 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-12-fsd-host-and-client.zh.md) |
| D31 | `/auth/*` 路径与载荷形状收进跨半边契约 `src/protocol/` | implemented | [note](../.agents/notes/implemented/architecture/2026-10-16-cross-half-protocol.zh.md) |
| D32 | 未配置实例认 launch token 进首次配置向导，配置成立即关窗 | implemented | [note](../.agents/notes/implemented/feature/2026-10-26-first-run-launch-bootstrap.zh.md) |
| D33 | 守卫同时支持 handler 与 DSH 0.2.2 的 resource 路由 | implemented | [note](../.agents/notes/implemented/architecture/2026-11-06-guard-resource-routes.zh.md) |
| D34 | 匿名使用统计：放行后惰性上报，默认开、可见可关 | implemented | [note](../.agents/notes/implemented/feature/2026-11-06-anonymous-usage-telemetry.zh.md) |
| D35 | 通行密钥（passkey / WebAuthn）作为口令之外的第二登录方式 | implemented | [note](../.agents/notes/implemented/feature/2026-11-11-passkey-login.zh.md) |
| D36 | 市场卡片截图由仓库根 `screenshots.json` 声明，并挂一道门禁 | implemented | [note](../.agents/notes/implemented/process/2026-11-16-market-card-screenshots.zh.md) |
| D37 | 放行后问一次宿主，不认就重铸它的浏览器 cookie | implemented | [note](../.agents/notes/implemented/bug-fix/2026-11-16-host-cookie-rebridge.zh.md) |
| D38 | 只允许通行密钥登录（passkey-only）是实例级配置，不是账号级开关 | implemented | [note](../.agents/notes/implemented/feature/2026-11-16-passkey-only-login.zh.md) |
| D39 | 登录限速改为受理制：同步预留名额、按认证域分桶、退避跨锁升级 | implemented | [note](../.agents/notes/implemented/architecture/2026-11-22-admission-based-rate-limiting.zh.md) |
| D40 | 凭证变更撤销会话，含 CLI 改密路径（`password_changed_at` + 周期扫描） | implemented | [note](../.agents/notes/implemented/bug-fix/2026-11-22-credential-change-session-revocation.zh.md) |

笔记系统的规则（生命周期、分类、正文骨架、归档）见 [`.agents/notes/README.md`](../.agents/notes/README.zh.md)。
