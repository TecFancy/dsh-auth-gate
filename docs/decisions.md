# Decisions

[中文](decisions_zh.md)

The numbered decisions this plugin made, D1 through D40. **This page is a
compatibility table, not a live index.** The decisions themselves live in
[`.agents/notes/`](../.agents/notes/), one note per decision, and the notes
tree is the index: browse its lifecycle and class folders, or search the
repository.

The table exists for one reason: code comments and older documents cite a
decision by number (`D31`), and that citation has to keep resolving. Each
note carries the same number on its `Legacy ID:` line, so `git grep D31`
finds both the citation and the note.

New decisions do not normally get a number. They get a note in the lifecycle
folder that matches their status, and the note's path is its identity.

| # | Decision | Status | Note |
| --- | --- | --- | --- |
| D1 | 认证门失败即关闭（fail-closed） | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-fail-closed-auth-gate.md) |
| D2 | 守卫包装 webServer，不 fork | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.md) |
| D3 | scrypt 参数随哈希存储，验证按存储值重派生 | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.md) |
| D4 | 退出按钮槽位 order 可配置 | implemented | [note](../.agents/notes/implemented/feature/2026-08-30-configurable-logout-order.md) |
| D5 | src 分层 + 跨 slice 只走 barrel（已归档，被 D30 取代） | archived | [note](../.agents/notes/archived/architecture/2026-08-30-layered-src-with-barrels.md) |
| D6 | TOTP 两段式登录采用无状态挑战 cookie | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-two-stage-challenge-cookie.md) |
| D7 | TOTP 三态配置，默认 off | implemented | [note](../.agents/notes/implemented/feature/2026-08-30-totp-config-off-by-default.md) |
| D8 | M3 遗留评估项维持不实施 | implemented | [note](../.agents/notes/implemented/simplification/2026-08-30-totp-disposition-of-m3-leftovers.md) |
| D9 | TOTP 独立 slice，能力经根装配注入 password | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-slice-and-injection.md) |
| D10 | TOTP 挑战 cookie 加 HMAC 签名（取代 D6 的「不签名」） | implemented | [note](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.md) |
| D11 | 认证 HTTP 端点公共件独立成 http 层（已归档，被 D30 取代） | archived | [note](../.agents/notes/archived/architecture/2026-09-13-http-endpoint-layer.md) |
| D12 | 宿主要求声明 + storage-domain 转 peer | implemented | [note](../.agents/notes/implemented/process/2026-09-14-host-requirement-declaration.md) |
| D13 | PWA manifest 列入免守卫公开静态路径 | implemented | [note](../.agents/notes/implemented/feature/2026-09-18-public-static-manifest.md) |
| D14 | 身份块 host 走 publicHost 配置（空值回退请求头 Host） | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-public-host-identity.md) |
| D15 | 登录页视觉语言：冷中性检查点卡 | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-login-page-identity-redesign.md) |
| D16 | 示例域名一律用 example.com（真实部署域名不随包发布） | implemented | [note](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.md) |
| D17 | `dsh-auth-proxy` 的 `--target` 改必填（不再有默认上游） | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-required-proxy-target.md) |
| D18 | 随包技能保持单文件 SKILL.md（不启用 references/） | implemented | [note](../.agents/notes/implemented/process/2026-09-22-single-file-bundled-skill.md) |
| D19 | 限速桶的客户端身份改走受信反代头（`clientIpHeader` + `trustedProxyCidrs`） | implemented | [note](../.agents/notes/implemented/architecture/2026-09-22-trusted-proxy-client-ip.md) |
| D20 | 登录失败渲染登录卡片（HTML），不再返回裸文本页 | implemented | [note](../.agents/notes/implemented/feature/2026-09-22-login-failure-html-card.md) |
| D21 | token 模式登录失败渲染登录卡片（HTML），不再返回裸文本页 | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-token-failure-html-card.md) |
| D22 | 设置面板自助改密：POST /auth/password，写盘成功后全踢会话 | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.md) |
| D23 | 口令策略（≥14 位四类字符）与 users.yaml 变更面（独立锁 + CAS） | implemented | [note](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.md) |
| D24 | 改密后的去向、登录页原因提示，与设置导航身份（文案/order/图标） | implemented | [note](../.agents/notes/implemented/feature/2026-09-23-post-change-redirect-and-nav-identity.md) |
| D25 | 管理员重置口令与强制改密登录门 | implemented | [note](../.agents/notes/implemented/feature/2026-09-24-admin-password-reset.md) |
| D26 | 宿主走廊扩到 0.2.x：engines 与 storage-domain peer 同时声明 `^0.2.0-rc.1` | implemented | [note](../.agents/notes/implemented/process/2026-09-29-dsh-020-host-corridor.md) |
| D27 | 守卫 unwrap 逐条回滚，不按快照整表还原 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-11-guard-unwrap-per-entry.md) |
| D28 | 宿主走廊末尾改用下界：两处声明 `>=0.2.0-rc.1`，不再随宿主换线追加 | implemented | [note](../.agents/notes/implemented/process/2026-10-07-host-corridor-floor.md) |
| D29 | 跨站顶层导航先回一张同源弹回页 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-13-cross-site-navigation-bounce.md) |
| D30 | host 半边进 `src/host/` 用 FSD 下三层，client 半边用 FSD 分层 | implemented | [note](../.agents/notes/implemented/architecture/2026-10-12-fsd-host-and-client.md) |
| D31 | `/auth/*` 路径与载荷形状收进跨半边契约 `src/protocol/` | implemented | [note](../.agents/notes/implemented/architecture/2026-10-16-cross-half-protocol.md) |
| D32 | 未配置实例认 launch token 进首次配置向导，配置成立即关窗 | implemented | [note](../.agents/notes/implemented/feature/2026-10-26-first-run-launch-bootstrap.md) |
| D33 | 守卫同时支持 handler 与 DSH 0.2.2 的 resource 路由 | implemented | [note](../.agents/notes/implemented/architecture/2026-11-06-guard-resource-routes.md) |
| D34 | 匿名使用统计：放行后惰性上报，默认开、可见可关 | implemented | [note](../.agents/notes/implemented/feature/2026-11-06-anonymous-usage-telemetry.md) |
| D35 | 通行密钥（passkey / WebAuthn）作为口令之外的第二登录方式 | implemented | [note](../.agents/notes/implemented/feature/2026-11-11-passkey-login.md) |
| D36 | 市场卡片截图由仓库根 `screenshots.json` 声明，并挂一道门禁 | implemented | [note](../.agents/notes/implemented/process/2026-11-16-market-card-screenshots.md) |
| D37 | 放行后问一次宿主，不认就重铸它的浏览器 cookie | implemented | [note](../.agents/notes/implemented/bug-fix/2026-11-16-host-cookie-rebridge.md) |
| D38 | 只允许通行密钥登录（passkey-only）是实例级配置，不是账号级开关 | implemented | [note](../.agents/notes/implemented/feature/2026-11-16-passkey-only-login.md) |
| D39 | 登录限速改为受理制：同步预留名额、按认证域分桶、退避跨锁升级 | implemented | [note](../.agents/notes/implemented/architecture/2026-11-22-admission-based-rate-limiting.md) |
| D40 | 凭证变更撤销会话，含 CLI 改密路径（`password_changed_at` + 周期扫描） | implemented | [note](../.agents/notes/implemented/bug-fix/2026-11-22-credential-change-session-revocation.md) |

The note system's rules (lifecycles, classes, the body skeleton, archiving) are in
[`.agents/notes/README.md`](../.agents/notes/README.md).
