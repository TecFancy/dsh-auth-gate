# 登录页视觉打磨实施规划

> 范围：仅 `src/login-page.ts`（token 版 `loginPageHtml` + password 版
> `passwordLoginPageHtml` 共用的 `renderLoginCard`/`CARD_STYLE`）。不涉及
> `auth-endpoints.ts`/`password-endpoints.ts`/`password-login.ts` 等路由与业务逻辑,
> 因为登录页渲染与提交处理是两层职责,本轮只动渲染层。

---

## 1. 背景与目标

`src/login-page.ts` 是 M2/M3 冻结的自包含登录页(token 与 password 两版共用同一套
内联样式,零第三方资源、无外部字体,`docs/implemented/impl-m2.md` §4.4 与 `docs/implemented/impl-m3.md`
P13/4.6 已把它的行为写死)。此前对该文件做过一轮人工评审,发现若干视觉与可访问性
问题:按钮/页脚/输入框边框对比度不足、`autofocus` 属性缺失(违反冻结契约)、错误
提示样式单薄、缺少 `:focus-visible` 状态、未响应 `prefers-reduced-motion`。

本文档把评审结论沉淀为可直接执行的改动清单,目标是:

- 让登录页在保持"自包含、零依赖、零第三方资源"的前提下,达到 WCAG 2.1 AA 的文字
  与非文字对比度门槛;
- 补齐 M2/M3 明确要求但当前实现遗漏的 `autofocus` 行为;
- 在不改变任何 HTML 结构断言(测试依赖的精确子串)的前提下,提升错误提示、焦点态
  与动效降级的可用性。

---

## 2. 现状问题清单(含可量化对比度数据)

对比度按 WCAG 相对亮度公式计算(`(L1+0.05)/(L2+0.05)`,L 为 sRGB 相对亮度)。文字
对比度门槛:正文 4.5:1,大字号(≥24px 常规或 ≥18.66px 粗体)3:1;非文字/UI 组件边界
(WCAG 1.4.11)3:1。

| #           | 问题                            | 位置(`src/login-page.ts`)                                                                            | 现状色值                                                                 | 实测对比度  | 门槛                                                                                                          | 结论                                      |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1           | `autofocus` 属性缺失            | `renderLoginCard`/`LoginCardOptions.fields`,行 78-108                                                | —                                                                        | —           | M2 §4.4 要求 token 输入框 `autofocus`；M3 P13 要求 password 表单的**密码字段**带 `autofocus`                  | 违反冻结契约,当前两个字段都没有该属性     |
| 2           | 输入框边框对比度不足            | `input { border: 1px solid #d9dce1; }` 行 28                                                         | `#d9dce1` vs 卡片背景 `#fff`                                             | **≈1.38:1** | 3:1(非文字 UI 边界)                                                                                           | 远低于门槛,输入框轮廓在白卡片上几乎不可见 |
| 3           | 提交按钮文字对比度不足          | `button[type=submit] { background: #4d6bfe; color: #fff; font-size: 15px; font-weight: 600; }` 行 36 | 白字 `#fff` on `#4d6bfe`                                                 | **≈4.33:1** | 4.5:1(正文,15px/600 未达大字号粗体门槛 18.66px)                                                               | 未达标,差距虽小但确实不合规               |
| 4           | 页脚文字对比度不足              | `footer { color: #9aa0a6; }` / `footer a { color: #9aa0a6; }` 行 40-41                               | `#9aa0a6` vs 页面背景 `#f7f8fa`                                          | **≈2.48:1** | 4.5:1                                                                                                         | 明显不合规,页脚几乎读不清                 |
| 5           | 输入框 placeholder 对比度偏低   | `input::placeholder { color: #9aa0a6; }` 行 30                                                       | `#9aa0a6` vs `#fff`                                                      | ≈2.64:1     | 非强制(SC 1.4.3 不覆盖 placeholder),但建议提升可读性                                                          | 体验偏弱,非阻断项                         |
| 6           | 错误提示样式单薄                | `.error { color: #dc2626; font-size: 13px; margin: 0 0 16px; text-align: center; }` 行 39            | `#dc2626` vs `#fff` ≈4.83:1(达标但无视觉承载)                            | —           | 纯文字居中,无背景/边框,辨识度低,与信息严重性不匹配                                                            |
| 7           | 无 `:focus-visible` 状态        | `button[type=submit]`、`.eye`、`footer a` 均无自定义焦点态                                           | —                                                                        | —           | 与 `input:focus` 的品牌色环视觉语言不统一,键盘操作时观感割裂                                                  |
| 8           | 未响应 `prefers-reduced-motion` | `input`/`button[type=submit]` 的 `transition`、`:active { transform: scale(.99) }`                   | —                                                                        | —           | 对开启"减弱动态效果"系统设置的用户没有降级路径                                                                |
| 9(补充发现) | 品牌图标颜色未显式设置          | `.brand { background: linear-gradient(...); }` 行 22,`SHIELD_SVG` 用 `stroke="currentColor"`         | 无任何祖先元素设置 `color`,`currentColor` 落回浏览器默认文字色(通常为黑) | —           | 渐变徽标上的盾牌图标很可能以黑色描边显示,而非预期的白色,视觉断裂(在读取源码复核样式时新发现,一并纳入本次改动) |

