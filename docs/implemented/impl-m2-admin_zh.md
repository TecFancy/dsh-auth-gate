# dsh-auth M2 管理面（D25，2026-09-24）

本文件是 P2 管理面（D25，2026-09-24：管理员重置口令与强制改密登录门）的 executable spec
切片。以下内容从 [impl-m2_zh.md](./impl-m2_zh.md) **原样搬出**；impl-m2_zh.md 保留 M2
基线契约，并在每个原位置留下指针。D25 的完整理由见
[D25 记录](../decisions/implemented/2026-09-24-admin-password-reset.zh.md)。

## 4.5b 路由与端点修订（D25，2026-09-24）

**D25 修订（2026-09-24）**：password 模式到 1 prefix + **6 exact**（新增 `/auth/users`
（`allow: GET`）与 `/auth/users/password`（`allow: POST`））；`/auth/password` 也响应 `GET`，
返回服务端渲染、无 JavaScript 的改密表单（未认证的 `GET` 为
`302 /auth/login?next=/auth/password`），其 `allow` 变为 `GET, POST`，P1 的 `POST` 被取代。
token 模式仍只注册 3 exact，**从不**注册管理路由。已认证的 `/auth/status` 走加法字段
（`name`、`role`、`disabled`、`totpEnabled`、`mustChangePassword`、`sessionKind`）；未认证、
subject 已不在 yaml、yaml 读取失败三种情况都只回原有两键且**键集合相等**。

**实现期复审修订（2026-09-24，评审后收紧）**：三处收紧，不改路由模型与拒绝顺序。
（1）`validateNext` 与 `denyHttp` 的 302 共用同一个判定（`shared/auth-common.ts`），同时拒绝
C0 控制符与 DEL：浏览器在解析 URL 前会剥掉 ASCII TAB/LF/CR，`"/\t/evil.com"` 否则会变成协议
相对的 `//evil.com`；CR/LF/NUL 又会让 `writeHead` 抛 `ERR_INVALID_CHAR`（宿主 webserver 回
`400` 而不是预期的 `302`）；logout 的重定向消费同一判定。（2）管理重置的锁内 RMW 会先按
**锁内快照**复核 actor 仍是 admin 且未禁用，若授权读之后被降权/禁用则回 `403` + 审计
`forbidden`，不写哈希、不吊销、不计失败。（3）审计 `target` 先剥 C0/DEL 再截 64 字符（业务
字段保持原值），无会话的拒绝仍记 `info` 级。

### 4.5b.1 `/auth/status` 加法字段

**D25（2026-09-24）**：已认证时追加 `name`、`role`、`disabled`、`totpEnabled`、
`mustChangePassword`、`sessionKind`；未认证、subject 已不在 yaml、yaml 读取失败三种情况都只回
原有两键（键集合相等，绝不出现 `role: null` 占位）。

## 4.5c 客户端半边（PR2）

设置面板「账号安全」页里管理块的冻结客户端契约（权威是 `CONTRACT-pr2.md` §3 及其 §9 评审修正；
PR2 **不新增**路由、配置项、schema、依赖或 CSS 文件，也不碰插件的 host 半边）。

- **渲染门**：仅当 `role === "admin"` **且** `disabled === false` **且** `sessionKind === "full"`
  **且** `typeof name === "string"` 时才挂管理块。任一字段缺失或取别的值（旧服务端、受限会话、
  字段不齐的 payload）→ **不渲染、零管理请求**；初稿的 `?? "full"` 兜底已删除，所以缺
  `sessionKind` 的 payload 不算通过。
- **不试探**：非 admin 客户端**绝不**请求 `/auth/users`（不做「拉一次看 403」）；`/auth/status`
  返回前不发任何管理请求（不闪烁）。`status === null` 仍渲染加载提示，自助改密表单原有行为不动。
