# D25. 管理员重置口令与强制改密登录门

## 决定了什么

只新增两条管理端点（仅 password 模式注册），并把 P1 预留的 `must_change_password` 变成真正的
登录门。口令模式的路由模型变为 **1 prefix + 6 exact**，token 模式仍是 3 exact。

1. **`GET /auth/users`（admin 列表）**：无会话 `401`；有会话但非 admin **或受限会话** `403`；
   成功 `200 {"users":[{"name","role","disabled","totpEnabled","mustChangePassword"}]}`，按
   `name` 字典序（既有 `compareNames`）。**字段白名单**（键集合相等）：不分页、不 ETag、不返回
   哈希/盐/scrypt 参数/会话数/最近登录时间；字段缺失不得 500。`cache-control: no-store` +
   `pragma: no-cache`。`/auth/users` **不**逐条审计（噪声）。
2. **`POST /auth/users/password`（admin 重置他人口令）**：urlencoded 字段 `target`（**只认
   body**，query 里的 `target` 一律忽略）、`password`、`confirm`、`code`（**actor 自己的** TOTP，
   只在 actor 自己启用 TOTP 时要求；actor 未启用却带了 `code` 则**忽略**，写死不报 400，码仍不
   进日志）。成功 `200 {"ok":true,"sessionsRevoked":boolean}`。
3. **处理顺序（硬约束，逐条可断言）**：`405` → `415/413`（复用既有 form-body 解析与上限）→
   **Origin / `Sec-Fetch-Site`** → 会话 `401` → **非 admin `403`**（每请求现读 `users.yaml` 的
   `role === "admin" && !disabled`，绝不信会话缓存）→ **受限会话 `403`** → 管理限流桶 →
   现读 users → **目标名合法性 `400`**（复用 CLI 同一套 `USERNAME_RE`，不触盘）→ **目标不存在
   `404`** → **`target === actor` `403`**（放在 TOTP 之前，避免自砸 30 秒窗口）→ **策略 `400`**
   （复用 `password-policy.ts`，含 `≠旧口令`，用目标现哈希验一次；**策略在 TOTP 之前**，口令
   不合规不该吞掉一枚验证码）→ **条件式 TOTP `401`**（actor 启用才验；错误/同窗重放不写盘，
   复用登录同一个 `TotpReplayGuard` 单例 + consume-on-verify）→ **锁内 RMW 写盘**
   （`mutateUsersFile`：置 `must_change_password: true`；**`totpSecret` 字节不动**；不参与
   last-admin 判定）→ **吊销目标全部会话（不含 actor）** → **清目标登录锁定桶 + 目标自助改密桶**
   → `200` + 审计。
   次序理由：Origin 放在 405/415 之后、401 之前（缺 Origin 的已认证脚本应当是 403，不是假 401；
   畸形 body 不必先做 CSRF 判定）；非 admin 403 在 404 之前（否则非 admin 能靠 404 探存在性）；
   限流在 403 之后（普通人不能给 admin 桶灌 429）。
4. **强制改密登录门（受限会话）**：验密 + TOTP 通过后，若该用户 `must_change_password === true`
   ⇒ 签发 `kind: "password-change-only"` 会话（TTL **15 分钟**、不续期；cookie 名/属性/路径与
   正式会话完全一致），并 `302 /auth/password`（**忽略 `next`**）；无标记 ⇒ 正式会话。
   **登录失败（错口令 / 错 TOTP）对有标记与无标记用户不可区分**（验密前不泄漏标记）。
   受限会话允许集写死：`GET`/`POST /auth/password`（POST 仍必须带 `current`）、
   `GET /auth/status`（只含自身字段）、`POST /auth/logout`（必须允许，否则 TTL 前无法换人）；
   `GET /auth/login` → `302 /auth/password`；`POST /auth/login` → `403`（先登出再登录）；
   `/auth/users*` → 进 handler 后 `403`（**不是** gate 302）；宿主 `/api`、静态资源、`/plugins`、
   WS 升级全部 deny（导航 `302 /auth/password`，API `401`，WS 拒握手）。
   **Gate 只信 `session.kind`**，禁止每请求读 yaml 的 live 标记来决定放行/降权（否则「清标记 +
   revoke 失败」会把受限 cookie 升成 full）。导航 vs API 用 `Sec-Fetch-Mode: navigate` /
   `Sec-Fetch-Dest: document` 判定，**不得再用 `Accept` 子串匹配**。
   受限会话的自助改密走 **P1 自助改密桶**，不因「已登录」免限流。
5. **`GET /auth/password`（归并，不新增路由）**：有会话（full 或 restricted）→ `200` 服务端
   渲染的**无 JavaScript 改密表单**（零外链：CSS 内联、不引用宿主静态或 `/plugins`、无
   `<script>`；字段 `current`/`password`/`confirm`/`code`；`autocomplete="new-password"`；
   **不回填任何 `value`**；隐藏字段 `nav=1`；`Referrer-Policy: no-referrer`；
   `cache-control: no-store` + `pragma: no-cache`；`notice` query 只认白名单值
   `password-changed`）。**未认证 → `302 /auth/login?next=/auth/password`（唯一语义）**：
   不得在该 URL 渲染登录页，也不得对浏览器导航回 401（否则受限闭环断裂）。
