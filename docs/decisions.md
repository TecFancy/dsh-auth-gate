# Decisions

本插件重大决策的编号索引。每条记录按状态放在
[`docs/decisions/{proposed,implemented,archived}/`](decisions/) 下，双语（`.zh.md`/`.en.md`）
成对；本页只有一句话摘要 + 链接，细节与取舍看记录本身。约定见
[`docs/decisions/README.md`](decisions/README.md)。

> 注：M1–M3 的冻结决策表（D1–D16 / M1–M22 / P1–P26）是阶段执行契约，仍以
> `docs/implemented/impl-mN.md` 为准；本索引从 2026-08-30 起收录「为什么层」记录，已实施的
> 重大决策按精选策略回填登记。

## D1. 认证门失败即关闭（fail-closed）

守卫在凭证无法确认时恒 deny（服务缺失、解析失败均按无凭证处理），失败在日志中响亮。
**替代方案**：服务缺失时放行（fail-open）；服务就绪后才挂门。**为什么**：误锁可人工解开，
误放无法追回。
→ [zh](decisions/implemented/2026-08-30-fail-closed-auth-gate.zh.md) ·
[en](decisions/implemented/2026-08-30-fail-closed-auth-gate.en.md)（回填自 M2/M3）

## D2. 守卫包装 webServer，不 fork

插件内包装 webServer 四类入口 + 启动自检（fail loud），不改 dsh web 宿主。
**替代方案**：fork dsh-web-app；靠路由注册顺序；不做自检。**为什么**：包装是最小侵入面，
自检把「静默未挂门」变成「启动即失败」。
→ [zh](decisions/implemented/2026-08-30-guard-wrap-seam.zh.md) ·
[en](decisions/implemented/2026-08-30-guard-wrap-seam.en.md)（回填自 M1）

## D3. scrypt 参数随哈希存储，验证按存储值重派生

`node:crypto` scrypt + 参数随哈希存储，升级参数不使存量哈希失效，验证侧恒时比较。
**替代方案**：bcrypt/argon2（引进依赖）；只认当前模块常量（升级即全员失效）。
**为什么**：免依赖 + 加固成为滚动变更。
→ [zh](decisions/implemented/2026-08-30-scrypt-portable-params.zh.md) ·
[en](decisions/implemented/2026-08-30-scrypt-portable-params.en.md)（回填自 M3）

## D4. 退出按钮槽位 order 可配置

`logoutOrder` 配置项（默认 1000），经 `/auth/status` 透传 client 半边。
**替代方案**：固定常量；运行时自动探测最大 order。**为什么**：显式旋钮比探测更可预期。
→ [zh](decisions/implemented/2026-08-30-configurable-logout-order.zh.md) ·
[en](decisions/implemented/2026-08-30-configurable-logout-order.en.md)（回填自 v0.10.0）

## D5. src 分层 + 跨 slice 只走 barrel

`gate/`/`session/` 核心机制层 + `features/{token,password,proxy}` + `shared/` 叶子层，
跨 slice 唯一 barrel 入口，feature 同层互禁；verify 链新增 slice/bundle/no-emdash/build 门禁。
**替代方案**：完整 FSD；保持平铺；session 作 feature slice（执行中被边界检查否决，降层）；
轻量 ADR 制度（被官方实践否决）。**为什么**：层匹配依赖图，机器约束防回潮。
→ [zh](decisions/implemented/2026-08-30-layered-src-with-barrels.zh.md) ·
[en](decisions/implemented/2026-08-30-layered-src-with-barrels.en.md)（2026-08-30 实施）

## D6. TOTP 两段式登录采用无状态挑战 cookie

密码通过后发短 TTL 挑战 cookie（无服务端状态），验证码通过才发正式会话并同帧清零。
**替代方案**：内存 pending 会话；挑战页重提交密码；签名挑战令牌。**为什么**：
中间态压成浏览器状态，服务端零存储、重启无感，安全边界仍在验证码本身。
→ [zh](decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.en.md)

## D7. TOTP 三态配置，默认 off

`totp: "off" | "optional" | "required"`，默认 `"off"`（升级零惊扰）。
**替代方案**：布尔开关；默认 optional；仅按用户手工开挖。**为什么**：三态覆盖
升级兼容、渐进启用、强制基线三种场景。
→ [zh](decisions/implemented/2026-08-30-totp-config-off-by-default.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-config-off-by-default.en.md)

## D8. M3 遗留评估项维持不实施

revokeBySubject / 登录 CSRF token / 限速与防重放持久化，M4 再评估后全部**维持不做**
（各留 TODO(auth-m5)）。**替代方案**：gate 路径现读用户文件；新增 CSRF token；
状态落盘。**为什么**：收益在单门模型下边际递减，现状与局限均已文档化，
「评估后明确不做」即是 M3 契约要求的收尾。
→ [zh](decisions/implemented/2026-08-30-totp-disposition-of-m3-leftovers.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-disposition-of-m3-leftovers.en.md)

## D9. TOTP 独立 slice，能力经根装配注入 password

`features/totp/` 与 token/password/proxy 并列；password 不 import totp，由 index.ts
把 verifyTotp/replayCheck/clock 注入 deps。**替代方案**：TOTP 放 shared；
直接同层互引；全写进 password。**为什么**：保持依赖图清晰 + slice:check 守护，
注入复用 M3 既有模式。
→ [zh](decisions/implemented/2026-08-30-totp-slice-and-injection.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-slice-and-injection.en.md)

## D10. TOTP 挑战 cookie 加 HMAC 签名（取代 D6 的「不签名」）

挑战 cookie 值加第三段 MAC（HMAC-SHA256，进程级随机密钥，无新配置/依赖）：伪造 cookie
不再能跳过密码阶段。D6 的其余决定（无状态、TTL 300s、SameSite=Lax）不变；代价是重启/
插件重载后在途挑战失效（≤5 分钟，README 已写明）。**替代方案**：维持不签名只文档化；
服务端 pending 挑战。**为什么**：「跳过密码」把 TOTP 从第二因素降成唯一因素，单门公网
不可接受；进程级 HMAC 与内存限速/防重放同一寿命模型。
→ [zh](decisions/implemented/2026-08-30-totp-signed-challenge-cookie.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-signed-challenge-cookie.en.md)
