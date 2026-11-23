# 已知局限，以及背后的机制

[English](known-limitations.md) | 中文

README 里只留了短清单；这里是完整版：每条已知局限、它背后的机制，以及对应的决策记录。

- 禁用用户会阻止**新**登录；**已发**会话由插件周期扫描吊销（`revokeSweepMs`，默认 5 秒内生效；
  设成 `0` 则一直有效到过期）。
- **CLI 改密会让会话延迟失效。** `dsh-auth user passwd` 是独立进程，够不到会话存储：它记录
  `password_changed_at`，插件的会话扫描器在 `revokeSweepMs`（默认 5 秒）内吊销该用户此前的会话，
  插件下次重启时同样生效。Web 面的改密（设置面板自助改密、管理员重置）立即吊销。
- **通行密钥（passkey）的部署前提**：RP ID 从 `publicHost` 派生，必须是域名（不能是 IP、不能带端口），
  且浏览器只在 HTTPS（或 `http://localhost`）下提供 WebAuthn。因此纯 http 内网地址、`http://127.0.0.1:3080`
  直连、以及 `dsh-auth-proxy` 的本地代理模式（`http://127.0.0.1:8443`）都用不了通行密钥；配置不成立时
  插件记 error 日志并按 `passkey: "off"` 处理，口令登录不受影响。
- **通行密钥不是设备绑定**：iCloud Keychain / Google Password Manager / 1Password 等会把私钥同步到云端
  （`BE=1`），平台云账户被攻破 + 本地解锁即可使用，不等价于硬件安全密钥。按 GitHub 的模型，同步 passkey
  仍算满足 2FA；需要「独立第二因子」的环境请设 `passkey: "off"`。
- **通行密钥的计数器只是尽力检测**：`signCount` 默认只存进程内、不随每次登录写盘，重启后回落到
  `users.yaml` 的快照值；同步 passkey 恒为 0，并发使用同一凭据也会制造回退。`passkeyEnforceCounter: true`
  只对设备绑定凭据（`be=false && bs=false`）拒绝，不构成克隆防护承诺。
- **通行密钥的 ceremony 是单进程状态**：begin 的 challenge 存在进程内 Map（TTL 120 秒、上限 1024 条），
  重启或重载插件后在途仪式失效（用户重试一次即可）。多副本/多进程部署需要黏性会话或共享存储，v1 不支持。
- **通行密钥的 begin 有独立配额**：每 IP 每分钟 20 次、全局每分钟 120 次（进程内滑动窗口，重启清零）。
  这是防「匿名方无限建 ceremony 把他人仪式挤出存储」的可用性护栏，不是认证边界。
- **通行密钥不校验 attestation**：`attestation: "none"`，不验证书链、不做 MDS 白名单，因此无法据此判断
  凭据来自哪家厂商或是否被篡改过的认证器型号。需要 attestation 策略的环境不在 v1 范围内。
- **通行密钥没有恢复码**：丢光设备时用口令登录后重新注册；口令也忘了只能由管理员
  `dsh-auth user passwd` 重置。
- **passkey-only（`passkey: "required"`）是实例级策略，且没有应用内的逃生口**：策略写在配置文件里，
  开关它等于改文件加重启，由持有服务器访问权限的人执行。没有账号级变体，因为这道门保护的是整个实例、
  登录用户之间不做隔离。开启前需要知道这几条：
  - **先注册并验证一把通行密钥。** 没有任何可用凭据就打开，等于把所有人锁在门外。插件在启动时能看出
    的问题会记 error 日志，但它无法知道那把凭据在用户设备上是否还能用。
  - **WebAuthn 配置坏掉不会恢复口令登录。** `publicHost`、RP ID 或 origin 不成立时实例保持关闭，
    登录页显示固定原因码（`public-host-missing`、`rp-id-invalid`、`origin-invalid` 等）。修配置，
    或者把 `passkey` 改回 `"optional"` 再重启。
  - **删除最后一把凭据会被拒绝**：HTTP 返回 `400` 且 `reason: "last-credential"`，CLI 需要显式
    `--force`。CLI 读不到插件配置，所以它一律要求 `--force`，而不是去猜。
  - **管理员重置口令不恢复访问。** 重置仍会设 `must_change_password`，但那枚受限会话只能靠登录拿到，
    而登录已被策略挡住。恢复靠上面那条改配置，不是管理面板。
  - **已有会话继续有效。** 策略只拦新会话，和禁用用户同一口径；切换之前签发的会话在过期前仍然可用。
  - **口令哈希会保留**，继续用于凭据变更（注册通行密钥、自助改密、管理员重置）的再认证，只是不能
    用来建立会话。
