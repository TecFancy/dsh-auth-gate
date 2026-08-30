# dsh-auth M3 交接文档（session handoff）

> 读者：在**新 session** 中执行 `docs/implemented/impl-m4.md` 的编码代理。本文件承载本 session 独有的
> 环境事实与过程知识——仓库里没有、重新探索成本高或会踩坑的内容。
> **阅读顺序：`AGENTS.md` → `docs/implemented/impl-m3_zh.md` → 本文档**；`docs/handoff/handoff-m2_zh.md` §3/§4 的
> 环境事实（沙箱网络、服务器访问、pkill 技巧、lint 陷阱）依然有效，不重复。

---

## 1. 一句话现状

M3（password 模式：users.yaml + scrypt + 限速 + `dsh-auth user` CLI）已交付：`npm run verify`
全绿（174 测试）、lib 同批、**真实服务器端到端冒烟全部通过**（登录/会话/Bearer 会话 token/
WS/429 限速/禁用用户/白名单）。`mode: "token"`（M2）行为零改动、回归绿。

## 2. 仓库与远端状态快照（2026-08-15 下午，push 后）

- 分支：`development` 已与 `origin/development` 同步（9 个提交全部推送，
  `git log --oneline origin/development..HEAD` 为空）：
  - M2：`c184dbc`（spec 最终化）→ `bbe39bd`（handoff 快照）→ `aee37b4`（feat 实施）→
    `6a5064e`（lazy credentials 文档）；
  - M3：`1fac9fe`（spec）→ `db21eac`（feat 实施）→ `e030e75`（docs 契约/handoff）→
    `5f049c2`（handoff 快照刷新 + plan 路线图 ✅）→ `04037a9`（部署交付物）。
- **PR #2 已开**（`development` → `main`，标题 "M2 shared token gate + M3 password login
  flow..."）：待合并。合并后 `main` 上的 `feat:` 提交会触发 release-please 自动开 **release
  PR**（版本 bump + CHANGELOG，见 `docs/specs/development.md` Releases）——那是自动化流程，无需
  手工处理；release PR 合并前不要手工改 `package.json` 版本。
- M3 实施期间的提交纪律照旧：`lib/` 与 `src/` 同批；`docs:`/`feat:` 分型。

## 3. M3 实施踩坑清单（新 session 直接规避）

1. **`deps.verify` 参数顺序**（必读，集成测试才暴露）：`PasswordLoginDeps.verify` 必须与
   `verifyPassword` **同形 `(password, storedHash)`**。TS 结构兼容不检查参数名——写反了
   单测（fake verify）全绿、**真实路径恒 401**（verifyPassword 把哈希串当口令解析段数失败）。
   本 session 实测踩中，已在 `impl-m3.md` §4.7 标注。
2. **effect 回调不得再包一层函数**（必读，所有集成测试 404 的根因）：`ctx.effect(() =>
mountAuthEndpoints(...))` 里，mountAuthEndpoints 必须**立即执行注册并返回合并 disposer**；
   若返回 `() => registerX(...)`，cordis 会把该函数当 disposer 存起来——注册永不发生，所有
   `/auth/*` 恒 404 且**单测（fake ctx 同步 effect）与集成测试表现不同**，定位绕了远路。
   已写进 `mountAuthEndpoints` 的 JSDoc。
3. **CLI readLine 竞态**（服务器冒烟才暴露）：`createInterface` 的 `once("line")`/`once("close")`
   在"管道数据先于 createInterface 到达并 EOF"时 close 可能先于 line → readLine 返回空串 →
   CLI 报 `empty password`（**本机管道也复现**；`node -e` 单测复现不了因为无前置 await）。
   修复：用 readline 的 **async iterator**（`for await (const line of lines) return line`）。
   `cli.test.ts` 的 fake io 覆盖不到真实 readLine——真实管道路径靠服务器冒烟兜底。
4. **scrypt maxmem 必须显式**：N=2¹⁵ 即超默认 32 MiB maxmem 抛 RangeError（本机实测）；
   N=2¹⁶/r=8 需要显式 `maxmem: 128 MiB`。单次派生 ~150 ms。
5. **`$` 在 `String.replace` replacement 里是捕获组语法**：`"$16384$"` 里的 `$1` 会被替换成
   空串——测试里改哈希参数段用 `split("$")`/`join("$")` 或构造新串，别用 replace。
6. **scrypt 的 N 参与派生**：改 stored 串的 N 段而不重派生 → 验证必失败。规格 §5 测试项 6
   的"替换 N 段"写法是错的，已修正为"构造旧参数哈希"（`impl-m3.md` 有注）。
7. **lint 行数陷阱再确认**：`max-lines` 250 是 skipBlankLines+skipComments 计数；测试文件
   helpers（MemTable/makeRes/harness 等 ~150 行）复制到每文件后，大套件**必须按 describe
   拆文件**（`password-endpoints` 系列因此拆成 5 个、integration 拆成 2 个）。`max-lines-per-function`
   把 describe 回调整体当函数计（80 行）——**单 describe 内用例总数超 80 非空行就报**。
