# dsh-auth M4 交接文档（session handoff）

> ## Amendment（2026-08-30）：0.11.0 已发布，0.11.1 加固落地
>
> M4 之后的安全评审（Grok 4.6）→ 修复计划（`docs/implemented/totp-fix-plan.md`，决策 A）→
> 已实现并以 **0.11.1** 发布（PR #63 `fix:`、PR #64 `docs:`、release PR #65）。
> 本块以下的内容是原始 M4 交接文档；下列覆盖项对任何新 session 生效，
> 取代对应原文：
>
> - **§2 提到的 M4 PR 系列已完成**：`feat:`（TOTP，commit `9040228`）→ 以 squash #60
>   合入 main → **v0.11.0**（tag `669b793`）；加固修复 `d0df533` → 以 squash #63 合入
>   main → **v0.11.1**（tag `v0.11.1`）。`development` 已与 `main` 完全同步。
> - **契约变更（0.11.1）**：challenge cookie 改为 HMAC 签名
>   （`<user>.<exp>.<mac>`，ADR D10，`src/features/password/challenge-cookie.ts`）；`off`
>   门控 submit 路径与 GET 渲染；submit 路径检查 `user.disabled`；replay guard 以 counter
>   为键；`recordSuccess` 移到 store 可用之后；TOTP 失败返回 401 + challenge 页 HTML
>   （error slot）。完整清单见 `docs/implemented/impl-m4.md` 的 amendment 块。
> - **环境**：`web-test` profile 在 0.11.1 上；`totpverify` 测试用户存在（secret 在
>   `dsh-auth user totp enable totpverify` 的输出历史里）。主实例（端口 3080，`dsh web`）
>   仍在 **0.11.0**——升级它是下一个运维步骤（需要重启；重启会杀掉进行中的 TOTP
>   challenge，README 已有文档说明）。
> - 测试清单现约 300+ 测试；新文件 `challenge-cookie.ts/.test.ts`、
>   `integration-totp-helpers.ts`、`integration.totp-hardening.test.ts`；
>   `scripts/verify-slice-boundaries.mjs` 白名单已扩充。

> 读者：在**新 session** 中执行 `docs/specs/impl-m5.md`（独立反向代理 shell 模式）的编码代理。
> 本文件承载本 session 独有的环境事实与过程知识——仓库里没有、重新探索成本高或会踩坑的内容。
> **阅读顺序：`AGENTS.md` → `docs/implemented/impl-m4_zh.md` → 本文档**；`docs/handoff/handoff-m2_zh.md` §3/§4/§5
> 与 `docs/handoff/handoff-m3_zh.md` §3/§4 的环境事实依然有效，不重复。

---

## 1. 一句话现状

M4（TOTP 两段式登录：`features/totp/` slice + 无状态 challenge cookie + replay guard + `user totp`
CLI + `totp: off|optional|required` 配置）已交付：`npm run verify` 全绿（277 测试，覆盖率
90.53 %）、lib 同批、**与 otplib@13.5.0 逐位交叉验证通过（206 项检查）**（见 §5），
`web-test` 上的全部真实服务器端到端冒烟通过（见 §3.2）。`mode: "token"`（M2）与纯口令
行为（M3）零改动，全绿。

## 2. 仓库与远端状态快照（2026-08-30，实施后、PR 前）

- 分支：`development` 在 `f91c6f7`；M4 的工作**未提交**（src/lib/docs/scripts）。`main` = `aabe054`
  （v0.10.0）。M4 PR 系列预期的提交拆分（每个关注点一个 PR，head 均为 development）：
  `feat:` 实施（src + lib + test/ harness + scripts/verify-slice-boundaries.mjs），随后 `docs:` 一批
  （impl-m4.md + impl-m4_zh.md + ADRs + decisions.md + README 中/英），最后经 merge 到 main 发布。
- `test/password-totp-harness.ts` 是新增的 **src 外部**共享测试 harness（本仓库首个；
  见 §4 踩坑 12）。`tsconfig.json` 的 include 现已列出 `test`。
- M4 规格是 `docs/implemented/impl-m4.md`（决策表 T1–T16）——是 what/why 的权威；本文档讲 how。

## 3. 服务器冒烟（M4 版，已在 web-test 上真实端到端跑过）

### 3.1 环境事实

- web-test：`dsh --profile web-test --patch /tmp/auth-gate-pack/web-test-override.yml --host 127.0.0.1 --port 3081 --no-open`，
  以 cwd `/data/disk/dsh-workspaces/personal` 启动（nohup，日志 `/tmp/dsh-web-test.log`）。
  Override 文件现含 `totp: "optional"`、`logoutOrder: 5200`、usersFile
  `/home/ubuntu/.dsh/profiles/web-test/auth/users.yaml`。