- **通行密钥的注册/删除需要再认证**：注册必须输入当前口令（启用 TOTP 时还要验证码）；删除最后一把或
  `--all` 同样需要。普通单删只需正式会话 + 同源校验。
- **条件 UI（自动填充）默认关闭**：开启后登录页会把 passkey 放进密码框的自动填充列表；它依赖
  Chrome 108 / Firefox 119 / Safari 16+，不支持或用户取消时静默回退到按钮与口令表单。这个开关是
  passkey 字段里唯一声明成 `.volatile()` 的，所以管理员能在 设置→账号安全 里改，宿主 settings 服务
  会把它写回 profile 的 patch。`passkey` 本身是部署级开关，故意不 volatile：它要有 `publicHost` 与
  HTTPS 才成立，所以只能改配置文件。
- **iOS 第三方浏览器可能不可用**：它们多为 WKWebView，WebAuthn 实验特性未启用；登录页做特性检测，
  不可用时只显示口令表单。
- 登录限速在服务器重启后清零；TOTP 防重放记录同样重启清零（同一 30 秒窗口内用过的
  码在重启后重新可用——需要「重启 + 同窗口窃码」同时发生才能利用）。
- TOTP 挑战态（「密码已过、等验证码」）最长 5 分钟。挑战 cookie 带 **HMAC 签名**
  （进程级随机密钥，ADR D10）：无法伪造以跳过密码阶段。重启服务（或重载插件）后
  在途挑战失效——验证码页上的用户需重新输入密码（窗口 ≤ 5 分钟）；提交时按
  用户当前配置的密钥验证。
- 反代部署时，限速按反代出口地址统计；自助改密（D22）的独立限速桶同样按
  `clientIpHeader` 取客户端地址：未配受信反代客户端 IP 头时，同一主机上所有客户端
  也会共用一个改密桶（与登录的问题同源，见 D19）。
- 设置面板里有「退出登录」按钮：在 设置 → 通用设置 页最下方，文案随语言在
  「退出登录」/ "Sign out" 间切换；`/auth/logout?next=/` 始终可作为兜底。
- 改密的会话吊销发生在**新哈希写盘成功之后**。若吊销这一步失败，改密仍如实报告成功
  （口令已经生效），失败只记 error 日志；此时旧 cookie 会一直有效到会话 TTL 到期。
  管理面阶段（D25）沿用同一形状：管理员重置若吊销失败同样返回 `200` +
  `sessionsRevoked:false`，「吊销失败重试/告警」仍未实现。
- D25 的 `Origin` 校验只保护两条已认证的状态变更 POST（`/auth/password` 与
  `/auth/users/password`），**不覆盖** `POST /auth/login`：未认证的登录路径仍只有
  `SameSite=Lax` 这一层跨站防护，因为那里一次误判会把所有用户锁在门外。
- 被强制改密的用户（`must_change_password`，D25）拿到的是 15 分钟、不续期的受限会话，
  只能访问 `GET`/`POST /auth/password`、`GET /auth/status` 与 `POST /auth/logout`；
  重置一个仍被禁用的账号不会让它登得进来，需先执行 `dsh-auth user enable <name>`。
- 管理重置限速桶的「查锁」与「计失败」是两步，并发在途请求可能在第一次失败被记下之前
  就超过阈值。利用它需要**已经持有管理员会话**（这个桶要防的正是持会话者），且桶键仍按
  上面的客户端 IP 规则取。
