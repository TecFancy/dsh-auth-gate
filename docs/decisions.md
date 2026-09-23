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

## D18. 随包技能保持单文件 SKILL.md（不启用 references/）

配置速查技能正文全部留在 `SKILL.md`，不用 `references/` 子目录；两条测试锁进 CI（技能目录无
`references/`、`Config` schema 里每个配置项都出现在技能正文里）。2026-09-02 的拆分（故障表 +
验证技巧进 references/，主文件 13.9KB→6.5KB）作为超集残留弃用，不再复活。
**替代方案**：按原方案拆分（省显式打开那一次的 ~2.2k tokens，换来 stub 计数腐烂、二次读取与
三份副本的同步面）；按语言拆两份（面板不能选语言，正文必须双语）；单文件压缩正文（删掉的正是
最常查的故障矩阵）；只写约定不加测试。
**为什么**：技能是用户显式打开的低频速查，「打开即得答案」才是它的价值；单文件把同步面从三份
降到一份，并有测试拦住 schema 与技能正文的漂移。
→ [zh](decisions/implemented/2026-09-22-single-file-bundled-skill.zh.md) ·
[en](decisions/implemented/2026-09-22-single-file-bundled-skill.en.md)

## D19. 限速桶的客户端身份改走受信反代头（`clientIpHeader` + `trustedProxyCidrs`）

新增 `clientIpHeader`（默认 `""` = 一个头都不读）与 `trustedProxyCidrs`（默认只信回环
`127.0.0.0/8`、`::1/128`）：只有直连 peer 落在受信集合内才读该头，取「从右往左跳过受信跳后的第一个
合法 IP」，缺失/不可解析/超长则回退 peer 并告警（每类一条）；密码路径与 TOTP 第二段共用同一个取值点。
这是对 P10（「IP 取 `socket.remoteAddress`，不读 XFF」）的**显式例外**：默认语义逐字节不变，配置写错
只会变窄（非法头名 → 不读头；非法 CIDR → 只信回环；`0.0.0.0/0`、`::/0` 一律拒绝），绝不卸载或放宽守卫。
**替代方案**：无条件信任指定的转发头（issue #74 原文；可伪造换桶、定向锁人、灌满 `byIp`）；只按账号
分桶或 `(peer, username)` 组合键（没恢复 per-client 预算，还会掩盖「头没配上」）；默认读 XFF 或取最左
值；缺头即 503（配置笔误变全站登录不可用）；只改文档（继续接受「任何人 5 次错密码全家登不上」）。
**为什么**：与 express `trust proxy` / nginx `real_ip` 同一模型 —— 可信性来自 peer 而不是头本身；
默认配置对所有既有部署零变化；「从右往左跳过受信跳」是 XFF 链唯一安全方向；归一化保证同一客户端
始终落在同一个桶。
→ [zh](decisions/implemented/2026-09-22-trusted-proxy-client-ip.zh.md) ·
[en](decisions/implemented/2026-09-22-trusted-proxy-client-ip.en.md)

## D20. 登录失败渲染登录卡片（HTML），不再返回裸文本页

错凭据（未知用户 / 错口令 / 禁用三态同一）**保持 401**，但 content-type 改为 `text/html`，body 换成
既有登录卡片 + error slot（唯一常量 `Invalid username or password.`）：用户名 HTML 转义后
`value=` 回填（无条件，含未知/禁用，避免枚举侧通道）、密码永不回填、密码框保持 `autofocus`、
两个字段 `aria-invalid`/`aria-describedby="err"`、`<title>` 加 `Error: ` 前缀。锁定**保持 429 +
`retry-after`**，body 换成同一张卡片，文案按「这个网络」陈述并带上静态秒数，提交按钮**不** disabled
（无 JS 仍可重试），不披露剩余次数、不做活倒计时；TOTP 第二段 429 渲染挑战卡。用户名查库前先 trim
（密码不 trim）；失败页带提交守卫脚本（`aria-busy` + `Signing in...`），并在**失败页渲染后**用
`history.replaceState` 把历史项换成 GET，使 F5 不再重放 POST（在 submit 事件里改无效——POST 导航在
处理器返回后才提交；无 JS 仍会重放，如实记录）。
**替代方案**：PRG 303（砸冻结 401、脚本误判成功导航、撞 Chromium 密码管理器指南）；200 重渲染
（Keycloak 形态，破坏 401 契约）；fetch 内联注入（双路径 / CSP / 行为分叉）；独立错误页（新 CSS 撞
6KB 预算、丢反钓鱼身份块）；一次性 form ticket（无 JS 下唯一能关 F5 计次，但与 #81 锁语义耦合，
暂缓）；活倒计时 + disabled（无 JS 永久搁浅，WCAG 2.2.1；NAT 下不诚实）；按 `Accept` 内容协商
（`*/*` 分不开两端）；为合规补 `WWW-Authenticate: Basic`（浏览器原生对话框会盖住卡片，刻意偏离
RFC 9110 §15.5.2 并记录在此）。
**为什么**：这是删掉「空白页死胡同」的最小改动，状态码、常量、不反射规则、日志纪律、无 JS 提交路径、
6KB CSS 预算、切片边界与依赖集合全部不变，且与 0.11.1 起已发布并有测试覆盖的 TOTP 修复同构。
→ [zh](decisions/implemented/2026-09-22-login-failure-html-card.zh.md) ·
[en](decisions/implemented/2026-09-22-login-failure-html-card.en.md)