---

## 3. 范围划分

### P0(必改 — 违反冻结契约或明显不合规)

1. 补齐 `autofocus`(问题 1)。
2. 输入框边框对比度(问题 2)。
3. 提交按钮文字对比度(问题 3)。
4. 页脚文字对比度(问题 4)。
5. 品牌图标颜色(问题 9)。

### P1(明显视觉/可用性提升,不改变任何冻结决策)

1. placeholder 对比度(问题 5)。
2. 错误提示样式(问题 6)。
3. `:focus-visible` 统一(问题 7)。

### P2(锦上添花)

1. `prefers-reduced-motion` 降级(问题 8)。

---

## 4. 逐条改动明细

改动全部落在 `src/login-page.ts` 一个文件内:`CARD_STYLE` 模板字符串的选择器/色值、
`LoginCardOptions` 接口、`renderLoginCard` 内的字段渲染逻辑、`loginPageHtml`/
`passwordLoginPageHtml` 的调用参数。不新增文件,不新增 SVG 图标常量(`SHIELD_SVG`/
`EYE_OPEN_SVG`/`EYE_CLOSED_SVG` 本身不变,只是让 `.brand` 提供正确的 `currentColor`
来源)。

### 4.1 P0 — 补齐 `autofocus`(接口 + 渲染逻辑改动)

**`LoginCardOptions.fields` 元素类型**(行 82-89)新增一个可选字段:

```ts
// 改动前
fields: {
  id: string;
  label: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  type: "text" | "password";
}[];

// 改动后
fields: {
  id: string;
  label: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  type: "text" | "password";
  /** M2 §4.4 / M3 P13 冻结要求:token 字段与 password 表单的密码字段需要它。 */
  autofocus?: boolean;
}[];
```

**`renderLoginCard` 的字段渲染**(行 100-108)在拼接 `input` 字符串时按需追加
` autofocus`:

```ts
// 改动前
const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required>`;

// 改动后
const autofocusAttr = field.autofocus === true ? " autofocus" : "";
const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required${autofocusAttr}>`;
```

**`loginPageHtml`**(行 138-156,token 版,单字段)将唯一字段标记为 `autofocus: true`:

```ts
fields: [
  {
    id: "token",
    label: "Access token",
    name: "token",
    autocomplete: "current-password",
    placeholder: "Paste your token",
    type: "password",
    autofocus: true,
  },
],
```

**`passwordLoginPageHtml`**(行 159-185,password 版,两字段)按 M3 P13 原文冻结:
`username` 字段**不带** `autofocus`,`password` 字段带:

```ts
fields: [
  {
    id: "username",
    label: "Username",
    name: "username",
    autocomplete: "username",
    placeholder: "Enter your username",
    type: "text",
    // 不设 autofocus:字段级语义由 M3 P13 冻结,焦点落在密码字段
  },
  {
    id: "password",
    label: "Password",
    name: "password",
    autocomplete: "current-password",
    placeholder: "Enter your password",
    type: "password",
    autofocus: true,
  },
],
```