8. **测试文件不得互相 import**：vitest 会把 import 的 `.test.ts` 当测试执行（describe 重复
   注册）；helpers 复制进各文件（M2 先例），不要建 src 内 helper 文件（会被 tsc 编进 lib/、
   进 coverage 统计）。
9. **`vi.mock` 是文件级**：mock 了 `registerPasswordEndpoints` 的文件里无法断言真实端点注册
   ——把"端点注册"断言放集成测试（`index.password.test.ts` 只断言 gate 类型 + usersPath deps）。
10. **fake ctx 的 effect 语义**（M1 教训重演）：callback 同步执行**并返回 disposer**，disposer
    只收集不执行——立即执行 disposer 会把守卫 unwrap 掉，自检 fail loud。
11. **fetch 集成测试的 body**：POST login 用例必须给 body（`makeReq` 的 asyncIterator 只在
    body 定义时 yield），否则 username 为空 → 走 DUMMY_HASH 路径 401（看起来像产品 bug）。

## 4. 服务器冒烟工作流（M3 版，已实测跑通）

在 handoff-m2 §3.2 基础上：

1. 同步 + 构建：`rsync -az --exclude node_modules --exclude .git .../dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
   → 服务器 `cd /tmp/dsh-auth-test && npm install --registry=https://registry.npmjs.org/ && npm run build`。
2. 建用户（**真实 CLI**，本次实测 0600 正确）：
   ```bash
   ssh ubuntu 'printf "%s\n" "<pw>" | node /tmp/dsh-auth-test/lib/cli.js user add admin --password-stdin --file ~/dsh-smoke/auth/users.yaml'
   ssh ubuntu 'node /tmp/dsh-auth-test/lib/cli.js user list --file ~/dsh-smoke/auth/users.yaml'
   ssh ubuntu 'stat -c "%a" ~/dsh-smoke/auth/users.yaml'   # 600
   ```
3. overlay `~/dsh-smoke/cordis.patch.yml`：`dsh-auth` 行
   `config: { mode: "password", cookieSecure: false }`（探针行已删）。
4. 重启：kill（`pkill -f "[d]sh --profile web --port 3081"`）与启动分两个 ssh 调用；
   **启动的 ssh 调用可能挂 2 分钟超时**（nohup 子进程 fd 让 ssh 等待）——**超时是正常的，
   nohup 进程其实已起**，另开 ssh 检查 `pgrep` + `boot.log` 的 `dsh web:` 行即可。
5. 验证序列（本 session 全部实测通过；TOK 提取用 `grep dsh_auth jar | awk "{print \$7}"`——
   嵌套引号里 `$6=="..."` 会被 ssh 破坏）：
   - `GET /auth/login` → 200 含 `name="username"`；
   - 错口令 → 401；对 → 302 + `set-cookie`（cookieSecure=false 无 `; Secure`）；
   - 带 cookie `/__auth_probe` → 200；无 cookie JSON → 401 / HTML → 302；
   - `Authorization: Bearer <会话 token>` → 200；错 → 401；
   - `/auth/status` → `{"authenticated":true}`；disabled 用户 → 401；
   - `/auth/whatever` → 404；`DELETE /auth/login` → 405；
   - logout → 302 + `Max-Age=0`；原 cookie → 401；
   - WS：无凭证首行 401、cookie 101、Bearer 101；
   - 429：**注意 IP 桶会累计前面步骤的失败**（disabled 登录也计失败）——锁定会比"连发 6 次"
     提前出现，行为正确（5 次失败锁定、`retry-after: 30`、锁定期正确口令也 429、登录页仍 200）。
6. 实例已停止（本 session 收尾 `pkill`）；下次使用先 `pgrep` 检查。

## 5. 留给 M4 的起点提示

- 用户记录已含 `totpSecret` 字段（zod 解析、未使用）；M4 TOTP 两段式登录直接在
  `password-login.ts` / `password-endpoints.ts` 上加挑战阶段。
- 已评估未做项（`impl-m3.md` §9）：禁用用户即时吊销会话（`SessionStore` 加 `revokeBySubject`
  或门内查用户状态——注意门内做文件 IO 的性能/缓存取舍）、CSRF token、限速持久化、
  token+password 双模式并存。
- 冒烟验证过的 Bearer=会话 token 语义：`GET /auth/status` 只认 cookie（M5 冻结，未变）。
- CLI 的 readLine 已用 async iterator 修复——若 M4 加交互式输入（如 TOTP secret 生成），
  复用同一模式。

## 6. 开放问题 / 待定

- 部署侧交付物已完成并实测：`deploy/cordis.patch.yml`（生产 overlay 模板）+ `docs/deployed/deployment_zh.md`
  （部署与验收清单）——已在服务器按文档流程走通（`npm pack` → `dsh plugin --profile web add`
  → 包名引用 overlay → 验收序列 A–H 全绿，含 `cookieSecure: true` 的 `; Secure` cookie）。
- 无阻塞项。候选后续：M4 规格（TOTP）、GUI 登出按钮（client 半边）。
