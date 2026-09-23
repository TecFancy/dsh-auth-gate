# D20. 登录失败渲染登录卡片（HTML），不再返回裸文本页

## 决定了什么

浏览器可见的登录失败**保留冻结的状态码**，但不再返回机器可读的裸文本：

- **凭据错误**（未知用户 / 口令错误 / 禁用账号，三者同响应）仍是 **401**，但改为
  `content-type: text/html; charset=utf-8`，body 是既有登录卡片重渲染、错误槽填唯一常量
  `Invalid username or password.`；用户刚提交的用户名以 HTML 转义后的 `value=` 回填，密码
  永不回填，两个字段都带 `aria-invalid`/`aria-describedby="err"`，密码框保持 `autofocus`
  （回填用户名为空时改由用户名框获得焦点，例如空提交），`<title>` 加 `Error: ` 前缀。
- **锁定**仍是 **429** + `retry-after: <秒>`，body 换成同一张卡片，文案为
  `Too many sign-in attempts from this network. Try again in N seconds. There is no password reset,
so ask the instance owner if you are stuck.`（`N` 取当前 `retry-after` 整数，`N=1` 用单数
  `second`）。提交按钮**故意不在 HTML 里 disabled**，让没有 JS 的浏览器仍能重试；不做活倒计时，
  也永不披露「剩余次数」或账号是否存在。TOTP 第二段命中 429 时渲染挑战卡 + 同一文案。
- 用户名在**服务端先 trim** 再查用户、再走 DUMMY_HASH 验证；密码永不 trim。
- 失败页带一段渐进增强脚本，做两件事：`submit` 时禁用按钮、置 `aria-busy="true"`、文案改
  `Signing in...`，并用 `pageshow` 与 10s 超时复位；当页面已带 error slot（即这是一次失败响应）时，
  再把历史项 `history.replaceState` 成 GET URL，使之后按 F5 重新请求普通登录页，而不是重放 POST
  白吃一次失败额度。**在 `submit` 事件里改历史是无效的**：POST 导航会在处理器返回之后才提交，
  把替换掉的历史项又盖回 POST；无 JS 时表单行为与从前一致，刷新仍会重放。
- 新增 `src/features/password/login-failure-pages.ts`（`INVALID_CREDENTIALS`、`lockoutMessage`、
  `sendInvalidCredentials`、`sendLockout`、`sendTotpLockout`）；`src/shared/login-page.ts` 增加
  转义 `value` 字段与 `username` 渲染选项；`src/shared/login-page-assets.ts` 增加 `SUBMIT_SCRIPT`。

**刻意不动（当时）**：token 模式仍是 `text/plain` 401（M2 冻结）—— **2026-09-23 已被 D21 取代**：
token 模式现在渲染自己的失败卡片，本记录其余内容继续有效；锁定与退避语义不动（另见 issue #81）；
NAT 共用出口的桶键不动（#82）；6KB CSS 预算不动（本次零新 CSS）；401 仍然**不发**
`WWW-Authenticate`。

## 背景

0.14.1 对错用户名/错口令返回 `401 text/plain` + body `invalid credentials`。浏览器导航因此渲染出
一张空白白页：没有表单、没有 `next` 入口、`document.title` 为空。锁定同理（`429 text/plain` +
`too many attempts`），服务端明明知道 `retry-after` 秒数，用户却看不到。在隔离实例（0.14.1 +
Chromium）实测：

- 在空白页按 **F5 会重放 POST**，再消耗 600s/5 次预算里的一次失败，慌了狂刷的人能把自己锁出去；
- 刚敲的用户名被丢弃（Back 能恢复只是浏览器表单状态）；
- scrypt 一次约 190ms，这段时间提交按钮零反馈；
- 真双击被浏览器去重，所以问题在体感而非重复计数。

这个形态本身是**遗漏**而非安全决策：TOTP 段在 0.11.1 就是这么修的
（`docs/implemented/totp-fix-plan.md` §3.3：「保持 401 状态码，改的是 content-type / body，让浏览器
表单能看到 slot；fetch 客户端仍看 status」），该文件亦记载纯文本契约来自 M3 密码路径。冻结项约束的
是**文案来源**（唯一常量、绝不读 `?error=`、绝不反射请求文本）与**三态响应同一性**，不约束
content-type。渲染器早就支持 error slot、`role="alert"`、`aria-invalid`/`aria-describedby` 接线与
`.error` 样式，`passwordLoginPageHtml(next, error?, options?)` 也早就接受 `error`，只是从未带值调用；
唯一缺的能力是回填用户名（模板里唯一的 `value=` 是隐藏 `next`）。

