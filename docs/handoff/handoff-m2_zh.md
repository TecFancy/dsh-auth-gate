# dsh-auth M2 交接文档（session handoff）

> 读者：在**新 session** 中执行 `docs/implemented/impl-m2_zh.md` 的编码代理。本文件承载本 session 独有的
> 环境事实与过程知识——仓库里没有、重新探索成本高或会踩坑的内容。
> **阅读顺序：`AGENTS.md` → `docs/implemented/impl-m2_zh.md` → 本文档**。

---

## 1. 一句话现状

M1（守卫 + 持久化会话 + 自检）已交付并在**真实 Ubuntu 服务器上端到端验证通过**（四类入口全守卫、
401/302 行为正确）；M2（共享 token 门 + 登录页 + Bearer）规格已冻结，待新 session 实施。

## 2. 仓库与远端状态快照（2026-08-14 晚）

- 分支：`development`（开发唯一分支；`main` 只收 merge；**永不直接提交 main**）。
- 远端 `origin/development` 已同步到 `4b5f712`（M1 全部提交已推，CI 对最新提交**全绿**）；无 open PR。
- 本地 `development` 已含 M2 规格最终化（`c184dbc` + `bbe39bd`）与 **M2 实施提交**（未推）；工作区状态
  以 `git status` 为准。提交历史：`02c6f73`（spec+skills 基线）→ `eedfda9`（deps）→ `168b41e`（M1 实现）
  → `4b5f712`（spec 修正）→ `c184dbc`/`bbe39bd`（M2 规格最终化）→ M2 实施提交。
- M2 实施后**提交纪律**：未获用户指令不 commit/push；commit 用 Conventional Commits；`lib/` 与 `src/`
  同批提交（CI 有 parity gate）。

## 3. 环境事实（新 session 必读）

### 3.1 沙箱网络限制（关键！）

- **本机 loopback 不可达**：从执行环境 `node fetch`/`curl --noproxy` 访问 `127.0.0.1:*` 会超时；
  经环境代理（`http_proxy=127.0.0.1:7890`，Clash）返回 502。**不要在本地起实例后尝试 curl 验证**。
- 可用通道：**SSH 到 Ubuntu 服务器**（`ssh ubuntu`，别名指向 49.232.250.16，免密）——服务器上的
  loopback 正常，所有 HTTP 验证在服务器端做。
- `gh` CLI 可用（GitHub 认证正常）。

### 3.2 Ubuntu 服务器（验证环境）

- `ssh ubuntu`：Linux VM，Node v24.19.0（原生 TS strip 支持），npm 11.17.0。
- **dsh 已全局安装**：`~/.npm-global/bin/dsh`（用户级 prefix，版本 0.1.0-rc.6，与部署一致）。
  注意 PATH 里没有，用全路径或 `export PATH="$HOME/.npm-global/bin:$PATH"`。
- **冒烟实例**：`~/dsh-smoke/`（独立 DSH_HOME）+ `/tmp/dsh-auth-test/`（rsync 的 dsh-auth 工作树 +
  `probe.mjs` 探针）。
  - 启动：`cd ~/dsh-smoke && DSH_HOME=~/dsh-smoke ~/.npm-global/bin/dsh --profile web --port 3081`
    （后台：`nohup ... > ~/dsh-smoke/boot.log 2>&1 < /dev/null &`，等 ~25s）。
  - 停止：`ssh ubuntu 'pkill -f "dsh --profile web --port 3081"'`。
  - 实例可能已被上一 session 停止——**每次使用前先检查**（`pgrep -f` / curl）。
  - 该实例**无认证**（M1 门是惰性的），公网可达——只放测试数据。
- overlay 机制：`~/dsh-smoke/cordis.patch.yml`（$DSH_HOME 层）→ `- insert: { id, name }` 行。
  M1 冒烟在 overlay 里插了两行：`dsh-auth`（name = `/tmp/dsh-auth-test/lib/index.js`）+
  `dsh-auth-smoke-probe`（探针：注册 `/__auth_probe` 路由 + 把 `ctx.auth.gate` 换成
  "仅拒绝该路径" 的门，验证守卫包装与拒绝链）。M2 冒烟改此文件（见 §5）。