## D21. token 模式登录失败渲染登录卡片（HTML），不再返回裸文本页

错 token **保持 401**（+ `no-store`），content-type 改 `text/html`，body 换成 token 版登录卡片 + error
slot（唯一常量 `Invalid access token.`，`INVALID_TOKEN`）；令牌字段**永不回填**（回显秘密＝写进页面/
响应缓存/浏览器历史），保持 `autofocus` + `aria-invalid`/`aria-describedby`，`<title>` 加 `Error: `
前缀；反钓鱼身份块照旧按 `publicHost`/Host 渲染（D14）。**刻意不改**：415（表单恒发 urlencoded，浏览器
不可达）与 503（运维故障，用户无从修复，机器可读更有用）；413 也保留 `text/plain` 与 M19
`connection: close` 精确语义（粘贴超 16 KB 可达，但自作自受且无可操作，改卡片要新增文案＋动冻结形状）
—— 记为已知残留。**刻意不加**：D20 的提交守卫脚本 —— token 模式没有失败预算可消耗（无限速器），双击/
刷新都锁不住人；但刷新重放的是**原来那条带原 token 的 POST**（不是卡片上的空字段），所以
`replaceState` 本有卫生价值（别让秘密留在可重放历史项里），只是要动共享页面 API，本次推迟并如实记录。
同趟收尾 TOTP 第二段遗留文案：`rejectTotp` 的 `invalid credentials` → `Invalid or expired code.`
（`INVALID_TOTP_CODE`；同一常量纪律但不复用凭据常量 —— 那时口令已通过，失败手因是验证码）。**取代 D20
里「token mode keeps its `text/plain` 401」一句**（`impl-m3` P14 同句一并修订），D20 其余全部有效。
**替代方案**：维持裸文本 + 写文档（死胡同就是缺陷本身）；303 PRG / 200 重渲染（破坏冻结 401，同 D20）；
专用 token 错误页（新 CSS 撞 6KB 预算 + 丢反钓鱼身份块）；回填提交的 token 帮用户自查（等于把秘密写
进页面/历史/缓存）；TOTP 复用 `INVALID_CREDENTIALS`（手因错位）；413/415/503 一并改 HTML（协议层/运维
层失败，机器可读更有用）。
**为什么**：与 D20 同构的最小改动，状态码、一常量规则、不反射规则、日志纪律、无 JS 提交路径、6KB CSS
预算、切片边界与依赖集合全部不变；真实入口集成测试（`integration.auth.test.ts`）从「只断言状态码」
升级为断言 HTML 失败体，退回 `text/plain` 会在 CI 被拦。
→ [zh](decisions/implemented/2026-09-23-token-failure-html-card.zh.md) ·
[en](decisions/implemented/2026-09-23-token-failure-html-card.en.md)

## D22. 设置面板自助改密：POST /auth/password，写盘成功后全踢会话

已登录用户在设置面板自助改密，服务端只新增一条精确路由 `POST /auth/password`（仅 password 模式
注册，urlencoded：`current` / `password` / `code`）。处理顺序冻结，**先写盘成功、再吊销该 subject
的全部会话（含当前会话）**：写盘失败只回 503 并保留全部会话，绝不出现「全被踢但密码没改」；成功
后清 cookie + `200 {"ok":true}`。TOTP 二次确认共用登录路径的同一 `replayGuard` 单例（同窗
重放判 401 `invalid_totp`，需等下一枚验证码）；独立限速桶（IP + subject，成功即清桶，避免锁人
放大与自锁）。路由模型由「1 prefix + 3 exact」修订为「1 prefix + 4 exact」，M2 规格 M5/M15 行与
正文按惯例加 D22 修订注记。**已知残留**：写盘成功后 `revokeBySubject` 抛错时不重试、仍如实返回 200
（只记 error 日志），极端情况下「新口令已生效但旧 cookie 仍可用」，窗口由会话 TTL（默认 7 天）兜底；
P2 候选 = 撤销失败重试/告警。
**替代方案**：单独改密页 + 302 + form 提交（fetch 会把失败读成成功导航、新页面撞 6 KB CSS 预算）；
只踢其他设备（无法区分哪个会话是攻击者的）；免 TOTP 确认（会话被偷即永久接管）；登录路径强制改密
分流（本期只预留 `must_change_password`）；与登录共用限速桶（DoS 放大器）；改密端点自建
`replayGuard`（同一枚验证码同窗被接受两次）。
**为什么**：最小服务端改动，全部复用生产已验证部件（恒时口令验证、`DUMMY_HASH` 存在性等时、
`LoginRateLimiter`、`TotpReplayGuard` 单例、清 cookie），不加依赖、不开新提权面；顺序硬约束把最糟
的失败模式结构性排除，全踢含当前会话让「改密 = 终点」可断言。
→ [zh](decisions/implemented/2026-09-23-self-service-password-change.zh.md) ·
[en](decisions/implemented/2026-09-23-self-service-password-change.en.md)