设计期间收集的支撑证据：

- 无障碍：整页新文档里「已填充」的 `role="alert"` 通常**不会**被播报（W3C APG、MDN、WAI ARIA19、
  WebAIM 一致），错误必须靠焦点与描述性接线可达；`Error: ` 标题前缀是这个场景的零成本 GOV.UK 做法。
- 业界调研（源码级）：Keycloak 重渲染表单并在临时锁定时复用同一句 `Invalid username or password.`；
  oauth2-proxy 用 401 + HTML body 且不发 `WWW-Authenticate`；Grafana 对按 IP 的锁定说
  `Login temporarily blocked`；pfSense 有独立锁定页。调研到的产品**没有一家**披露剩余次数，也没有
  一家认真的门禁会对浏览器表单回裸文本页。
- RFC 6585 §4 给出的 429 示例本身就是 HTML body + `Retry-After`，锁定卡完全在标准之内。

## 考虑过的替代方案

- **POST/Redirect/GET（303 → `GET /auth/login?e=1`）** —— 否决：必须换掉冻结的 401；脚本与监控会把
  失败登录当成成功导航；URL 里出现错误信号（离被禁的 `?error=` 只有一步）；用户名要靠 cookie 或
  query 传递；并且与 Chromium 密码管理器指南「登录失败不要导航到另一页」直接冲突。
- **200 + 重渲染卡片（Keycloak 形态）** —— 否决：破坏冻结的 401，而且机器客户端（curl、监控、
  插件自身测试）会失去唯一的判据。
- **fetch/XHR 内联注入错误（渐进增强）** —— 本次否决：双响应路径、更大内联脚本的 CSP 暴露、
  JS 与无 JS 行为分叉，而收益只是 190ms 的体感。
- **独立错误页** —— 否决：需要新 CSS（预算已用 91%），还会丢掉卡片存在的目的——反钓鱼身份块与
  「换一个账号」入口。
- **一次性 form ticket（GET 发、POST 验，重放不计次）** —— 暂缓而非否决：它是无 JS 下唯一能关掉
  F5 计次的办法，但引入新状态并与 issue #81 即将改动的锁语义耦合。等那个决策一起定。
- **锁定卡做活倒计时 + 禁用提交** —— 否决：HTML 里写死 `disabled` 会让无 JS 用户永久搁浅
  （WCAG 2.2.1）；在按 IP、且 NAT 下多人共用的锁上，倒计时并不诚实；调研到的产品也都没有倒计时。
- **按 `Accept` 做内容协商（浏览器 HTML、脚本 text/plain）** —— 否决：`curl` 发的是 `Accept: */*`，
  只能靠质量值区分，两头都可能拿错 body。对机器客户端的契约就是状态码。
- **为满足 RFC 9110 §15.5.2 而发 `WWW-Authenticate: Basic`** —— 否决：浏览器会弹出原生凭据对话框并
  把卡片挡住。此偏离是刻意选择并记录在此：oauth2-proxy 同样偏离，而不存在既合规又对表单登录可用的
  挑战头。

## 为什么这样选

这是**删除死胡同所需的最小改动**，且完整保住每一条冻结不变量：状态码、三态共用同一常量、不反射规则、
日志纪律、无 JS 提交路径、6KB CSS 预算、切片边界与依赖集合全部未动，结果与 0.11.1 起就已发布并有
测试覆盖的 TOTP 修复结构同构。用户名**无条件**回填（未知/禁用同样回填），所以不会变成账号存在性预言机；
锁定文案刻意说「这个网络」，因为桶键是可能被多人共享的客户端 IP。剩下的 F5 与体感问题用不削弱契约的
方式缓解：对运行 JS 的浏览器加提交守卫 + `history.replaceState`，并**明确记录**无 JS 路径刷新仍会重放
POST，而不是宣称已经修好。