- **列表**：保持服务端顺序（服务端已按 name 排序）；每行展示 `name`、`role`、`disabled`、
  `mustChangePassword`、`totpEnabled`（只读徽标），本人行标「本人 / You」。状态徽标**互斥**，
  优先级 `disabled` > `mustChangePassword` > 正常；未知 `role` 原样文本渲染，不新增词典键。
- **目标下拉**：**排除本人**（自己的口令走上方的自助表单），并在块内说明；**空初始**
  （`EMPTY_ADMIN_RESET.target === ""`），必须渲染 `value=""` 的占位 option，**禁止**预选列表第一项
  （预选会让「未选目标」永不可达，误点就改错人）。没有可选对象时用 `admin.empty` 取代表单。
- **本地校验（闭表，四态）**：`target === ""` → `admin.targetRequired`；`password === ""` →
  `admin.passwordRequired`；`password !== confirm`（含 confirm 为空）→ `admin.mismatch`；
  `actorTotpEnabled && code.trim() === ""` → `admin.codeRequired`。此外不再有别的拦截条件。
- **条件式再认证**：`code` 输入框**仅当** `actorTotpEnabled === true` 时渲染。两个口令输入框都带
  `autocomplete="new-password"`；POST body 只发 `target`/`password`，**只有** admin 自己开了 TOTP 时
  才带 `code`（未开时**省略 `code` 键**，不是发空串），且**永不发 `confirm`**。
- **错误映射**：列表 **403 → 静默卸块**（降级，不留错误噪音）；列表 **401 → 渲染
  `admin.unauthorized` 且不渲染列表与表单**（401 说明整页登录态已死，静默会让上方表单继续按过期的
  status 显示「已登录」）。503／网络／解析失败 → 显示 `admin.unavailable` 且不渲染表单。提交失败是
  `status` + `error` 字面量（必要时加 content-type）的**全函数**：400 `bad_target`/`policy`
  （规则文案复用既有 `ruleText`，**不新造规则文案**）、401 `invalid_totp`/`unauthorized`、403
  `forbidden`、404 `not_found`、429 `locked`（`retryAfter` 秒数插值）、413/415/503 归入通用失败。
  **所有未列出的组合一律 `admin.generic`**；`sessionsRevoked` 缺失或非布尔按 `false` 处理；403 只认
  `{error:"forbidden"}`（自助误走管理面服务端也回同一个字面量）。客户端**不手写 `Origin`**，也不申请
  任何豁免。
- **成功态**：清空四个字段的 DOM value、就地显示成功行、**不跳转**（发起重置的管理员自己的会话不受
  影响）；随后**再拉一次 `/auth/users`**（同 abort 规则）刷新徽标，避免 `mustChangePassword` 仍是
  旧值；失败路径不改行。`sessionsRevoked === false` 是**安全失败而不是成功变体**：用
  `admin.successKept` + `role="alert"` + `aria-live="assertive"` + 错误色 token 呈现（**不得**用成功绿）。
- **DOM id**：`dsh-auth-gate-admin-{target|password|confirm|code}` 以及
  `dsh-auth-gate-admin-status`（前缀 `dsh-auth-gate-admin`）。
- **文案与样式**：全部文案取自冻结的 `ADMIN_KEYS` 词典，**zh/en 键集必须相等**（键的权威 = `CONTRACT-pr2.md`
  §4 表 + §9 新增的 `admin.codeRequired` 与 `admin.targetPlaceholder` 两键）；`admin.intro` 与
  `admin.successKept` 用 §9 修订后的措辞；`admin.selfHint` 写明产品边界（自己的口令用上方表单，管理面
  不允许重置自己，忘记自己的口令走 CLI）。样式只用 `--dsw-*` token，无 CSS 文件、无硬编码色值、
  无新依赖。
- **生命周期**：不吃宿主 `close` prop；卸载即 abort，卸载后不 setState；不吞异常（落到
  `admin.generic`）。
- **打包**：client 半边仍是**单文件 CJS bundle**（`tsdown` `codeSplitting: false`，由
  `verify-bundle.mjs` 钉死）；`account-styles.ts` 既有常量保持原值，自助改密页像素不变。