## D23. 口令策略（≥14 位四类字符）与 users.yaml 变更面（独立锁 + CAS）

新口令策略独立成 shared 叶子模块 `src/shared/password-policy.ts`：≥14 位 + 四类字符
（`[A-Z]` / `[a-z]` / `[0-9]` / 非字母数字）+ 不得等于旧口令 + `maxLength` 256；**不 trim、不截断、
不做 NFKC**（会作废存量哈希）；规则枚举即 400 `policy` 的 `rules`；校验顺序 = 长度 → 字符类 →
旧哈希（最贵放最后），`sameAsOld` 经注入比较器判定，shared 不依赖 features。
`users.yaml` 的变更收敛到 `mutateUsersFile` 锁内 RMW：独立 `users.yaml.lock`（`wx` 0600 + pid/mtime
陈旧兜底，**绝不锁在会被 tmp→rename 换 inode 的 users.yaml 上**）、写前 mtime/size CAS（≤3 次重跑）、
写前 `.bak`（0600）+ 原子写、`finally` 释放锁、统一 `UsersFileError`、**last-admin 不变量**（变更后
admin 数由 >0 变 0 即拒绝，`disable` / `role demote` 自动受保护）。角色用
`role: "user" | "admin"` 枚举、缺省不落盘（既有 YAML 字节不变）、**授予只走 CLI**
（`user role` / `user add --admin`，不开 HTTP 提权面），`must_change_password` 本期只预留、登录路径
不读。CLI 新增 `user passwd`（禁 `--password` 明文参数；管道读两行、TTY 隐藏回显），既有 `add` /
`disable` 同样改走 `mutateUsersFile`。
**替代方案**：bcrypt/argon2（作废全部存量哈希）；密码历史（schema 与写盘形态变大）；boolean
`admin`（无法表达第三角色、语义藏在字段存在性里）；锁在 `users.yaml` 本身（rename 换 inode 等于
没锁）；无锁直写（并发丢更新 = 静默数据损坏）；只加锁不做写前 CAS（挡不住锁外的编辑器/备份还原）；
引入 SQLite（依赖与迁移成本，体量不需要）。
**为什么**：把「不该静默发生的事」变成显式的、可测试的、机器可读的失败；P1 只做策略 + 锁 + CLI +
自助端点所需公共面，schema 一次定死保证 P2 管理面只加不返工。
→ [zh](decisions/implemented/2026-09-23-password-policy-and-users-lock.zh.md) ·
[en](decisions/implemented/2026-09-23-password-policy-and-users-lock.en.md)

## D24. 改密后的去向、登录页原因提示，与设置导航身份（文案/order/图标）

改密成功后不再停在"死会话"设置面板上：成功文案保留 **2500ms** 后
`location.replace("/auth/login?next=%2F&notice=password-changed")`，按钮由"关闭"改
**「重新登录」**（立即跳 + 清定时器）并自动获得焦点；`GET /auth/login` 用**精确白名单**把
`notice` 映射成编译期常量（独立 `role="status"` 槽、只挂密码卡，TOTP 页/失败页/POST 重渲染
都不带），query 只"选"文案、绝不拼接或回显。设置导航身份改为 id 保持
`dsh-auth-gate-account`（**不抢**宿主 0.1.7 官方云账户的 `account`）、nav 文案
**「账号安全 / Account security」**、`order` 500 → **900**（大于已知全部条目、落在导航靠后，
但不承诺全局最后——宿主排序没有并列决胜）。图标：宿主 `settings.section` 没有 `icon` 选项
（`navIcon(id)` 是宿主硬编码 if 链，第三方段恒为默认齿轮），故**不做**导航行 DOM 增强，自设计
图标（盾 + 钥匙孔）只画在插件自己的内容区，资产见 `docs/demo/account-security.svg`。
**替代方案**：服务端 302（吞掉冻结的 200 JSON）；`location.assign`（死页面留在历史栈/bfcache）；
flash cookie 携带 notice（扩大会话面）；抢 `id: "account"`（0.1.7 双挂载 + 语义错位）；
导航行 `MutationObserver` 替换（与宿主 React 抢 DOM，评审否掉，提案源码留档在 notes）；
order 保持 500（更易撞车，且 `-10 … 20` 之间没有契约空隙）。
**为什么**：改密闭环的最后一跳要"走得了、看得懂、回得来"；所有新文案都是编译期常量 + 白名单
选择，既解释原因又不引入反射面；导航身份的唯一硬约束是**不与宿主官方段撞名撞 id**，而 order
只能声明"大于已知条目"，不能声明"最后"。
→ [zh](decisions/implemented/2026-09-23-post-change-redirect-and-nav-identity.zh.md) ·
[en](decisions/implemented/2026-09-23-post-change-redirect-and-nav-identity.en.md)