6. **`POST /auth/password`**：既有 P1 自助改密语义不变（含「必须带 `current`」），仅新增
   Origin 校验与响应整形：**仅当隐藏字段 `nav=1` 时**成功回 `302 /auth/login?notice=password-changed`，
   否则回既有 `200 {"ok":true}`。**`allow: GET, POST`**（契约修订：P1 的 `405 / allow: POST`
   改为本行）。`next` 与 `Location` 一律只接受站内相对路径（以 `/` 开头、非 `//`、无反斜杠、
   无 scheme）。
7. **`GET /auth/status` 加法扩展**：保持 `no-store`、cookie-only、token 模式不变；已认证时在既有
   `{authenticated, logoutOrder}` 上**追加** `name`、`role`、`disabled`、`totpEnabled`（bool，
   **绝不含 secret**）、`mustChangePassword`、`sessionKind`（`"full" | "password-change-only"`）；
   未认证、subject 已不在 `users.yaml`、或该文件读取失败 → **只回既有两字段且键集合相等**（禁止多出
   `role:null` 之类，不泄漏存在性；yaml 坏掉也不能把一次 status 探测变成 500）。**不新增
   `/auth/me`**：同一权限级别下 `/auth/status` 已能承载。
8. **Origin / `Sec-Fetch-Site`（fail-closed）**：只作用于两条已认证状态变更 POST
   （`/auth/users/password`、`/auth/password`）。`Sec-Fetch-Site: same-origin` 放行；或 `Origin`
   与 `resolvePublicHost(publicHost, req.headers.host)` 解析出的对外来源**精确匹配**放行。
   `publicHost` 带 scheme 就原样使用；只写 `host[:port]` 时，scheme 由**连接本身是否为 TLS** 推导，
   所以「TLS 终止在反代后面」的部署应写成 `https://host`（否则走 `Origin` 通道的脚本会被 403；
   浏览器自带 `Sec-Fetch-Site: same-origin`，不受影响）。
   **`publicHost` 未配置时不得用 `Host` ↔ `Origin` 比对放行**，只信 `Sec-Fetch-Site: same-origin`；
   `Origin: null`、子域、same-site-but-not-same-origin → `403`；两者都缺 → `403`；
   **不给脚本开豁免**（curl 必须显式带 `Origin`）。
9. **审计（只走结构化日志）**：成功 `audit.user.password_reset`；拒绝/失败
   `audit.user.password_reset.denied`。`reason` 枚举不合并语义：`self`、`forbidden`、`bad_origin`、
   `bad_target`、`not_found`、`bad_reauth`、`policy`、`rate_limited`、`io`；无 cookie 的 401 用
   `unauthenticated` 并降噪（扫描器会灌爆）。字段 `ts`/`actor`/`target`/`clientIp`/`ok`/`reason`/
   `reauth`/`sessionsRevoked`/`targetDisabled`；**禁止**口令、`code`、哈希。不新建 audit 文件、
   不往 `users.yaml` 追加审计行。
10. **限流**：新独立桶（key = actor subject + clientIp），不与登录桶、自助改密桶共用；成功清
    **目标**的登录桶与自助改密桶（无论 `sessionsRevoked` 真假）；失败也计入本桶。
11. **CLI 补 `dsh-auth user enable <name>`**（CLI-only、走 `mutateUsersFile`）：P1 只有
    `user disable`，禁用账号此前只能手改 yaml，补上它才算闭环。

## 背景

P1（0.15.0）已交付自助改密、口令策略（D23）、`users.yaml` 的锁内变更面、`role` 枚举与预留的
`must_change_password` 字段。角色授予只走 CLI，所以管理面被有意限定为「列用户」与「重置他人口令」；
主人 2026-09-24 拍板范围 ①②③④（列表 / 重置 / 面板管理块 / 强制改密门；仅当发起重置的 admin
自己启用了 TOTP 才做条件式再认证），并明确不做 CSRF 双提交 token、撤销失败重试/告警、锁原子认领
与新的 HTTP 提权面。约束：无数据库；插件跑在别人的 web 应用里，**不得把用户 302 进那个应用的
业务页**；客户端半边是单文件 CJS bundle；`lib/` 必须等于干净构建。

分期：本记录的首个交付（PR1）**只做服务端**（两条端点、服务端渲染改密表单、强制改密门）。
设置面板里的管理块属后续的客户端 PR，**不随 PR1 落地**；在它落地之前，管理面就是这两条 HTTP 端点
加 CLI（README 也是按这个事实写的）。

