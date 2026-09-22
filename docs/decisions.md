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

## D11. 认证 HTTP 端点公共件独立成 http 层

token/password 重复的端点件（logout/status/兜底/Method 守卫）抽进新核心机制层
`src/http/`（与 gate、session 并列，经 barrel 引用），`shared` 保持叶子层不变。
**替代方案**：下沉 `shared`（破坏叶子约束，或得把 cookie 构造当参数注入）；
塞进 `session`（methodNotAllowed 与会话无关）；保持重复（改一处得记得另一处）。
**为什么**：去重只有这一条依赖方向干净的落点，slice:check 加白名单即可守护。
→ [zh](decisions/implemented/2026-09-13-http-endpoint-layer.zh.md) ·
[en](decisions/implemented/2026-09-13-http-endpoint-layer.en.md)

## D12. 宿主要求声明 + storage-domain 转 peer

顶层 `engines.dsh` 声明宿主走廊 `^0.1.0-rc.6 || ^0.1.5-rc.2`；
`@deepseek-ai/dsh-storage-domain` 从 `dependencies` 移到 `peerDependencies`
（同范围，devDependencies 留一份给本仓构建/测试），运行时不带副本。
**替代方案**：只加 engines 而依赖字段不动（嵌套旧线副本留在进程里）；范围只写
`^0.1.5-rc.2`（对 0.1.2-alpha/0.1.5-rc.1 假报低于下限）或只写 `^0.1.0-rc.6`
（严格语义下匹配不到当前宿主，市场打假警告）；放 `dsh.engines.dsh`（顶层才是
官方位置，同时存在时市场只认顶层）。
**为什么**：`||` 让两条走廊在严格 semver 下都成立，dev 走廊与生产宿主都覆盖；
交给宿主后 pnpm 不再装第二份 domain 契约，插件随宿主升级。
→ [zh](decisions/implemented/2026-09-14-host-requirement-declaration.zh.md) ·
[en](decisions/implemented/2026-09-14-host-requirement-declaration.en.md)

## D13. PWA manifest 列入免守卫公开静态路径

浏览器抓 manifest 按规范不带凭证（Chromium 仅 `crossorigin="use-credentials"` 才带上），
cookie 门永远认不出 → 登录后恒 401。`guard.ts` 加精确白名单
`PUBLIC_STATIC_PATHS = ["/manifest.webmanifest"]` + `isPublicStaticPath(kind, pathname)`
（upgrade 不算），两个门共用。
**替代方案**：Caddy 直答/托管（内容双份、路径随 dsh 版本腐化、只修一台）；
改 dist 的 `<link>` 加 `crossorigin`（改官方产物，升级即覆盖）；放行整个 `/assets`
前缀（公开面过大）；加 `publicPaths` 配置项（违背 M4/P12 冻结决策）。
**为什么**：manifest 只含应用名/图标/显示模式，与 `/auth` 同属「不认证也必须可达」；
精确匹配 + 排除 upgrade 让新增攻击面只有一个只读 GET，白名单只有一处。
→ [zh](decisions/implemented/2026-09-18-public-static-manifest.zh.md) ·
[en](decisions/implemented/2026-09-18-public-static-manifest.en.md)

## D14. 身份块 host 走 publicHost 配置（空值回退请求头 Host）

反钓鱼身份块原读 `req.headers.host`，半外壳反代把 Host 改写成 `127.0.0.1:3080`，
远程用户看到回环地址。新增 `publicHost` 配置 + `resolvePublicHost()`（配置优先、
空值回退 Host 头），三个变体的渲染点统一走它，只影响展示、不参与鉴权。
**替代方案**：读 `X-Forwarded-Host`（可伪造，违背 P10 不读 XFF）；改反代透传 Host
（牵动 loopback 栅栏与 launch-token 桥，属于动生产）；只写文档（反钓鱼等于失效）。
**为什么**：运营侧配置是唯一既不可被请求伪造、又不动生产拓扑的来源；空值回退让
现有部署行为零变化。
→ [zh](decisions/implemented/2026-09-22-public-host-identity.zh.md) ·
[en](decisions/implemented/2026-09-22-public-host-identity.en.md)

## D15. 登录页视觉语言：冷中性检查点卡

保留反钓鱼身份块，视觉从「暖纸色工具站」改为冷中性 + 柔和层次 + 发丝分隔线，域名升为
视觉主角（22px + 中性标记）；grok-4.6 三路候选（编辑式排印 / 柔和层次 / 检查点控制台）
在隔离实例真实渲染对比后，取 B 打底 + A 的分隔线 + C 的域名强调。
**替代方案**：保持 09-17 观感（主人反馈「有点复古」）；回上游品牌蓝 + 盾牌 logo
（削弱反钓鱼语义）；通用 SaaS 现代风（无差别、AI 味重）；只取三候选中的单一路线。
**为什么**：层次与过渡解决观感，分隔线建立信息分区，域名强调把身份块立回视觉锚点，
正好服务这个页面的安全职责；取舍过程留档可查。
→ [zh](decisions/implemented/2026-09-22-login-page-identity-redesign.zh.md) ·
[en](decisions/implemented/2026-09-22-login-page-identity-redesign.en.md)

## D16. 示例域名一律用 example.com（真实部署域名不随包发布）

真实部署域名从文档、部署样例、测试与代码默认值中移除，统一写 `dsh.example.com`
（隔离实例 `dsh-test.example.com`），`dsh-auth-proxy --target` 默认值随之改为保留域名；
规则写进开发约定。（后续 D17 移除了该默认值：`--target` 改必填。）
**替代方案**：只改文档、保留默认值（仍随 `lib/` 发到 npm）；`--target` 改必填（CLI 行为
变更，另议）；加门禁脚本扫描（脚本自身得写下被禁字符串，等于放进仓库）；重写 git 历史。
**为什么**：RFC 2606 保留域名永不指向真实服务，规则一眼可验；顺带修掉「公开包默认把
流量导向作者生产环境」这个真实缺陷。
→ [zh](decisions/implemented/2026-09-22-example-domain-in-examples.zh.md) ·
[en](decisions/implemented/2026-09-22-example-domain-in-examples.en.md)

## D17. `dsh-auth-proxy` 的 `--target` 改必填（不再有默认上游）

`--target` 缺参数即抛 `--target is required`、打印用法并退出 1，不连接任何上游；USAGE 里不再带
方括号，文档配置表的「默认」一列写「必填」，D16 留下的保留域名默认值随之移除。
**替代方案**：保留 `example.com` 默认值（默认行为无意义，报错远离病因）；只改文档写明必须显式传；
从环境变量取默认（多一条隐式来源）；从 `publicHost` 推断（越过 D14 划定的展示边界）。
**为什么**：上游 origin 只有调用方知道，没有可推断的默认值；必填让「忘传」得到一条可直接处置的
报错，而不是远端 TLS 错误，与仓库 fail-closed 纪律一致。
→ [zh](decisions/implemented/2026-09-22-required-proxy-target.zh.md) ·
[en](decisions/implemented/2026-09-22-required-proxy-target.en.md)