- 管理重置在 users 锁内会重新复核 **actor**（被降权/禁用的 actor 得到 `403` 且不写盘），
  但目标侧判定（尤其「新口令不等于旧口令」的策略）用的是**取锁之前**读到的那份快照。
  两个并发的管理写因此可能让一个过期的策略结论落地：第二次写仍会存下新哈希与
  `must_change_password` 标记。两个 actor 本身都是管理员，最坏情形是让目标多改一次口令，
  而不是权限变化。
- 不带会话的 `/auth/users/password` 拒绝请求按 `info` 级审计，target 先剥控制符再截到
  64 字符。因此匿名扫描每请求会写一行日志：这行是 Origin 校验唯一的信号，故保留不删，
  改用「限payload」的方式收敛；若在意体量，请在审计日志侧做去重或保留策略。
- **宿主 cookie 的重铸是补救，不是保证。** dsh 自己还有一层 `dsh-auth-<sha256(authority)>`
  （`SameSite=Strict`，30 天），本插件的门从不检查它。守卫放行一次到 `/` 的顶层导航之后会问
  一次 dsh 的 `connection.requestRejection`，dsh 回 401 就回 `302 /?token=…`。
  这覆盖了反代开始或停止改写 `Host`、换域名或端口、dsh cookie 过期、清站点数据这几种情况。
  覆盖不到的是：没有 `requestRejection` 的 dsh 版本（钩子停用，行为回到从前）、与当前进程
  对不上的启动令牌（多副本且没有粘滞路由）、以及浏览器拒收新签发的 cookie。这几种情况下
  用户看到的仍是 dsh 自己的 `401 dsh web authentication required`；一次性标记 cookie 保证
  代价最多是多一跳，而不是重定向环。只有到 `/` 的顶层 `GET` 导航会被重铸：API 调用、静态
  资源和 WebSocket 升级都不碰，因为重定向修不了它们；已经带着 `?token=` 的请求也不碰，那一跳
  正是宿主在签发 cookie 的地方。
- 管理块属于 **client 半边**（设置 → 账号安全）：依赖宿主 Web 应用的客户端 bundle，bundle 更新后
  需要刷新一次页面才会出现；CLI 与 HTTP 端点在它之外始终可用。
- 非 admin，或受限会话，看不到管理块，但这只是呈现层：服务端对每个管理请求都会现读
  `users.yaml` 的 `role` 与 `disabled` 重新授权，所以用非 admin cookie 直连 `GET /auth/users`
  一样是 `403`。
- 面板的用户列表刻意不含「目标当前是否有活跃会话」（服务端投影按最小字段设计），所以重置成功行
  报告的是吊销是否成功（`sessionsRevoked`），而不是该用户是否正在别处登录。
- 管理面**不允许重置自己**（服务端回 `403 forbidden` 兜底，面板下拉也排除本人）：自己的口令用管理块
  上方的自助表单；管理员若忘记自己的口令，只能走离线通道 `dsh-auth user passwd <name>`。
- 面板重置**不显示也不改动**目标的 TOTP 状态：列表投影刻意不含该信息（只展示 `totpEnabled`
  徽标），重置也不会轮换 `totpSecret`；所以目标丢了验证器时，仍需运维执行
  `dsh-auth user totp disable <name>` 处理。
- 重置成功后的列表刷新会**静默失败**：客户端会再拉一次 `/auth/users` 刷新「需改密」徽标，若这第二次
  请求失败，各行保留旧值，需要运维自行刷新页面；只有首次加载会显式降级（`admin.unavailable`）。
- 审计事件走结构化 logger，而 dsh 0.1.5-rc.2 **不会**把 `ctx.logger` 的 info/error 落盘，因此在该
  版本上，验证只能靠运行侧可观察结果 + 仓内的 in-process 真栈审计测试（32 例，分布在两个审计单测
  套件与三个 P2 集成套件里）。这是日志可见性限制，不是「没有审计」。
- 首次配置向导（`/auth/setup`，从启动链接经 `/auth/bootstrap` 进入）只在实例**未配置**时存在：token
  模式只有在凭据读取成功、且读到空值时才判为未配置；password 模式要求 `users.yaml` 缺失或零用户。令牌
  非空、已有一个用户、credentials 服务缺失、`resolve` 抛错，或者文件不可读，都按「不是未配置」处理，
  维持原来的拒绝。探针每次请求实时判定，另外向导写盘成功后进程内会置 `markedConfigured` 标志，窗口
  立即关闭。