> 注意:这与"先聚焦第一个空字段"的常见直觉不一致,但 `docs/implemented/impl-m3.md` P13 原文
> 明确把 `autofocus` 写在 password 字段的 `<input>` 契约里,属于冻结决策,本次不
> 重新评估,只补齐缺失的实现。

### 4.2 P0 — 输入框边框对比度

`CARD_STYLE` 中 `input` 选择器(行 28):

```css
/* 改动前 */
input { ...; border: 1px solid #d9dce1; ...; }

/* 改动后 */
input { ...; border: 1px solid #8a919a; ...; }
```

`#8a919a` vs 卡片背景 `#fff` 对比度 ≈3.18:1,达到 WCAG 1.4.11 非文字 3:1 门槛。
`input:focus` 的品牌色描边(`border-color: #4d6bfe; box-shadow: ...`,行 29)不变。

### 4.3 P0 — 提交按钮文字对比度

`button[type=submit]`(行 36-38):

```css
/* 改动前 */
button[type=submit] { ...; background: #4d6bfe; ...; }
button[type=submit]:hover { background: #4059e0; }

/* 改动后 */
button[type=submit] { ...; background: #4059e0; ...; }
button[type=submit]:hover { background: #34479c; }
```

白字 `#fff` on `#4059e0` ≈5.64:1(达标);hover 态 `#34479c` ≈8.31:1(余量更大,
悬停时视觉层次也更清楚)。`:active { transform: scale(.99) }` 不变。

### 4.4 P0 — 页脚文字对比度

`footer`/`footer a`/`footer a:hover`(行 40-42):

```css
/* 改动前 */
footer {
  margin-top: 20px;
  font-size: 12px;
  color: #9aa0a6;
  text-align: center;
}
footer a {
  color: #9aa0a6;
  text-decoration: none;
}
footer a:hover {
  color: #6b7280;
  text-decoration: underline;
}

/* 改动后 */
footer {
  margin-top: 20px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}
footer a {
  color: #6b7280;
  text-decoration: none;
}
footer a:hover {
  color: #4b5563;
  text-decoration: underline;
}
```

默认态 `#6b7280` vs `#f7f8fa` ≈4.55:1(达标);hover 态 `#4b5563` ≈7.11:1。

### 4.5 P0 — 品牌图标颜色

`.brand`(行 22)补一个 `color`,让 `SHIELD_SVG` 的 `stroke="currentColor"` 落到
白色而不是浏览器默认文字色:

```css
/* 改动前 */
.brand {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4d6bfe, #7c5cff);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

/* 改动后 */
.brand {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4d6bfe, #7c5cff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}
```

`SHIELD_SVG` 常量本身不需要改动(仍是 `stroke="currentColor"`,只是现在有了正确
的祖先 `color` 来源)。

### 4.6 P1 — placeholder 对比度

`input::placeholder`(行 30):

```css
/* 改动前 */
input::placeholder {
  color: #9aa0a6;
}

/* 改动后 */
input::placeholder {
  color: #7d8590;
}
```

`#7d8590` vs `#fff` ≈3.73:1,虽非强制项,但比原来的 ≈2.64:1 明显更可读。

### 4.7 P1 — 错误提示样式(不改变 HTML 结构,只改 CSS)

`renderLoginCard` 里 `errorHtml` 的拼接方式**不能改**(`auth-endpoints.methods.test.ts`
与 `password-endpoints.methods.test.ts` 都断言精确子串
`<p class="error">bad &lt;script&gt; &amp; &quot;quotes&quot;</p>`,标签内不能
插入任何子元素/属性),只调整 `.error` 的 CSS(行 39):

```css
/* 改动前 */
.error {
  color: #dc2626;
  font-size: 13px;
  margin: 0 0 16px;
  text-align: center;
}

/* 改动后 */
.error {
  color: #b91c1c;
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 16px;
  padding: 10px 12px;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 8px;
  text-align: left;
}
```

文字色从 `#dc2626`(≈4.83:1 on 白卡片)加深为 `#b91c1c`,在新背景 `#fff5f5` 上
≈6.05:1,余量更充足;背景/边框让错误信息有独立的视觉承载,不再是"飘"在空白区域
里的一行红字。`text-align` 从居中改为左对齐,配合内边距形成"提示卡片"观感(纯样式
选择,不影响任何断言)。

