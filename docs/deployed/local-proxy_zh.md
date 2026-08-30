# 认证本地代理（dsh-auth proxy）方案

> 状态：已评审，按此实施。目标读者：本仓库维护者与部署方。
> 约束：**不修改 dsh 源码**；Phase 1 不改 auth-gate 服务端逻辑。

## 0. 背景与结论

部署形态：dsh（0.1.1-rc.2，`web` profile）跑在服务器 `127.0.0.1:3080`，Caddy 终结
`https://dsh.hi-ruofei.com` 后反代到该端口，dsh-auth-gate（0.8.0，password 模式 + HTTPS）
守卫全部入口。

问题：远程浏览器在域名下打开"设置 → 模型"报
`加载提供方目录失败: settings are unavailable in this browser`。

已查明的事实链：

1. **dsh 客户端**：`dsh-client-connection` 的 `isLoopback` 只认页面 hostname
   （`localhost` / `[::1]` / `127/8`）。非 loopback 页面 → 设置镜像
   `SettingsDescribeMirror` 以 `"memory"` 模式运行 → `view` 为空 → 模型页抛出
   "settings are unavailable in this browser"（客户端自报，不会发请求）。
2. **dsh 服务端**：`/api` 的 `PRIVILEGED_METHODS`（`settings.*`、`credentials.*` 等）
   用**空信任列表**跑 `isTrustedApiRequest`，只检查 Host/Origin 头——认证无关。
3. **Caddy（已有配置）**：`header_up Host 127.0.0.1:3080` + `header_up Origin http://127.0.0.1:3080`
   → dsh 服务端看到的请求**本来就是 loopback+同源** → 配置域 403 实际不会发生。

**结论**：配置平面的 API 层对"经域名 + 带 auth-gate 登录态"的请求已经**双通过**；
唯一阻塞是**浏览器页面 origin 不是 loopback**（客户端检查）。因此：

- 新增"认证本地代理"——把页面 origin 变成 loopback，其余全复用既有链路；
- 服务端（dsh / auth-gate / Caddy）**零改动**（Phase 2 的可选 deny-list 除外，
  那是 auth-gate 仓库自身的增强）。

## 1. 架构

```
用户浏览器 (http://127.0.0.1:8443，页面 origin = loopback → 客户端放行)
   │  HTTP/1.1 + WebSocket 升级（Cookie: dsh_auth=… 由浏览器持有）
   ▼
dsh-auth proxy（用户本机，严格绑定 127.0.0.1，无状态透传）
   │  HTTPS + SNI=dsh.hi-ruofei.com，原样转发 Cookie/Bearer
   ▼
Caddy（TLS 终结；header_up Host/Origin → 127.0.0.1:3080）
   ▼
dsh @ 127.0.0.1:3080
   ├─ auth-gate guard（登录校验 ← 认证边界）
   └─ /api 围栏（看到 loopback 头 → 放行，含配置域）→ 模型配置页正常
```

代理需要做的只有三件事：透传一切（含流式响应）、转发两条 WebSocket 下行通道、
适配登录 Cookie（本地明文 http 时去掉 `Secure` 属性）。**不做任何 Host/Origin 改写**
（Caddy 统一覆盖；`--target http://127.0.0.1:3080` 的本地验证模式下 loopback 头本来就是真的）。

## 2. 组件：`dsh-auth proxy`

### 2.1 形态

零依赖 Node 脚本（Node ≥ 22 内置模块即可），随仓库 `bin/` 交付，避免引入构建与依赖链：

```
bin/dsh-auth-proxy.js         # 可执行入口（shebang node）
src/proxy/                    # 后续若做 TS 化，从纯 JS 迁入
docs/deployed/local-proxy.md           # 本文（en + zh 双语拆分时可再分）
```

交付两种使用方式：

```sh
node bin/dsh-auth-proxy.js --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com
# 或（安装后）
dsh-auth proxy --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com
```

后者需在 CLI（`src/cli.ts`）注册 `proxy` 子命令——若当前基线版本构建链不可用，
以独立 bin 为先，`package.json` 增加 `bin.dsh-auth-proxy`。

### 2.2 配置项

| 参数                    | 默认                        | 说明                                                                                  |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| `--listen`              | `127.0.0.1:8443`            | 必须回环；程序在非回环地址时**拒绝启动**                                              |
| `--target`              | `https://dsh.hi-ruofei.com` | 上游；默认要求 https 并校验 TLS                                                       |
| `--unsafe-plain-target` | 关                          | 允许 `--target http://…`（仅本地验证场景）                                            |
| `--strip-secure-cookie` | 开                          | 本地明文 http 时去掉 `Set-Cookie` 的 `Secure`（Chrome/Firefox 一般可留，Safari 兜底） |
| `--local-token-env`     | 空                          | 可选第二把锁：经代理的请求必须带 `Authorization: Bearer <env值>`                      |
| `--mark-proxy`          | 关                          | 每请求加 `X-Dsh-Proxy: 1` 头（Phase 2.1 deny-list 标记）                              |