- bootstrap 会话最长 `min(sessionTtl, 3600)` 秒（默认配置下就是 1 小时），`subject = "bootstrap"`，
  只放行 `/auth/*`：其它导航回 `302 /auth/setup`，API 请求回 `401`，WebSocket 升级握手直接拒绝。向导
  完成时先吊销全部 bootstrap 会话再签发正式会话，所以这张票不能重放。
- 引导通道假设单进程。launch token 每个进程启动时各自生成，多副本没有粘滞路由时，`/auth/bootstrap`
  可能落到不认识这枚 token 的进程，按 fail-closed 回落到登录页。
- credentials 服务若缓存已解析的值，向导保存新令牌之后可能仍然返回旧的（空）值。结果页会提示需要重启，
  新令牌在 dsh 重启后成为唯一凭据；窗口本身不受影响，仍然立刻关闭。
- 低于 0.1.2-alpha 的 dsh 没有 `connection.authenticatedUrl`，读不到 launch token，也就没有引导：这类
  实例维持 0.17.4 的行为，只能通过 CLI 配置。
- 本插件只保护 dsh 的网页入口，不能替代服务器层面的安全：请保持服务器系统用户最小权限、
  配置文件私密（`.credentials.yaml` 和 `auth/users.yaml` 创建时即为 `0600` 权限）。

## 宿主 `0.2.3-alpha.2` 及之后

那条宿主线把鉴权搬到了路由表上（不写 `auth` 即要求会话），launch token 也只留在它自己的 token 插件内部。对这个网关的影响：

- **launch-token 桥与宿主 cookie 重铸都停用。** 它们分别建立在 `connection.authenticatedUrl` 与
  `connection.requestRejection` 上，那条线已经删除这两个接缝。登录成功后直接落到 `/`，不再经过
  `/?token=…` 那一跳；宿主那枚 30 天 cookie 也不再由网关铸造。已登录用户照常进得来，因为插件为
  **完整会话**注册了 `connection.authentication` 的 Provider，浏览器侧没有损失；依赖重铸去修过期宿主
  cookie 的部署，在那条线上不再需要它。
- **首次配置向导无法校验 launch token。** 那枚 token 没有任何公开读取接缝，所以
  `/auth/bootstrap?token=…` 一律拒绝。请用 `dsh-auth user add <name> --password-stdin`（password 模式）
  或设置 `DSH_AUTH_TOKEN`（token 模式）建立第一个凭据，再正常登录。`dsh web` 打印的启动链接仍然可用，
  但它只铸宿主自己的 cookie。
- **裸的共享 token `Authorization: Bearer <token>` 在宿主路由上不再放行。** 宿主在包装的 handler
  之前就判完那些路由，而 Provider 只认会话 cookie 与会话 Bearer（共享 token 不是会话，且解析是异步的）。
  脚本应先通过 `POST /auth/login` 登录一次并复用会话 cookie；带 `Authorization` 的请求永远不会被降级成
  匿名，所以失败方向是关闭。
- 插件为 `/auth/*` 注册的路由**刻意**声明 `anonymous`：登录页、向导页与改密页必须在没有宿主会话时可达，
  而它们每一个仍由插件自己的门判定。
- **宿主自己的 Host/Origin 围栏现在跑在所有路由之前，登录页也不例外。** 它只接受宿主
  `trustedHosts`（`dsh web` 的 `--trusted-host`）里列出的 authority；改写 `Host` 或终结到另一个
  域名的反代会拿到 `403`，而且这个 403 发生在门与登录表单之前。那道围栏属于宿主，不属于本插件：
  把 `--trusted-host`（以及反代的 `header_up Host`）配成站点域名，并注意这里的 `trustedProxyCidrs`
  只喂限速器。
- **只有兜底座位会被降级成 `anonymous`。** 不属于本插件、被声明为（或默认）`required` 的宿主路由
  在门之前就回 `401`，所以浏览器导航到那里看到的是宿主的提示，而不是本插件的登录跳转。