真正难的是「强制改密」这件事本身：插件无法枚举宿主应用的全部入口。任何基于「正常会话 + 逐路径
302 拦截」的做法都要求穷举宿主路由、静态资源、WebSocket 与 `/api`，漏一条就等于没做。受限会话
把这个否定命题变成可证明的：它只被 `/auth` 前缀放行，而宿主 UI 在鉴权层就被关掉。

另一条主线是 CSRF 纵深：管理重置是「改别人的秘密」的高价值状态变更，必须有 fail-closed 的
来源校验；但校验一旦误判就会锁死管理面，所以判定必须保守、只看浏览器明确发送的信号
（`Sec-Fetch-Site`），或在 `publicHost` 明确配置时用精确来源匹配，而绝不用请求头互相「自证」。

## 考虑过的替代方案

- **正常会话 + 全路径 302 强制改密**：漏掉任何一条路径（静态资源、WebSocket、宿主 API），带标记
  的会话就能用产品，而插件无法枚举宿主的全部入口；否。
- **新增 `GET /auth/me` 作为客户端身份信号**：多一条路由、多一个鉴权面，而 `/auth/status`
  在同一权限级别已经能返回这些数据；否（复审改判：不新增）。
- **独立的 `/auth/password-change` 页面路由**：多一条 exact 路由、多一个「页面」概念，而
  `GET /auth/password` 可以渲染同一个表单；否。
- **用 `Accept` 子串判定「浏览器导航」**：面板 fetch 的 `Accept` 很杂，会假绿、也会误判 302 与
  401；改用 `Sec-Fetch-Mode` / `Sec-Fetch-Dest`；否。
- **把 Origin 检查扩到 `/auth/login`**：未认证且易锁死，一次误判把所有用户挡在门外；否（残留记档）。
- **对 `disabled` 账号拒绝重置（409）**：会挡住管理重置存在的那个运维救命场景（disable 管
  「能不能用」，口令管「秘密是什么」）；允许重置并审计 `targetDisabled:true`。
- **给脚本开 Origin 豁免（缺 Origin 即放行）**：浏览器跨站 fetch 也能带自定义头，豁免通道必然被
  做成绕过；curl 显式带 `Origin`，文档写死示例；否。
- **`target` 也接受 query**：query 会进日志/历史/Referer，且与 body 冲突时语义不清；只认 body。
- **扩展 API key / 指标面，或写 audit 文件、往 `users.yaml` 追加审计行**：为一个「写入纪律 =
  一个锁文件」的插件再开第二个写面；否。
- **不做 `must_change_password` 门，只提示用户去改密**：重置一个可能已泄露的账号后，用户没有
  任何强制动作，管理重置的安全意义归零；否。

## 为什么这样选

受限会话是闸门唯一能**证明否定命题**的形态（这枚 cookie 除了改密表单哪儿都到不了）：插件自己的
路径全在 `/auth` 前缀下，而闸门本来就白名单 `/auth`，所以受限会话**不需要**给任何宿主路径开
白名单，宿主 UI 直接关闭；`GET /auth/password` 复用既有路径，因此路由只增长两条管理端点。重置
流程保持 P1 的顺序不变量（验凭据 → 写盘成功 → 吊销 → 清 cookie），加两处评审要求的动作：写盘时
给目标打强制改密标记（但不动其 TOTP），吊销失败如实上报 `sessionsRevoked:false` 而不是藏起来。
列表走字段白名单、状态走加法字段，两个方向都不泄漏秘密；授权一律每请求现读 `users.yaml`，让
CLI 的 `role` / `disable` 对已登录 admin 立即生效；审计用结构化日志承载 actor/target/IP 事实，
不发明第二个持久化存储。

## 后果与取舍

- **Origin 校验不覆盖 `/auth/login`**（未认证、失败即锁死全员）：登录路径仍只有 `SameSite=Lax`
  兜底，属如实记录的残留。
- **撤销失败仍 `200`**（带 `sessionsRevoked:false` + `logger.error` + 审计同字段 + UI 明确警告）：
  不重试、不告警（⑥ 不做）。写盘已成功，报失败会让用户以为口令没改成。
- **CLI `user passwd` 不设 `must_change_password`**：运维通道的语义是「直接换掉秘密」，HTTP 重置
  才是「可能被盗号」的路径。
- **重置一个仍 `disabled` 的账号不会让它能登录**（登录路径恒拒 disabled），必须先
  `dsh-auth user enable`；`user enable` 是 P2 顺带补上的缺口。
- **同站子域 CSRF 未收口**（⑤ 不做双提交 token）：Origin 检查是纵深，不是等价替代。
- **锁夺取的 0 字节窗口未修**（⑦ 不做原子认领）。
- 受限会话期间可读 `/auth/status`（含自己的角色）：设计所需，不含他人信息；目标用户名会出现在
  审计日志里（必要、非敏感）。
- **admin 未启用 TOTP 时管理面是单因素**：条件式再认证只覆盖「actor 自己开了 TOTP」的情形，
  用审计与运维纪律承担，生产环境应给 admin 启用 TOTP。