- 更新插件：`cd /home/ubuntu/.dsh/profiles/web-test && npm install /tmp/auth-gate-pack/dsh-auth-gate-0.9.1.tgz` ——
  这会把 `package.json` 依赖改写成 `file:` tarball 引用（`^0.10.0` 被替换；**测试后如 profile 想跟踪
  发布版本，把 `^0.10.0` semver 范围改回来**）。
  然后重启：`PID=$(pgrep -f "dsh --profile web-test" | head -1); kill $PID; sleep 2;` + 上面的 nohup 行；
  探测前等 ~12 秒。
- web-test 上的 TOTP 用户：`tester`（口令 `test-pass-2026`），TOTP secret
  `4YIBSDMC4XUOOOEAWULTVWKPXEMBLIKQ`（由新 CLI 生成；otpauth URI 在 enable 时打印）。
  **不要把这个 secret 当敏感信息——它是冒烟测试 fixture。**
- 重启会清空内存中的 replay guard（符合预期；README 已有文档说明）。

### 3.2 验证序列（本 session 全部真实跑过且通过）

1. `GET /auth/login`（无 challenge cookie）→ 200 口令页（含 `name="username"`）。
2. `POST /auth/login {username=tester, password=test-pass-2026, next=/models}` → **302** 到
   `/auth/login?next=%2Fmodels` + `set-cookie: dsh_auth_challenge=tester.<exp>; Max-Age=300; HttpOnly; SameSite=Lax`
   ——**无 session cookie**（两段式启用；challenge TTL 300 秒）。
3. 带 challenge cookie `GET /auth/login` → 200 TOTP 页：`name="code"`、`autocomplete="one-time-code"`、
   `inputmode="numeric"` 均在。
4. 带 challenge cookie `POST /auth/login {code=000000}` → **401** `invalid credentials`。
5. 正确 code（用 `lib/features/totp/index.js` 的 `totpCodeAt(secret, floor(Date.now()/30000))` 计算）→
   **302** `/models`，同一响应带**两个 set-cookie 头**：challenge 清除（`Max-Age=0`）与
   session cookie `dsh_auth=...; Max-Age=604800`。
6. 带 session cookie：`GET /auth/status` → `{"authenticated":true,"logoutOrder":5200}`。
7. **Replay**：用新的 challenge cookie（再走一遍口令阶段），POST _同一个_ code → **401**
   （内存中的 replay guard；有效是因为 guard 以每个用户的 `(counter, code)` 为键）。
8. 登出回归：带 session cookie `POST /auth/logout?next=/` → 302 + `set-cookie: dsh_auth=; Max-Age=0`；
   原 session cookie 在非白名单路径上现在 401，`/auth/status` 报 `authenticated:false`
   （200 状态是设计使然——`/auth/*` 在白名单；读 body）。
9. 默认 off 行为隐式验证：在 override 加 `totp: "optional"` 之前，同一个带 secret 的用户
   拿到的是**直通 session**（M3 行为）——`off` 默认真的忽略 secrets。

### 3.3 未在服务器冒烟（由单元/集成测试覆盖）

- `totp: "required"`（无 secret 用户被拦）：由集成测试
  `integration.totp.test.ts` 的 "required mode: user without a secret is blocked with 401" 覆盖。
- M4 后 `mode: "token"` 字节级一致：由既有 token 套件覆盖；M4 没有触碰 token 路径。

## 4. M4 实施踩坑清单（新 session 直接规避）

1. **`Buffer` 没有 base32**（Node 24 仍抛 `ERR_UNKNOWN_ENCODING`）——`totp.ts` 自写
   encode/decode（约 40 行，RFC 4648，大写无填充）。通过往返测试做单元验证。
2. **RFC 6238 Appendix-B 向量需要 `counter = floor(T/30)`**：表里的 `T` 是 Unix _秒_，不是
   counter。首版测试草稿把 T 当 counter，用 `T * 30_000 ms`，实现正确却全部向量失败。
   核心 HOTP 用 RFC 4226 Appendix D（`counter=0 → 755224`）验证。
3. **otplib@13 是异步的且有 ≥16 字节 secret 护栏**（交叉验证与将来作依赖都用得上）：
   `generate({secret, epoch})` 返回 Promise；`verify({token, secret, epoch, epochTolerance})`
   收一个 options 对象并返回 `{valid, delta}`——不是 `(token, options)`，也不是 `{ok}`。
   交叉验证脚本（一次性，`/tmp/totp-crosscheck/verify.mjs`）跑 6 个 RFC 向量 + 200 组随机
   secrets×counters ×（window±1 命中 + window 外拒绝）；**206 项检查，逐位一致**。
