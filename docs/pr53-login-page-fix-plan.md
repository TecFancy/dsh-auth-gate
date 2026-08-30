# PR #53 登录页接手修复方案

> 状态：待 review，未开工。落地前以本文为准；拍板后的偏差写进文末「决议」。
>
> 范围：把 BuvkB 在
> [#53](https://github.com/TecFancy/dsh-auth-gate/pull/53)
> 的 Apple 风登录页 + `Accept-Language` 中英文本地化，干净合进当前
> `development`（含 `logoutOrder` / 配置技能），门禁全绿，squash 署名留给贡献者。
>
> 对照：视觉基线见 `docs/login-page-polish-plan.md`（已落地的 WCAG AA /
> autofocus / reduced-motion）；本轮是**另一条贡献分支的移植 + 门禁修复**，
> 不是那份规划的续篇。

---

## 1. 背景与结论

PR #53 单 commit `6b6889b`，作者 BuvkB（邮箱
`19549719+BuvkB@users.noreply.github.com`），分支
`feat/login-page-localization`，base 当时的 `main` = `v0.9.1`（`0bd0592`）。
本地 ref `pr53` 指向同一 SHA。

**结论先行：**

- **能合，但必须移植，不能 cherry-pick / 直接 merge 原 commit。** 原分支会把
  `logoutOrder`、`/auth/status` JSON、若干 harness 改回去。
- **安全无 blocker**：`next` / `error` 仍走 `escapeHtml`；字体 data-uri；无 CDN /
  外链；无凭据日志。
- **门禁现状红**：prettier、lint、type-check、`max-lines`、无新测试、`lib/` 过期。
- **无障碍有回退**：`9dd09de` 刚做的 WCAG AA 会被这版配色打回去，必须同一次修复补上。

贡献者做对的部分（保留）：

- Apple 风极简：`#f5f5f7` 渐变、白圆角卡、药丸输入/按钮；
- DeepSeek 品牌：鲸鱼 wordmark + HARNESS 徽章 SVG 复刻；
- 标语 blend 光标（`mix-blend-mode: difference`）+ `prefers-reduced-motion` +
  触屏 `(hover: hover)` 降级；
- `loginStrings(lang)` 中英文案；零外部资源。

---

## 2. 范围 / 非范围

### 2.1 做

- 登录页视觉（Apple 卡片、鲸鱼 wordmark、标语、药丸输入、光标环）；
- `loginPageHtml` / `passwordLoginPageHtml` 第三参 `lang`；
- 从 `Accept-Language` 选 `zh | en`；
- 拆文件过 `max-lines` 250、修 lint/type、补测试、对比度、`lib/` 重生、README 演示图。

### 2.2 明确不做

- 不改登录 POST 语义（失败仍是 `401 text/plain`，不把 error 渲进 HTML——现状如此）；
- 不改 `logoutOrder`、skill 分发、proxy、session/cookie、`validateNext`；
- 不收 PR 里的 `package-lock.json` / 过期 `lib/`；
- 不手改 `version` / `CHANGELOG.md` / `.release-please-manifest.json`；
- 不放宽 ESLint 上限（文件 ≤250、函数 ≤80、复杂度 ≤15）；
- 不把 Playwright 引进 repo 测试（真机演示是 verify 之后的手工/CLI 步骤）。

---

## 3. 分支与合入策略

推荐：**在 `development` 上移植，再推回 `feat/login-page-localization`，让 #53
自己更新。** squash 合入时作者默认仍是 BuvkB。

```
1. git checkout development && git pull
2. git checkout -b fix/pr53-login-page
3. 按 §4 文件清单移植 + 修复（不要 git cherry-pick 6b6889b）
4. npm run verify 全绿；npm run build 后 lib/ 同 commit
5. git checkout feat/login-page-localization
   git merge origin/development     # 保留 logoutOrder 一侧
   # 冲突决议见 §3.1
   检出 fix/pr53-login-page 上已修好的 src/ 测试与 docs
   npm run build && npm run verify
6. git push origin feat/login-page-localization
   （#53 自动更新）
```

备选（不推荐）：关 #53、从 `development` 新开 PR。署名变成维护者，需
`Co-authored-by: BuvkB <19549719+BuvkB@users.noreply.github.com>` 才能记一笔。
对应拍板项 **D**（§10）。

合入 `main` 仍 squash，标题保持贡献者原题，或改成更短的
`feat(login): Apple-style login page with zh/en localization`（拍板时定）。
路径是：#53 变绿 → squash 进 `main` → release-please 开 0.11.0。不要在 #53
上先把 `development` 合进 `main`。

### 3.1 冲突决议（第 5 步）

| 文件                                              | 取哪边                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `src/login-page.ts` 及拆出的新文件                | 修复后的移植版                                                        |
| `src/auth-endpoints.ts` / `password-endpoints.ts` | **development 的 `logoutOrder` + status JSON**，只加 `langOf` 调用    |
| 测试 harness 的 `logoutOrder: 1000`               | development                                                           |
| `lib/**`                                          | 本地 `npm run build` 重生，不留 PR 产物                               |
| `package-lock.json`                               | development，不动                                                     |
| `docs/screenshots/*.png`                          | 可暂留作设计参考；正式演示图走 `docs/demo/login-page.png`（真机重拍） |

实测 `git diff development pr53 -- src/auth-endpoints.ts` 会删
`logoutOrder` 字段和 `JSON.stringify({ authenticated, logoutOrder })`——这是硬冲突，
按「development 赢 + 加 lang」处理。

---

## 4. 文件级改动

### 4.1 拆文件（过 `max-lines` 250）

PR 版 `login-page.ts`：**298 行 / ~83KB**（两枚 woff2 ≈ 39KB + 鲸鱼 SVG ≈ 15KB）。
ESLint `max-lines` 计 skipBlankLines + skipComments，实测 **253 > 250**。

字体是超长**单行**，只拆常量减不了多少行；超标来自 CSS / 脚本 / i18n / 渲染。
拆成 4 个文件：

| 文件                             | 职责                                                                            | 预算                 |
| -------------------------------- | ------------------------------------------------------------------------------- | -------------------- |
| `src/login-page-assets.ts`（新） | `@font-face` CSS、`SHIELD_SVG`、眼睛/用户/锁 SVG、`EYE_SCRIPT`、`CURSOR_SCRIPT` | 常量为主，远低于 250 |
| `src/login-page-i18n.ts`（新）   | `LoginLang`、`loginStrings()`、**唯一** `langOf(req: IncomingMessage)`          | ~40 行               |
| `src/login-page-style.ts`（新）  | `CARD_STYLE`（引用 fonts CSS）                                                  | ~60 行               |
| `src/login-page.ts`（改）        | `escapeHtml`、`renderLoginCard`、两个 export                                    | ~120 行              |

公开 API：

```ts
loginPageHtml(next: string, error?: string, lang?: LoginLang): string;
passwordLoginPageHtml(next: string, error?: string, lang?: LoginLang): string;
```

第三参缺省 = 英文（与现在默认页一致）。**不要**把 `langOf` 再写进两个
endpoints（这是 PR 的重复，也是 TS2345 源头）。

`docs/development.md` 的 `src/` 树状图在落地时补一行新文件名即可（`docs:`
提交，不触发发版）。本方案文档本身不预改 development.md。

### 4.2 `langOf`（修 type-check + lint）

放到 `src/login-page-i18n.ts`：

```ts
export type LoginLang = "zh" | "en";

export function langOf(req: IncomingMessage): LoginLang {
  const raw = req.headers["accept-language"];
  const header = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  if (/^\s*zh/i.test(header) || /,\s*zh/i.test(header)) return "zh";
  return "en";
}
```

对应修掉的问题：

| 现状                                                                                                           | 处理                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 参数写成 `{ headers?: { [k: string]: string \| undefined } }`，接不住 `IncomingMessage`（值可以是 `string[]`） | 直接用 `IncomingMessage` |
| `try/catch` + `_e` unused                                                                                      | 删除，解析不会抛         |
| 两份拷贝（auth / password endpoints）                                                                          | 只留一处                 |
| `htmlLang \|\| 'en'` / `securedBy \|\| '...'`                                                                  | 改 `??`，Prettier 双引号 |
| `consistent-indexed-object-style`                                                                              | 随类型改写消失           |

匹配规则保持贡献者语义：`zh`、`zh-CN`、`zh-TW`、`en,zh;q=0.9` → 中文；其余 → 英文。

### 4.3 endpoints（只加一行接线）

`src/auth-endpoints.ts` 的 `serveLoginPage`：

```ts
res.end(loginPageHtml(next, undefined, langOf(req)));
```

`src/password-endpoints.ts` GET 分支同样。

**必须保留** development 已有的：

- `logoutOrder: number` on deps；
- `JSON.stringify({ authenticated, logoutOrder: deps.logoutOrder })`。

### 4.4 渲染层：保留贡献者设计，修门禁 / 无障碍

从 PR 保留：

- Apple 背景 / 白卡片 / 药丸输入 / 黑按钮；
- DeepSeek 鲸鱼 + HARNESS 徽章 SVG；
- 中英 `loginStrings` + 标语（`探索未至之境` / `Into the Unknown`）；
- blend 光标 + `prefers-reduced-motion` + `(hover: hover)` 触屏降级（拍板项 **C**）；
- input 上的 `aria-label`（autofocus 断言会变，测试一起改）；
- 零外链（字体 data-uri，拍板项 **B**）。

`renderLoginCard` 里 `htmlLang` / `securedBy` 用 `??`；`sloganHtml` 继续只吃
`escapeHtml(brandText)`。可见 label 是否恢复见拍板项 **A**。

### 4.5 必须改的配色（相对亮度实测）

对比度按 WCAG 相对亮度公式 `(L1+0.05)/(L2+0.05)`。文字门槛 4.5:1；非文字 UI
边界（1.4.11）3:1。与 `docs/login-page-polish-plan.md` §2 同一套算法。

| 角色                                        | PR 色       | 实测      | 门槛                                           | 改成        | 改后 |
| ------------------------------------------- | ----------- | --------- | ---------------------------------------------- | ----------- | ---- |
| 副标题 `#86868b` on `#fff` / `#f5f5f7`      | 3.62 / 3.33 | < 4.5     | `#6e6e73`                                      | 5.07 / 4.66 |
| 页脚 / placeholder `#a1a1a6`                | 2.36–2.57   | 远低于 AA | `#6e6e73`                                      | 同上        |
| 输入框描边（透明边 + `#f5f5f7` 底 vs 白卡） | 1.09        | < 3.0     | `1px solid #8a919a`（与当前 development 一致） | ~3.2        |

按钮白字 on `#0f1115`（18.9:1）、错误条 `#b91c1c` on `#fff5f5`（6.05:1）已达标，
不动。图标 `#86868b` on 输入底 `#f5f5f7` 为 3.33:1，过 1.4.11 的 3:1，可不改。

---

## 5. 测试清单

原则：HTML 契约进纯函数测试；端点只测「头 → 语言」这一跳。`describe` 回调按
`max-lines-per-function` 计 80 行，大块继续拆。仓库已有把 GET `/auth/status`
拆成 `*-endpoints.status.test.ts` 的先例。

### 5.1 新建 `src/login-page.test.ts`

从 `src/auth-endpoints.methods.test.ts` /
`src/password-endpoints.methods.test.ts` **搬过来**现有 HTML 用例（搬完
methods 文件更瘦，避免再顶 250）：

- error 转义 / 无 error 不渲染 `.error` / hidden `next` 转义；
- token：`autofocus`（断言改成带 `aria-label="Access token"` 的那串，随 A 决议调整）；
- password：username/password autocomplete；**只有** password 带 autofocus。

新增：

- 默认 `lang` → `lang="en"`、英文文案、`Paste your token` / `Sign in`；
- `lang: "zh"` → `lang="zh"`、中文文案、**不出现**英文 placeholder；
- slogan 文本被 escape；
- 含 `prefers-reduced-motion`、不含 `http://` 字体 URL（守零外链）；
- 副标题/页脚 CSS 含 `#6e6e73`（防 AA 回退）。

### 5.2 新建 `src/login-page-i18n.test.ts`

`langOf` 矩阵（构造最小 `IncomingMessage`）：

| Accept-Language                      | 期望 |
| ------------------------------------ | ---- |
| 缺省 / `""` / `en` / `en-US`         | `en` |
| `zh` / `zh-CN` / `zh-TW`             | `zh` |
| `en,zh;q=0.9`                        | `zh` |
| `zh-CN,zh;q=0.9,en;q=0.8`            | `zh` |
| 数组头 `["zh-CN","en"]`（Node 偶发） | `zh` |

### 5.3 端点接线（各 1 条，塞进现有 GET describe）

`src/auth-endpoints.test.ts`（239 行）、`src/password-endpoints.test.ts`（236 行）
的 `makeReq` 加可选 `acceptLanguage`，写进 `headers["accept-language"]`：

- `Accept-Language: zh-CN` → body 含中文标题/按钮；
- 无该头 → 英文。

加测前先数 skipBlank；超了就把 GET describe 拆成
`src/auth-endpoints.login-page.test.ts`（或 password 对应文件）。**禁止**再复制
150 行 harness，除非拆文件不可避免。

现有 GET 用例只断言 `<form` / `name="username"` / hidden next 转义，移植后应继续绿。

### 5.4 不改

- POST 401 / 限速 / session 用例；
- integration（`src/integration.auth.test.ts` 等只断言 `<form`），应继续绿；
- 不引入 DOM 解析依赖，继续纯字符串 `toContain`。

---

## 6. 文档与演示

`docs/development.md`「GUI demos」：用户可见 Web 行为必须带真机演示——真实
server、干净浏览器、非 mock 传输，并在演示旁写清证明了什么。

| 动作                                        | 说明                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| 重拍 `docs/demo/login-page.png`             | web-test 真机（password 模式），替换 README 现在那张      |
| PR 自带 4 张 `docs/screenshots/login-*.png` | 可留作设计参考；**不**当 DoD 证据（不是这棵提交跑出来的） |
| README / README.zh 演示图路径               | 仍指向 `docs/demo/login-page.png`，改图不改路径           |
| 散文契约                                    | 只写现在的行为；不写「本 PR / 曾经」                      |

可选一句（仅当 README 登录节需要）：登录页按 `Accept-Language` 在中/英之间切换。
不是配置项，不必进配置表。

---

## 7. 验证步骤（按顺序）

1. `npx prettier --write` 改动文件（或靠 pre-commit）。
2. `npm run lint` — 无 `max-lines` / unused / `||` / 索引签名。
3. `npm run type-check`。
4. 先跑受影响文件，再全量覆盖：
   ```
   npm run test -- src/login-page.test.ts src/login-page-i18n.test.ts \
     src/auth-endpoints.test.ts src/auth-endpoints.methods.test.ts \
     src/password-endpoints.test.ts src/password-endpoints.methods.test.ts
   npm run test:coverage
   ```
   覆盖率 80% 红线；新文件必须纳入覆盖。
5. `npm run build` 后 `git diff --exit-code -- lib`。
6. `npm run verify` 全套（format:check + lint + type-check + test:coverage + lock:check）。
7. **真机**：web-test（3081，password，`tester`）
   - 浏览器语言中文 → 中文登录页；
   - `curl -H 'Accept-Language: en' http://127.0.0.1:3081/auth/login` → 英文；
   - 登录成功、错误 401 仍纯文本（行为不变）；
   - 系统「减弱动态效果」时无光标环放大 / 入场动画；
   - 拍 `docs/demo/login-page.png`。

---

## 8. 提交 / 发布

- 推到 #53 上可以多 commit；**合入 `main` 仍 squash**
  （`gh pr merge 53 --squash`），一 PR 一条 conventional commit，release-please
  才不会双计。
- 不要在 feature 分支手改 `version` / `CHANGELOG.md`。
- 合之前维护者过目真机 / 截图；**不满意视觉就停，不发版**。

---

## 9. DoD

1. §4 文件拆分与接线落地；`logoutOrder` / status JSON 未被回退。
2. §4.5 三处对比度达标；零外链契约仍在。
3. §5 测试全绿（搬迁用例 + i18n 矩阵 + 端点接线）。
4. `npm run verify` 全绿；`lib/` 与 `src/` 同批提交，`git diff --exit-code -- lib` 通过。
5. 真机演示已拍进 `docs/demo/login-page.png`，并说明覆盖了中/英、reduced-motion、
   焦点落点。
6. 未触碰 §2.2。
7. #53 CI 绿；squash 作者为 BuvkB（若选 D1）。

---

## 10. 待拍板（开工前）

这些会改 §4 / §5 细节。默认 **A1 + B1 + C1 + D1**。

### A. 表单标签

- **A1（推荐）**：恢复可见 label（小字在输入框上方），placeholder 当提示。满足
  WCAG 3.3.2，和现在 development 页一致。
- **A2**：保持贡献者的「只有 icon + placeholder + aria-label」（更像 Apple，可见
  标签没了）。

### B. 内嵌字体 ~39KB HTML

- **B1（推荐）**：保留 Host Grotesk + Montserrat data-uri（零外网，贡献者品牌意图）。
- **B2**：删 `@font-face`，只用 `system-ui` / PingFang（页面更轻，标语会差一点）。

### C. blend 光标

- **C1（推荐）**：保留，触屏 / reduced-motion 已降级。
- **C2**：删 `CURSOR_SCRIPT`，少一截内联 JS。

### D. 合入通道

- **D1（推荐）**：修完 push 回 #53，squash 署名 BuvkB。
- **D2**：关 #53，从 `development` 新开 PR（维护者当作者 + Co-authored-by）。

---

## 11. 决议（拍板后填写）

| 项           | 选择                      | 日期 |
| ------------ | ------------------------- | ---- |
| A 表单标签   | _待填_                    |      |
| B 内嵌字体   | _待填_                    |      |
| C blend 光标 | _待填_                    |      |
| D 合入通道   | _待填_                    |      |
| squash 标题  | _待填_（保持原题 / 缩短） |      |