- 服务器端 curl 序列（M1 已用，M2 照此扩展）：
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/__auth_probe -H "Accept: application/json"   # 401
  curl -s -i http://127.0.0.1:3081/__auth_probe -H "Accept: text/html" | head -3                              # 302 + location
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/                                            # 200
  ```
  启动证据看 `boot.log`：`[smoke-probe-late]` 行列出四类入口守卫状态（G=guarded）。

### 3.3 本机（源仓库机器）

- dsh 安装：`/Users/randal/.volta/tools/image/node/24.13.1/lib/node_modules/@deepseek-ai/dsh/`；
  包源码/类型在 `node_modules/@deepseek-ai/*`（0.1.0-rc.6）——M1 规格 §2 的权威事实都来自这里，
  **规格已覆盖，不要重新探索**。
- npm registry：本机 `NPM_CONFIG_REGISTRY` 指向内网镜像——**安装必须显式
  `--registry=https://registry.npmjs.org/`**（AGENTS.md 规则，`lock:check` 会查）。
- 源码仓库：`/Users/randal/source/dsh-auth/`（Node ≥ 22.19 要求，本机 24.x）。

### 3.4 动态插件环境限制（为什么 M2 验证不走 create mode）

本 session 实测：动态插件（cordis_define/cordis_run）里对服务实例的**函数型属性读取被包装**
（每次读回新绑定副本）→ `fallback` 赋值不生效、函数身份标记读不回来 → 完整守卫（fallback +
方法替换 + 自检）**无法在动态插件形态下运行**；且失败运行不回滚表包装。**M2 验证一律走
本地集成测试 + 服务器端到端**，不要用动态插件。

## 4. M1 实施踩坑清单（新 session 直接规避）

1. **cordis `ctx.effect` 回调立即执行**：effect 的 callback 在注册时同步执行并返回 disposer——
   写假 ctx 测试时必须调用 callback 而不是只存数组（M1 曾因此 4 个测试假失败）。
2. **domain 名约束**：`DomainSpec.name`/表名必须匹配 `/^[a-z][a-z0-9_]*$/`（**禁连字符**）；
   `dsh_auth_sessions`（下划线）。违者 `defineDomain` 模块加载即抛。
3. **异步 open 的 promise 拆分**：`opening = storageDomain.open(spec)` 与
   `ready = opening.then(...)` 必须分开——`ready` 挂 `.then` 后解析为 `void`，disposer 要从
   原始 `opening` 取 domain 来 close（否则泄漏）。
4. **schemastery 可调用类型**：`Config({})` 运行时填默认值，但 TS 签名要求完整形状——
   测试里用 `{} as AuthConfig`。
5. **lint 摩擦**（strictest preset）：
   - 无 await 的函数不要标 `async`（require-await error）；
   - 方法引用分离调用 → `unbound-method`：用 `.bind(obj)`（接口方法）或 `Reflect.get` 绕开；
   - `Function` 类型被禁（`no-unsafe-function-type`）→ `(...args: never[]) => unknown`；
   - `max-lines-per-function` 80 行 → 大测试拆多个 `describe`；文件 ≤250 行；
   - `noPropertyAccessFromIndexSignature`：`obj["key"]` 而非 `obj.key`（Record 类型）。
6. **fakes 必须保真 promise 语义**：`open` 假实现要 `Promise.resolve/reject`（同步抛错/返回值
   会暴露为同步错误，与真实行为不符）。
7. **集成测试挂 storage 栈顺序**：`Storage` → `storage-json` → `storage-domain` → `WebServer` →
   本插件；dispose 逆序。真实 WebServer 挂载即监听（`ctx.plugin(WebServer, {host, port: 0})`）。

## 5. M2 服务器端到端冒烟工作流（DoD 第 4 项）

在 §3.2 基础上：

1. 同步新代码：`rsync -az --exclude node_modules --exclude .git /Users/randal/source/dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
   （服务器上再 `cd /tmp/dsh-auth-test && npm install --registry=... && npm run build`——lib 必须重建）。
2. 写测试凭证：服务器上 `mkdir -p ~/dsh-smoke && cat > ~/dsh-smoke/.credentials.yaml <<EOF
DSH_AUTH_TOKEN: <随机测试值>
EOF
chmod 600 ~/dsh-smoke/.credentials.yaml`
   （`dsh-credentials-local` 的 `assertOwnerOnly` 要求 0600，否则启动抛错！）
3. overlay 的 `dsh-auth` 行加 config：
   ```yaml
   - insert:
       - id: dsh-auth
         name: "/tmp/dsh-auth-test/lib/index.js"
         config:
           cookieSecure: false # http 测试环境；生产默认 true
   ```
   **M1 遗留的探针行必须删除**（M2 实测：`probe.mjs` 会 `ctx.auth.gate = 自己的门`——保留则
   `/__auth_probe` 测的是探针门而不是真实 TokenGate，冒烟全假）。`/__auth_probe` 路径本身仍可测
   （无路由 → fallback → 被守卫 → 302/401；带 cookie → SPA 200）。
4. 重启实例（§3.2），验证序列（在服务器上，cookie 用 `curl -c jar -b jar` 维护）：
   - `GET /__auth_probe` 无 cookie：HTML accept → 302；JSON accept → 401（**这次是真的守卫**，不再是探针门）；
   - `GET /auth/login` → 200 HTML；`GET /auth/whatever` → 404（兜底，非 SPA fallback）；
     `DELETE /auth/login` → 405；
   - `POST /auth/login` 错 token → 401；对 token（`-d "token=<v>" -c jar`）→ 302 + `set-cookie`；
   - 带 cookie 再 `GET /__auth_probe`（`-b jar`）→ 200；
   - `Authorization: Bearer <token>` → 200；
   - WS 通道：`curl --http1.1 -s -i --max-time 2 -H "Connection: Upgrade" -H "Upgrade: websocket"
-H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H "Sec-WebSocket-Version: 13"
http://127.0.0.1:3081/api/events.host`：无 cookie → 首行 `HTTP/1.1 401`；`-b jar` →
     首行 `HTTP/1.1 101`（`--max-time` 超时退出属正常，看首行即可）；
   - `POST /auth/logout?next=/`（`-X POST -b jar`，无需 body/content-type）→ 302 + `Max-Age=0`；
     原 cookie 再 `GET /__auth_probe` → 401。
5. 收尾：杀掉实例或留用（报告状态）。

**M2 冒烟调试技巧（实测有效）**：

- `dsh --profile web --dump-config` 看最终组合树（行 id、config、顺序），不必猜。
- 诊断插件/路由**挂在 `/auth/*` 前缀下**（如 `/auth/__diag`）才能绕过门直接 curl——门白名单放行
  `/auth/*`，exact 优先于兜底 prefix。
- 插件内 `console.log` 会进 `boot.log`（`ctx.logger` 的输出不一定落盘）——诊断首选 console.log。

## 6. M2 特有执行注意（规格之外的提醒）

- **凭证永不落日志**：token 值、session token 只出现在响应与内存；`resolveToken` 失败只记消息。
- credentials 服务在 web 组合里由 `dsh-base` bundle 提供（`credentials` 行）——**不要自己挂**；
  **集成测试不挂真实 provider**（规格 M18：零新增依赖）——用结构型假 provider
  `ctx.provide("credentials", { resolve })` 先于本插件挂载；真实 provider 只在服务器冒烟覆盖
  （§5.2 的 `.credentials.yaml`，记得 0600；env 层优先——`process.env.DSH_AUTH_TOKEN` 也可直接供冒烟）。
- **挂载竞态（M2 冒烟实测，必读）**：harness **并行挂载行**——`credentials` 行（dsh-base）可能在
  dsh-auth（用户层）apply **之后**才就绪。**不要在 apply 时读 `ctx.get("credentials")`**——解析器
  必须每次 resolve 惰性现取（规格 §3.1/§4.6 已冻结）；否则真实组合里登录恒 401、Bearer 恒拒绝，
  而集成测试（顺序挂载）全绿——冒烟才能暴露。`storageDomain` 无此竞态（与 webServer 同 bundle，
  inject 保证可见）。
- `mode: "password"` 在 M2 会抛错（fail loud）——规格 M11，别当成 bug。
- **集成测试登录流程必须挂真实 storage 栈**（Storage → storage-json → storage-domain，见
  `integration.auth.test.ts`）：只挂 WebServer 时 `auth.sessions` 恒 undefined → 登录恒 503
  （fail-closed，不是 bug）——首次实现就踩了。
- **lint 行数陷阱**：`max-lines` 计数 **skipBlankLines**（格式化后重排会把文件推过 250 上限，先
  prettier 再数）；`max-lines-per-function` 把 describe 回调整体当函数计——大套件必须按 describe
  拆（auth-endpoints 测试因此拆成三个文件）。
- **`KvTable` 真实接口比 impl-m1 §2.2 列的多**：还要实现 `keys()` 与 `update()`，否则测试里
  `implements KvTable` 直接类型错误（MemTable 以 session-store.test.ts 的为准）。
- **eslint 类型解析退化**：`Array.isArray(x) ? x[0] : x` 再链式 `?.split()[0]` 会被判 `any`（
  no-unsafe-* 报错）——用 `typeof x === "string"` 收窄（form-body.ts 踩过）。
- **服务器进程管理**：`pkill -f "dsh --profile web --port 3081"` 会匹配到执行它的 shell 自身
  （命令行含同样字符串）→ 自杀 + exit 255。用 `pkill -f "[d]sh --profile web --port 3081"`
  （括号技巧），且 kill 与启动分两个 ssh 调用（启动命令的 nohup 行同样会命中 pkill）。
- M2 完成后的下一步候选：正式生产 `cordis.patch.yml`（name 用 npm 包名而非路径）+ 部署验收清单
  （plan §8：auth 行健康检查、TLS 前置、`--trusted-host` 正交说明）。

## 7. 开放问题 / 待定

- 无阻塞项。候选后续：登录页 UX 打磨、`/auth/status` 接 GUI 登出按钮（client 半边）、M3 规格。
