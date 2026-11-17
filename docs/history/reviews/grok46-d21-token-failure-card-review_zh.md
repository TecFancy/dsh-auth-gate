# grok-4.6 Review — token 模式登录失败渲染登录卡片（D21）

- **日期**: 2026-09-23
- **审阅者**: grok-4.6（SuperGrok 订阅，high effort，脚本通道 —— 无工具；评审包为可自足的
  diff + 新 ADR + 新测试 + 改后 `auth-endpoints.ts`）
- **范围**: `fix/token-failure-html-card` 上的未提交改动（基于 `development` `6c49546`）
- **结论**: **approve**（无安全/契约阻断项；两处文档缺陷需同 PR 内修掉）
- **标准**: 仓库 `AGENTS.md` + `.agents/skills/dsh-auth-code-review/SKILL.md` + issue #85

## 总评

「错 token 渲染空白 `text/plain` 页」这个浏览器死胡同修对了，且与 D20 修密码流同构；M2 里真正有
安全含义的不变量全部保住：`401` 状态码、单一常量、不反射请求文本、日志不含秘密与用户名、无
JavaScript 提交路径、`no-store`。评审包只带了英文 ADR，所以「中文 ADR 死链」这条是误报 —— 文件在
树里。评审另抓到两处**真实**文档缺陷，已在开 PR 前修掉：ADR 拿「F5 重放的是空字段」当不加脚本的理由
（机制说错了），以及把 `413` 说成「浏览器表单不可达」。

## Findings

| ID  | 级别  | 标题                                                               |
| --- | ----- | ------------------------------------------------------------------ |
| F1  | major | D21 ADR/索引：「F5 重放只校验空字段」事实错误                      |
| F2  | minor | D21 ADR：`413` 其实可达（粘贴超 16 KB），原文断言过度              |
| F3  | nit   | M2 的 401 body 被修订后，`impl-m3` P11「逐字节一致」会误导         |
| —   | 误报  | 「`decisions.md` 链了本次没加的中文 ADR」—— 文件在树里，评审包没带 |

### F1 — major —「F5 重放只校验空字段」事实错误

**位置**: `docs/decisions/implemented/2026-09-23-token-failure-html-card.en.md`（Decision 段
「Deliberately not added」）、其 `.zh.md` 对应段、`docs/decisions.md` 的 D21 条目。

**问题**: 刷新重放的是**原来那条 POST、带着原来的 token**，不是卡片上那个空字段；空字段只发生在
「在失败页上重新提交」。原文用错误机制为「不注入 `SUBMIT_SCRIPT`」辩护，同时把
`history.replaceState` 真正的价值（别让秘密留在可重放的历史项里）掩盖掉了。

**改法**: 改回正确机制，并把决策依据换成两条站得住的理由 —— token 模式没有失败预算可消耗（无限速
器，双击/刷新都锁不住人），以及注入脚本需要在共享页面 API 上加选项。`replaceState` 的卫生价值改写
成**明确记录的推迟项**，不再含糊过去。

### F2 — minor — `413` 通过粘贴超大 body 可达

**位置**: 同一份 ADR 的 Decision 段「Deliberately unchanged」。

**问题**: `415` 确实浏览器不可达（表单恒发 `application/x-www-form-urlencoded`），但 `413` 在粘贴
超过 16 KB 表单上限的 body 时可达。原文把两者一起说成「表单不可达」，是对用户输入的无据断言。

**改法**: 拆开写 —— `415` 浏览器不可达；`413` 可达但自作自受且无可操作，保留 `text/plain` 是因为
M19 的 `connection: close` 形状已冻结、改成卡片要新增文案。明确标为**已知残留**；
`auth-endpoints.login.test.ts` 现在锁死 `413` + `connection: close` + `text/plain`，防止将来「顺手
一起改」悄悄扩大影响面。

### F3 — nit — `impl-m3` P11「逐字节一致」

**位置**: `docs/implemented/impl-m3.md` P11（及其 `_zh.md`）。

**问题**: P11 说 token 模式与 M2 逐字节一致；有了 D21 之后，这句读起来像「token 401 还是
`text/plain`」。

**改法**: 补半句把该子句限定在「门 + credentials 接线」（两者仍零改动），并把浏览器表示指到 D21。

## 关注点逐条回应

1. **401 改卡片、状态码保留** —— 接受。状态码 / 一常量 / 不反射 / 日志纪律 / 无 JS 提交全部成立；
   只有「精确匹配旧 body 或 content-type」的客户端受影响，这是写进 ADR 的有意契约修订。
2. **413/415/503 保持 `text/plain`** —— 接受，并按 F2 修正措辞。边界是「用户可修复的认证失败 →
   HTML；协议/运维失败 → plain」，与 D20 同构；不要为消灭 503 白页去扩大范围。
3. **不加 `SUBMIT_SCRIPT`** —— 在 F1 修正后接受。不加是安全的，但理由必须说准；`replaceState` 的
   卫生价值记为推迟项。
4. **TOTP 独立常量** —— 接受。复用 `INVALID_CREDENTIALS` 会手因错位；把「过期」与「错误」拆开会变成
   探针。评审指出 "expired" 对「账号已无 secret」略过度承诺，建议中性的 `Invalid code.`；**维持原
   样**：一句话必须覆盖三态且不区分它们，这属于文案偏好而非安全属性。
5. **秘密泄露面** —— 接受。token 不进 HTML（无 `value`）、不进日志（`login rejected` 是字面量）、
   所有失败响应带 `no-store`。
6. **文档一致性** —— 接受并按上文修正。按要求做了独立全仓 grep（含 `lib/` 与随包 skill）：残留的
   `invalid token` / `text/plain 401` 只剩下历史记录（M2 原文 + 其修订行、D20 的取代注记、D21 自
   身、以及从未执行的 PR #53 计划）。
7. **测试强度** —— 接受。单元 + 集成在「退回 `text/plain`」时都会红；评审建议的补充已采纳（集成断言
   常量、`no-store`、不回显；`413` 锁 `text/plain`）。

## 建议落地顺序（合入前）

1. ADR 对 + `docs/decisions.md` 条目里 F1 + F2 的措辞修正（已完成）。
2. `impl-m3` P11 半句（已完成）。
3. 集成断言与 413 锁（已完成）。
4. `npm run verify` 全绿、`lib/` 同 commit 重建（已完成）。

## 范围外（明确不作为 finding）

- token 页的 `SUBMIT_SCRIPT` / `history.replaceState`（推迟，已记入 D21）。
- 把 `413`/`415`/`503` 改成卡片（刻意的边界；`413` 记为已知残留）。
- 从未执行的 `docs/plans/pr53-login-page-fix-plan*.md`（其「失败仍是 `401 text/plain`」是历史前提，
  属于一份没跑过的计划）。
- 把 TOTP 文案改成中性的 `Invalid code.`（文案偏好，不是缺陷）。