## 5b 测试矩阵增量（D25，2026-09-24）

1. **D25（2026-09-24）**：password 模式注册 7 条（1 prefix + 6 exact）；快照断言六条路径**及各自 `allow` 值**（`/auth/password` = `GET, POST`、`/auth/users` = `GET`、`/auth/users/password` = `POST`），并断言 token 模式仍恰好 3 条 exact、管理路径一条都不在。

## 5c 测试矩阵增量（PR2）

1. **jsdom 四组**。(a) **api**：200 解析保持服务端顺序并丢弃非法行；列表 **403 → `denied`**、
   **401 → `unauthorized`**（两种结果语义不同）；503、非法 JSON、网络错误 → `failure`；abort →
   `aborted`；请求 pathname／方法／headers／body 逐项断言（`code` 只在 admin 自己开了 TOTP 时出现、
   `confirm` 不带）；`sessionsRevoked:false` 透传、缺失或非布尔按 `false`；未列出的 status+error
   组合落到 `admin.generic`；每个已映射错误码**逐一**断言文案键；zh/en 键集相等。(b) **view**：
   加载提示；行数、角色与状态徽标（互斥 + `disabled` > `mustChangePassword` > 正常 的优先级）、
   本人行；下拉排除本人、**空初始**且带 `value=""` 占位 option（不预选任何行）；只有本人 → `empty`；
   两个口令框用 `getAttribute` 断言 `autocomplete="new-password"`；`code` 仅在 `actorTotpEnabled`
   时出现；提交成功后四个 input value 为空、显示成功文案、**并重新拉一次列表**（
   `mustChangePassword` 徽标刷新），失败路径行内容不变；`successKept` 与 `successRevoked` 文案不同，
   且吊销失败的提示断言 `role="alert"` + `aria-live="assertive"` + 错误色 token；400 policy 规则
   逐条翻译；429 秒数插值；403 显示 forbidden；本地校验**四态**（未选目标／口令为空／两次不一致／
   admin 开了 TOTP 却没填码）全覆盖。(c) **wiring**：已认证的非 admin 只渲染自助改密表单，且
   **pathname 集合**恰好是 `{"/auth/status"}`（**绝无 `/auth/users`**）；admin + full 会话出现
   管理块；admin + 受限会话、有 `role` 但缺 `sessionKind`、`disabled` 不为 `false` 三种 payload
   都不渲染且不发任何管理请求；旧服务端（无加法字段）不出现且不抛错；加载态保持原行为。
   (d) **integration**（lead 所有 `src/client/admin-integration.test.tsx`）：真 section + 真 block +
   fetch mock 全链，admin 成功重置走到 200，非 admin 无 `/auth/users` 请求，成功后字段清空。

   断言纪律（§9 A11）：fetch 一律按 **pathname 集合**断言，**禁止**断言调用次数（React StrictMode
   会双调用，首次可能 `aborted`），所以 admin 成功路径允许出现两次 `/auth/users`；`autocomplete`
   用 `getAttribute` 读；`aria-live` 只断言属性与文本，不测真实发声。补充用例：卸载 abort 后
   **0 次** setState；双击提交只发一次请求；恶意 `name`（`<img onerror=...>`）按纯文本渲染
   （`textContent` 不含标签）。

2. **门禁**：`npm run verify` 保持全绿、覆盖率不降级，且 `lib/client.js` 仍是单文件。
3. **真机 E2E**：`CONTRACT-pr2.md` §8（admin 列出用户 → 重置 `dsh_verify_p2` → 目标旧会话立刻失效 →
   目标重新登录只拿受限会话 → SSR 改密页提交成功 → 目标随后正常登录；目标 `totpSecret` 字节不变且
   有两条审计日志；非 admin 看不到管理块、用它自己的 cookie 直连 `GET /auth/users` 得到 403；
   `curl` 不带 `Origin` 得 403、带合法 `Origin` 得 200）。
