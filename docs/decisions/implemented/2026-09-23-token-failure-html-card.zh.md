# D21. token 模式登录失败渲染登录卡片（HTML），不再返回裸文本页

## 决定了什么

错共享令牌**保持冻结的状态码**，但不再返回机器可读的裸文本 body：

- **错 token 的 `POST /auth/login`**：**保持 401** + `cache-control: no-store`，content-type 改为
  `text/html; charset=utf-8`，body 换成 token 版登录卡片、error slot 填唯一常量
  `Invalid access token.`（`INVALID_TOKEN`，由 `src/features/token/auth-endpoints.ts` 导出）。
  令牌字段保持 `autofocus`、加 `aria-invalid="true" aria-describedby="err"`，`<title>` 加
  `Error: ` 前缀（后两项由共享渲染器在 `error !== undefined` 时自动加上）。**提交的 token 永不
  回填**：字段不渲染 `value` 属性（D20 的用户名回填在这里没有对应物 —— 把秘密写回页面、响应缓存
  与浏览器历史是一次泄露，而重试并不需要它）。
- 反钓鱼身份块仍按 `resolvePublicHost(publicHost, host)` 渲染（D14），与 GET 页完全一致，失败页
  不会被误认成「另一个主机上的同一个页面」。
- **刻意不改**：`415`（`parseFormBody` 对非 urlencoded body 的拒绝 —— 表单恒发
  `application/x-www-form-urlencoded`，浏览器走不到）与 `503 "session store unavailable"`（运维
  故障 —— 用户无从修复，机器可读反而更有用）。`413` 同样保留 `text/plain` 与 M19 的
  `connection: close` 精确语义：浏览器**能**通过粘贴超过 16 KB 表单上限的 body 撞到它，但那是自作
  自受且无可操作的状态，改成卡片要新增文案、还要动 M19 冻结的响应形状。**这里如实记为已知残留，
  而不是悄悄改掉**。GET 页与成功后的 `302` 均未触及。
- **刻意不加**：D20 的渐进增强脚本 `SUBMIT_SCRIPT`（提交守卫 + `history.replaceState`）不注入
  token 页。它要解决的危害在令牌模式不存在：没有可被消耗的失败预算（令牌模式没有限速器），双击或
  刷新都锁不住任何人。但要说准**刷新到底重放什么**：F5 重放的是**原来那条 POST，带着原来的
  token**，不是卡片上那个空字段 —— 所以 `history.replaceState` 其实有卫生价值（别让秘密留在可重放
  的历史项里），只是它需要在共享页面 API 上加一个选项。**本次推迟并如实记录**，不塞进这次改动。
- **同一趟收尾 TOTP 第二段文案**：`rejectTotp` 不再渲染遗留的小写 `invalid credentials`，改为
  `Invalid or expired code.`（`INVALID_TOTP_CODE`）—— 同样是单一常量纪律，但**不复用**凭据常量：
  走到这一步口令已经通过，失败的手因是验证码（错码 / 重放 / 账号已无 secret）。文案刻意不区分这
  三种情形。
- **取代** D20 中「token mode keeps its `text/plain` 401」一句，以及
  `docs/implemented/impl-m3.md` P14 里同一句话。D20 的其余内容全部继续有效。

## 背景

Issue #85，0.14.2 实测：错 token 返回 `401` + `content-type: text/plain` + body `invalid token`。
浏览器导航因此渲染出一张白纸：没有卡片、没有错误、`document.title` 为空，除了后退键无路可走。
密码流在 D20（0.14.2，PR #83）之前是完全同样的缺陷，修好后才把 401/429 换成登录卡片；当时刻意
跳过 token 模式，因为 M2 把 token 响应形状冻结为 `text/plain`，P11 又把 token 模式冻结为与 M2
逐字节一致。

那条冻结是内部契约（M2 交付并写进测试的形状），不是面向用户的需求：真正要保的冻结项是**状态码**、
**每个失败类别一个常量**、**不反射请求文本**、**日志纪律**与**无 JavaScript 提交路径**，这些本次
全部保留。因此改动面向浏览器的失败 body 需要一份记录（就是本文件）加机械性的交叉修订：`impl-m2`
加修订行（M2 规格拥有 token 契约）、`impl-m3` P14 的引用同步改口径 —— 与 D20 修订 `impl-m3` 的
做法完全一致。

失败路径本身没变：仍是同一个恒时 `validateToken`、同一行 `logger.info("login rejected")`（日志里
没有 token、没有用户名）、同样不建会话、同样不发 `WWW-Authenticate`。变的只是这个拒绝在浏览器
眼里的表现形式。

## 考虑过的替代方案

- **维持 `text/plain` 并写文档** —— 否：文档删不掉这个死胡同，而死胡同就是缺陷本身。
- **`303` 跳到 `GET /auth/login?e=1`（POST/Redirect/GET）** —— 否，理由同 D20：会顶掉冻结的 401，
  让脚本/监控把失败登录读成成功导航，并把错误信号塞进 URL。
- **HTTP 200 重渲染卡片** —— 否：破坏冻结的 401 契约，抹掉机器客户端唯一的判断依据。
- **专用 token 错误页** —— 否：新 CSS 会撞已用 91% 的 6 KB 预算，还会丢掉卡片存在的意义 —— 反钓鱼
  身份块。
- **回填提交的 token 帮用户自查粘贴错误** —— 否：把秘密反射进响应体、页面缓存与会话历史是泄露，
  且对完成重试毫无帮助；空字段严格更安全。
- **TOTP 段复用 `INVALID_CREDENTIALS`** —— 否：手因错位（口令已通过），且该常量要覆盖的语义不同。
- **同趟把 `413`/`415`/`503` 一并改成 HTML** —— 否：它们是协议层/运维层失败，不是用户可修复状态，
  且 413 的 M19 `connection: close` 必须保持精确。记录这个决定才是重点，扩大范围不是。
- **给 token 页加 D20 的提交守卫脚本** —— 否（见「决定了什么」）：会为一条没有锁定预算保护的流程
  扩大共享页面 API。

## 为什么这样选

这是「在 D20 为密码流删掉死胡同的同一位置，为令牌流删掉死胡同」的最小改动，且保住了冻结的 M2 契约
真正保护的全部不变量：状态码、一常量规则、不反射规则、日志纪律、无 JavaScript 提交路径、6 KB CSS
预算、切片边界与依赖集合。改动范围限于 token 切片 + 密码切片里的一个常量，不碰任何共享 API。真实
入口集成测试（`src/integration.auth.test.ts`，cordis + webserver + storage 全栈）现在断言的是 HTML
失败体而不只是状态码，所以「悄悄退回 text/plain」会在 CI 就被拦住，而不是等用户撞上空白页才发现。

独立评审：`docs/reviews/grok46-d21-token-failure-card-review.md`（grok-4.6，2026-09-23，结论
**approve**），其 F1–F3 已在本次改动内全部落地。