### 4.8 P1 — `:focus-visible` 统一

新增三条规则(`CARD_STYLE` 末尾、`@media (max-width: 420px)` 之前均可):

```css
button[type="submit"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(77 107 254 / 30%);
}
.eye:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(77 107 254 / 30%);
}
footer a:focus-visible {
  outline: 2px solid #4d6bfe;
  outline-offset: 2px;
}
```

`input:focus` 的现有品牌色环(行 29)保持用 `:focus`(输入框获得焦点本身就是有
意义的状态,不需要区分键盘/鼠标);按钮、图标按钮、页脚链接改用 `:focus-visible`,
避免鼠标点击后残留一圈环,同时键盘 Tab 导航时有与输入框一致的品牌色视觉语言。

### 4.9 P2 — `prefers-reduced-motion`

在 `CARD_STYLE` 末尾追加:

```css
@media (prefers-reduced-motion: reduce) {
  input,
  button[type="submit"] {
    transition: none;
  }
  button[type="submit"]:active {
    transform: none;
  }
}
```

---

## 5. 需要同步更新的测试清单

结论先行:**本轮改动不需要修改任何现有测试的断言**,因为所有 CSS 色值/焦点态/
动效降级都不在任何测试的字符串断言范围内,而 `errorHtml`/hidden `next` 的 HTML
结构逐字保持不变(见 §4.7 的强约束)。逐文件说明:

| 文件                                                                        | 是否受影响       | 说明                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth-endpoints.test.ts`                                                | 否               | GET `/auth/login` 只断言 `toContain("<form")`,不涉及样式/autofocus                                                                                                                                                                                                                                                                 |
| `src/auth-endpoints.methods.test.ts`                                        | 否(建议新增用例) | `loginPageHtml` 的 3 个用例只断言 `<p class="error">`/`class="error"` 存在与否/hidden `next` 转义,均不受影响。建议**新增**一条 `it` 断言 `loginPageHtml("/")` 包含 `autofocus`(例如 `expect(html).toContain('placeholder="Paste your token" autofocus>')` 或更宽松地 `toContain(" autofocus>")`),把 M2 §4.4 的冻结要求钉成回归测试 |
| `src/password-endpoints.test.ts`                                            | 否               | GET `/auth/login`(password 版)只断言 `name="username"`/`name="password"`/`<form`                                                                                                                                                                                                                                                   |
| `src/password-endpoints.methods.test.ts`                                    | 否(建议新增用例) | `passwordLoginPageHtml` 的 4 个用例断言字段名/`autocomplete`/错误段落/hidden `next`,均不受影响。建议**新增**一条用例分别断言 `password` 字段带 `autofocus`、`username` 字段不带(例如断言 `username` 那段 `<input ...>` 子串里不包含 `autofocus`,`password` 那段包含),把 M3 P13 的字段级语义钉成回归测试                            |
| `src/auth-endpoints.login.test.ts` / `src/password-endpoints.login.test.ts` | 否               | 只覆盖 POST 提交路径(302/401/429/503 等),不渲染/断言登录页 HTML                                                                                                                                                                                                                                                                    |
| `src/integration.auth.test.ts`                                              | 否               | 只断言 `toContain("<form")`                                                                                                                                                                                                                                                                                                        |
| `src/integration.password.test.ts`                                          | 否               | 只断言 `toContain('name="username"')`                                                                                                                                                                                                                                                                                              |

新增的两条用例建议直接加在对应 `describe("loginPageHtml", ...)` /
`describe("passwordLoginPageHtml", ...)` 块内,与现有转义类用例风格保持一致
(纯字符串 `toContain` 断言,不引入 DOM 解析依赖)。

---

## 6. 验证步骤

1. `npm run verify`(format:check + lint + type-check + coverage ≥80% + lock:check)
   必须全绿。改动只涉及字符串拼接与 CSS 模板,预期不影响覆盖率红线,但仍需跑一遍
   确认。
2. 单独跑受影响的测试文件确认 HTML 结构断言仍然成立(比全量 `verify` 更快定位
   问题):
   ```
   npm run test -- src/auth-endpoints.test.ts src/auth-endpoints.methods.test.ts src/password-endpoints.test.ts src/password-endpoints.methods.test.ts
   ```
3. `npm run build`:`src/login-page.ts` 改动后必须重新生成 `lib/`,与 `src/` 改动
   一起提交(`AGENTS.md`"验证一个改动是否真的生效"第 2 条;CI 会跑
   `git diff --exit-code -- lib` 校验漂移)。
4. 按 `docs/specs/development.md`"GUI demos"约定:登录页是用户可见的 Web 行为,改动
   需要配一份从真实流程录制的演示(真实启动的 server、干净浏览器状态、非 mock
   传输),并在演示旁写清楚这份录制证明了什么(至少应覆盖:token 页与 password
   页首次加载时的焦点落点、错误提示态、Tab 键盘导航到按钮/页脚链接时的焦点环)。
5. 提交信息建议(遵循 `AGENTS.md` 的 `type(scope): subject` 约定,`scope` 用模块名
   `login-page`):
   - 单次提交:`fix(login-page): restore autofocus and raise contrast to WCAG AA`
     (P0 五项打包,`fix` 类型会触发 release-please 版本号提交,因为其中"补齐
     autofocus"属于修复对冻结契约的偏离)。
   - 如果想分批落地,可以再拆一条 `style(login-page): unify focus-visible and error affordance`
     覆盖 P1,一条 `chore(login-page): respect prefers-reduced-motion` 覆盖 P2
     (`style`/`chore` 均不触发发布,与"仅视觉打磨"的定位一致)。
   - 无论几次提交,`lib/` 都必须和对应的 `src/login-page.ts` 改动在同一个提交里。

---

## 7. 明确不做的事

- 不引入任何第三方资源(图标库、字体 CDN、CSS 框架),`CARD_STYLE` 继续是纯内联
  字符串。
- 不引外部字体,`font-family` 的系统字体栈保持不变。
- 不改动 M2/M3 已冻结的路由/会话/校验逻辑:`auth-endpoints.ts`、
  `password-endpoints.ts`、`password-login.ts`、`token-gate.ts`、
  `password-gate.ts`、cookie/session 语义、`validateNext` 规则等一律不动。
- 不改变 `LoginCardOptions` 除 `autofocus?: boolean` 之外的任何字段形状,不改变
  `loginPageHtml`/`passwordLoginPageHtml` 的导出签名。
- 不引入 JS 框架或客户端状态管理;`EYE_SCRIPT` 的渐进增强脚本保持原样,不新增
  行为。
- 不新增 SVG 图标常量或改变现有三个 SVG 字符串的路径数据,只让 `.brand` 提供
  正确的 `color` 供 `currentColor` 消费。
- 不修改 `.card`/`.field`/`.label`/`h1`/`.subtitle` 等本次评审未发现对比度问题的
  选择器。
- 不为满足本次改动而放宽 ESLint 复杂度/行数上限(文件 ≤250 行、函数 ≤80 行、
  复杂度 ≤15);改完后应重新确认 `login-page.ts` 仍在预算内(改动前 186 行,预计
  新增 CSS 规则与 `autofocus` 逻辑共约 15-20 行,仍有充裕余量)。

---

## 8. DoD(完成定义)

1. `src/login-page.ts` 按 §4 全部 P0 + P1 + P2 条目落地(或至少 P0 + P1,P2 视
   时间决定是否本轮一起做,但需在提交信息中明确说明范围)。
2. §5 列出的两条新增回归用例(token/password 的 `autofocus` 断言)已加入
   `src/auth-endpoints.methods.test.ts` / `src/password-endpoints.methods.test.ts`,
   且为绿。
3. `npm run verify` 全绿。
4. `npm run build` 已执行,`lib/` 与 `src/` 改动在同一批提交里,`git diff --exit-code -- lib`
   通过。
5. 已按 `docs/specs/development.md`"GUI demos"约定录制真实流程演示,并说明演示验证了
   哪些点(焦点落点、错误态、focus-visible 键盘导航)。
6. 未触碰 §7"明确不做的事"列出的任何范围。
7. 提交信息符合 `AGENTS.md` 的 commitlint 约定,`lib/` 与 `src/` 同批提交,未在
   未经用户指示的情况下 push。