4. **`setHeader("set-cookie", ...)` 调两次会覆盖**：在同一响应里既清除 challenge cookie 又签发
   session 时，传**数组**（见 `issueSession` 的 `extraSetCookie`）；第二次 `setHeader` 调用
   会静默丢掉第一个 cookie。集成测试用 `getSetCookie()`（不是 `get()`，后者用 ", " 拼值、
   会误导 `.split(";")` 解析）断言两个头。
5. **测试 fakes 必须对 set-cookie 数组 `String(value)`**——endpoint 测试 fakes 把 headers
   存在普通对象里；直接透传数组会破坏 `.toMatch`/`.toContain` 断言。6 个遗留
   password-endpoints fakes 全部规范为 `String(value)`。
6. **`exactOptionalPropertyTypes` 会咬测试里的对象构造**：`{ method, cookie: undefined }` 是类型
   错误。按条件构造 options（见 `test/password-totp-harness.ts` 的 `post()`）。
7. **行数预算（max-lines 250 / max-lines-per-function 80，空白+注释行跳过）**：共享
   harness（`MemTable`+`makeRes`+`makeReq`+`makeHarness` ≈ 210 行）若每文件复制一份，
   会把行数推过 250。M4 把 `test/password-totp-harness.ts` 建在 **src/ 之外**，由两个阶段
   测试文件 import——vitest 只自动收集 `src/**/*.test.ts`，tsc build include 只有 `src`，
   coverage include 是 `src/**`，slice 脚本已教会接受 `test/` 作为叶子目标。另外：
   prettier 拒绝把多属性对象行并在一起，所以在 fakes 里合并 TOTP deps 行**不会**减少行数——
   要压缩真实代码（如单行 `return Promise.resolve({...})`、单行 flush 箭头）。
8. **`describe` 回调计入 max-lines-per-function**：集成测试必须拆成两个 describe
   （而非一个大 flow describe）；每个 describe 的非空行保持 ≤ 80。
9. **`features/totp/` 必须先加进 `FEATURE_SLICES`**（`scripts/verify-slice-boundaries.mjs`），
   在首个文件落地_之前_（未知路径 fail closed），并把 `src/cli.totp.test.ts` +
   `src/integration.totp.test.ts` 加进 `ROOT_FILES`。
10. **schemastery 里没有 `z.enum`**（本仓库的配置校验器）：用
    `z.union([z.const("off"), z.const("optional"), z.const("required")])`，跟既有的 `mode` union 一样。
11. **绝不记录 codes 或 challenge cookies**（P23/M21）：上面的冒烟步骤仅为 fixture 用户
    打印它们；生产代码路径从不打印。
12. **`test/` 目录是仓库新形态**：保持它作为唯一共享测试 harness 位置；不要把 harness
    复制回各文件副本（会撑爆行数预算），也不要在 `src/` 里建 helpers（会被编进 lib/、
    计入 coverage）——M3 踩坑 8 的精神保留，位置是新的。

## 5. 交叉验证证据（规格 T16 要求）

- 脚本：`/tmp/totp-crosscheck/verify.mjs`（一次性；未提交——development.md 规则 4）。
- 重跑方法：仓库内 `npm run build`，然后
  `cd /tmp/totp-crosscheck && node verify.mjs`（otplib@13.5.0 已装在那里，公共 registry）。
- 结果记录：`CROSS-VALIDATION PASSED: 206 checks, bit-for-bit match with otplib@13.5.0`
  （2026-08-30，Node 24.19.0）。6 个 RFC 6238 Appendix-B 向量（按 6 位截断，counter=floor(T/30)）
  加 200 组随机用例：generate 一致、counter±1 时 verify 通过、counter±2 时 verify 拒绝。

## 6. 开放问题 / 待定

- `web-test` profile 的 `package.json` 现在把 dsh-auth-gate 钉在 `file:` tarball 上；
  **本 PR 落地后，如 profile 想跟踪发布版本，把 `^0.10.0` 改回来（或升到下一版本）**。
- `PR #53`（登录页重设计，fan PR）仍开着，未动。
- 无阻塞项。候选后续：M5 规格（独立反向代理 shell 模式——见 `docs/specs/dsh-auth-plan.md`
  §9 的 M5 笔记）、GUI 登录页 i18n、`revokeBySubject`/CSRF/持久化 再评估（M4 冻结否决，
  ADR D8）。