### 2.3 行为规格

1. **页面/静态**：`GET /`、`/assets/*`、`/plugins/<id>/client.js?rev=…` 流式透传。
2. **API**：`POST /api/*` 双向流式透传（unary/respond/SSE；大附件不缓冲）。
3. **WebSocket**：`/api/events.mux`、`/api/events.host` 的 upgrade 握手转发，
   之后 socket 双向 pipe（Node `http` server `upgrade` 事件 → `https.request`
   upgrade 握手 → pipe）。
4. **认证入口**：`/auth/*` 全透传（登录页、`/auth/login` POST、`/auth/logout`、
   `/auth/status`）；响应 `Set-Cookie` 时按 `--strip-secure-cookie` 处理，保留
   `HttpOnly/SameSite/Path`；302 重定向原样透传。浏览器 cookie 归 `127.0.0.1:8443`
   名下，代理无状态，不存任何会话。
5. **安全**：默认完整校验上游证书；只代理到显式声明的 target；不落盘；
   限速/会话 TTL 全部沿用 auth-gate 现有逻辑。
6. **日志**：启动打印 listen/target；每请求一行（方法/路径/上游状态）；不入凭证。

## 3. 验证矩阵

### Phase 0 —— 链路验证（不改任何代码，服务器上做）

| #   | 操作                                                                                                        | 预期                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 0.1 | `curl -H 'Host: 127.0.0.1:3080' -H 'Origin: http://127.0.0.1:3080'` POST `/api/settings.describe`（无凭据） | 401（auth-gate 守卫），而不是 403（fence）                                  |
| 0.2 | `dsh-auth user add` 临时验证用户（一次性随机密码）→ `POST /auth/login` 拿 cookie → 带 cookie 重放 0.1       | 200 + JSON（namespaces 等），**证明"认证 + loopback 头 → 配置域 API 可达"** |
| 0.3 | 禁用临时用户（`dsh-auth user disable`）+ `POST /auth/logout` 吊销会话，确认不能再登录                       | 新登录 401；旧会话 401                                                      |

**Phase 0 实测结果（2026-08-26）**：全部通过。

- 0.1：HTTP 401（auth-gate 守卫拦在围栏之前）✅
- 0.2：`settings.describe` 返回 `{"ok":true,"value":{"writable":true,"hasDocument":true,"namespaces":[…],…}}` ✅
  推论成立：**认证 + loopback 头 = 配置域 API 可达**。对照组（域名头 + 认证）返回
  fence 的 `403 forbidden`，证明 `PRIVILEGED_METHODS` 在服务端确实存在且认证无关。
- 0.3：`POST /auth/logout` 302（吊销会话，GET 是 405——**登出必须用 POST**）；
  吊销后旧会话 401；`user disable` 后新登录 401。临时用户与会话均已清理 ✅

验证过程踩坑（重要，Phase 1 会用到）：

- **curl 不会对 `http://127.0.0.1` 发送 `Secure` cookie**（cookie 引擎无 localhost 豁免）——
  用 cookie jar 模拟认证时会被 auth-gate 以 401 拒绝，需显式 `-H "Cookie: dsh_auth=…"`
  或 https。浏览器（Chrome/Firefox 对 localhost 有豁免）不受影响；
  **代理的 `--strip-secure-cookie` 正是为此**（Safari 无豁免时的兜底）。
- RPC 信封必须是 `{"type":"client-request","rpcId":"<string>","method":"…","payload":{}}`
  - `Content-Type: application/json`，否则分别报协议校验错误 / 415。

### Phase 1 —— 代理实现与验证（服务器本机跑代理）

| #   | 操作                                                                                                                                      | 预期                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1  | `--target http://127.0.0.1:3080`：curl 经代理 `GET /` → 302 登录页；`POST /auth/login` 拿 cookie；带 cookie `POST /api/settings.describe` | 200                                                            |
| M2  | `--target https://dsh.hi-ruofei.com`（生产形态，走 Caddy 头改写）：重复 M1                                                                | 200                                                            |
| M3  | playwright（headless）打开 `http://127.0.0.1:8443` → 登录临时用户 → 设置→模型                                                             | 页面无 "settings are unavailable" 文案，出现提供方行；截图归档 |
| M4  | 回归：直接开 `https://dsh.hi-ruofei.com` 的模型页                                                                                         | 仍报原错误（预期——未走代理），证明代理必要且充分               |
| M5  | 聊天页发送一条消息（验证 events.mux/events.host 隧道）                                                                                    | 消息正常往返                                                   |
| M6  | 清理：停止代理、禁用临时用户、删除临时文件                                                                                                | —                                                              |

**Phase 1 实测结果（2026-08-26）**：全部通过（M5 以裸 WS 握手 101 验证，未做全聊天往返）。

- M1：登录 302 + `Set-Cookie` **无 Secure**（strip 生效，`HttpOnly; SameSite=Lax; Path=/` 保留）；
  `settings.describe` → `200 {"ok":true,…}` ✅
- M2：同上，经 `https://dsh.hi-ruofei.com`（Caddy 头改写）→ `200 ok:true` ✅
- M3：headless Chromium 经代理登录后，"设置→模型"完整渲染：`DeepSeek (deepseek-official)`、
  `opencode-go` 两行提供方均带"API 密钥已配置"徽标与编辑/删除按钮；页面无
  "unavailable/加载提供方"文案 ✅
- M4：同一浏览器直连 `https://dsh.hi-ruofei.com`，模型页仍显示
  "settings are unavailable in this browser" ✅（回归符合预期）
- M5：`GET /api/events.mux` 带会话 cookie 经代理握手 → `101 Switching Protocols` ✅
- M6：4 个临时会话全部 `POST /auth/logout` 吊销、临时用户 `disable`、代理停止、临时文件清理 ✅

**实现中修掉的两个代理缺陷**（均已进单测）：

1. **空 `Sec-WebSocket-Protocol` 头**：客户端未发该头时，转发器默认补了空值，
   dsh 的 WS 处理器直接 `400`；改为仅在客户端携带时转发（101 恢复正常）。
2. **EPIPE 未处理导致进程崩溃**：上游/下游 socket 在管道中半关闭后继续写入，
   `error` 无人监听 → 进程退出（浏览器并发加载插件 bundle 时必现）。
   已为全部 HTTP/WS socket 挂 destroy-on-error 并统一处理异常。

**验证环境注意事项**：

- 代理进程务必以 `nohup`（或 systemd）启动，普通后台进程在 shell 退出后会收到
  SIGHUP 终止。
- curl 不会向 `http://127.0.0.1` 发送 `Secure` cookie（cookie jar 需显式带头）；
  浏览器不受影响（localhost 为可信源），Safari 场景由 `--strip-secure-cookie` 兜底。

### Phase 2 —— 可选项（单独评审）

| #   | 项目                    | 状态                            | 说明                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `X-Dsh-Proxy` deny-list | ✅ 已实现（`feat/local-proxy`） | auth-gate 服务端 guard：对带 `X-Dsh-Proxy: 1` 标记的请求拒绝 `host.pickDirectory`/`host.openPath`/`settings.openDocument`/`llm.discoverModels`（403，与 /api 围栏同形）；无标记头时行为不变。代理侧 `--mark-proxy` 开启标记。**部署前提**：生产实例当前装的是 auth-gate 0.8.0（npm 包），需发布新版本后升级才生效（升级属部署决策，未随本方案执行） |
| 2.2 | 本地令牌门              | ✅ 已实现                       | `--local-token-env <VAR>`（未设置则 fail-closed 拒绝启动），文档化即可                                                                                                                                                                                                                                                                              |
| 2.3 | 分发                    | ⏳ 待办                         | `npm pack` 已包含 bin（`files: ["lib"]`）；systemd 单元示例与 README 增补待写                                                                                                                                                                                                                                                                       |
| 2.4 | 本机 TLS                | ⏳ 可选                         | 本地 `https://localhost:8443`（mkcert）替代 strip-Secure                                                                                                                                                                                                                                                                                            |

deny-list 生效链路：`dsh-auth-proxy --mark-proxy` 给每个请求加 `X-Dsh-Proxy: 1`
→ 服务端 auth-gate guard 在认证通过后命中禁行方法 → 403。未开 `--mark-proxy`
的代理或直接访问行为完全不变（安全边界由运维显式开启）。

## 4. 风险与回滚

- **R1 远程触发宿主原生能力**（`host.*` 等）：代理链路下 fence 视为 loopback。
  过渡期：文档注明"仅个人管理使用"；Phase 2.1 上线后关闭。
- **R2 Safari 拒收本地 Secure cookie**：默认 strip `Secure`（仅回环一跳，可接受）；
  或走 2.4。
- **R3 临时验证用户**：一次性随机密码、用后 `disable`、密码不出现在持久文件中。
- **回滚**：代理是纯本地组件，删除即回滚；服务端零变更。

## 5. 里程碑验收

- Phase 0 通过 = 0.2 返回 200 且 0.3 清理完成。
- Phase 1 通过 = M2 + M3 + M5 通过。
- Phase 2 每项独立验收。
