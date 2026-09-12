# 入口覆盖回归 - dsh 0.1.5-rc.2 上的 dsh-auth-gate

对宿主 `webServer` 路由表可能暴露的**每一个** HTTP/WS 入口做**未认证**实打，
在 dsh 0.1.5-rc.2 升级后的线上宿主上执行。

**结论：61/61 PASS，0 FAIL，1 条动态入口无法静态枚举（见「未覆盖」）**（退出码 0：
没有任何 HTTP 入口在无凭证时返回 2xx，没有任何 WebSocket 升级返回 101，浏览器导航
302 到登录页）。

## 为什么需要这条回归

`assertGuarded()`（`src/gate/self-check.ts`）只检查守卫**标记**在不在被包装的 handler
上。标记能证明 `wrapServer()` 跑过，但证明不了请求真的被拒，也看不见"包装根本没盖到"
的入口。本脚本对每条入口发一条真实的未认证请求来补上这个缺口：dsh 升级后如果新增或
改形了路由表条目（新 `kind`、新插件、改名路径），会立刻失败，而不是继续通过标记检查。

只读保证：仅发未认证 GET 探测与 WebSocket 握手；不尝试登录、不带 cookie、不带
`Authorization`，不向宿主写任何东西。

## 本次运行

```text
时间    : 2026-09-12T16:56:01.673Z → 2026-09-12T16:56:02.879Z
目标    : http://127.0.0.1:3080（未认证；仅 GET / WS 握手）
宿主    : 0.1.5-rc.2（@deepseek-ai/dsh-base；依赖树 /home/ubuntu/.dsh/profiles/web-prod-015/node_modules）
门版本  : dsh-auth-gate@0.12.0
扫描    : 20 个含 webServer 的模块

```

| 项目           | 值                                                                |
| -------------- | ----------------------------------------------------------------- |
| 命令           | `node scripts/check-live-entries.mjs`（下表由 `--markdown` 生成） |
| 目标           | `http://127.0.0.1:3080`（未认证）                                 |
| 开始           | 2026-09-12T16:56:01.673Z                                          |
| 结束           | 2026-09-12T16:56:02.879Z                                          |
| 宿主版本       | 0.1.5-rc.2（profile 依赖树里的 `@deepseek-ai/dsh-base`）          |
| 门版本         | dsh-auth-gate@0.12.0                                              |
| 依赖树         | `/home/ubuntu/.dsh/profiles/web-prod-015/node_modules`            |
| 扫描模块       | 20 个源码中出现 `webServer` 的模块                                |
| 人工挑选的候选 | 0 条：下表每一行要么是静态发现，要么是注明来源的补充项            |

## 入口是怎么发现的

脚本不硬编码任何路径清单。对宿主依赖树里每个提到 `webServer` 的 `.js`/`.mjs`/`.cjs`
模块，它：

1. 屏蔽注释（保持偏移量），找出 `.register(`、`.registerUpgrade(`、`.registerFallback(`
   调用，且 receiver 链以 `webServer` 结尾（含 `X = <ctx>.webServer` 别名）；
2. 解析路由对象字面量里的 `path`：字符串字面量、无插值的模板字面量、文件内 `const`
   声明，以及沿相对模块边（`./shared.js`、`./stream-protocol.js`）递归解析的具名导入；
3. 覆盖宿主实际使用的间接形态：`register(route)` 配 `const route = { kind, path, handler }`，
   以及 `register(captureLegacy('/dsh-market/update', { kind, path, handler }))` 这类包装；
4. 以 `(kind, path)` 去重，并记录所有贡献过的调用点。

仍然解析不出的 path 会被打印为 **dynamic**，并且**不探测**（列进「未覆盖」，而不是默认
算通过）。

### 各来源包发现的入口数

| 来源包                                           | 条数 | 类型                   |
| ------------------------------------------------ | ---- | ---------------------- |
| @deepseek-ai/dsh-api-gateway@0.1.5-rc.2          | 1    | upgrade                |
| @deepseek-ai/dsh-client-connection@0.1.5-rc.2    | 1    | prefix                 |
| @deepseek-ai/dsh-client-hmr@0.1.5-rc.2           | 1    | exact                  |
| @deepseek-ai/dsh-client-modules@0.1.5-rc.2       | 1    | prefix                 |
| @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2 | 1    | fallback               |
| @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2     | 3    | exact, prefix          |
| dsh-better-sidebar@0.19.1                        | 8    | exact, prefix, upgrade |
| dshmarket@1.45.1                                 | 40   | exact                  |

## 表 1 - 未认证探测（61 行）

通过判据：`exact`/`prefix`/`fallback` 不得 2xx（预期 401；302 到登录页会被记录，
同样算通过）；`upgrade` 不得 101。探测拿不到任何应答 = FAIL（fail-closed）。

| 入口类型       | 路径                                         | 来源包                                                             | 未认证响应                 | 判定                                                              |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------- |
| upgrade        | /api/remote.mux                              | @deepseek-ai/dsh-api-gateway@0.1.5-rc.2                            | 401 Unauthorized           | PASS                                                              |
| prefix         | /api                                         | @deepseek-ai/dsh-client-connection@0.1.5-rc.2                      | 401                        | PASS                                                              |
| exact          | /plugins/events                              | @deepseek-ai/dsh-client-hmr@0.1.5-rc.2                             | 401                        | PASS                                                              |
| prefix         | /plugins                                     | @deepseek-ai/dsh-client-modules@0.1.5-rc.2                         | 401                        | PASS                                                              |
| fallback       | (fallback 席位：任意未注册路径)              | @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2                   | 401                        | PASS                                                              |
| exact          | /open-in-app/apps                            | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                       | 401                        | PASS                                                              |
| prefix         | /open-in-app/icon                            | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                       | 401                        | PASS                                                              |
| exact          | /open-in-app/open                            | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                       | 401                        | PASS                                                              |
| prefix         | /sidebar/bundle                              | dsh-better-sidebar@0.19.1                                          | 401                        | PASS                                                              |
| prefix         | /sidebar/api                                 | dsh-better-sidebar@0.19.1                                          | 401                        | PASS                                                              |
| exact          | /sidebar/upload                              | dsh-better-sidebar@0.19.1                                          | 401                        | PASS                                                              |
| prefix         | /sidebar/file                                | dsh-better-sidebar@0.19.1                                          | 401                        | PASS                                                              |
| prefix         | /sidebar/html                                | dsh-better-sidebar@0.19.1                                          | 401                        | PASS                                                              |
| upgrade        | /sidebar/ws/terminal                         | dsh-better-sidebar@0.19.1                                          | 401 Unauthorized           | PASS                                                              |
| upgrade        | /sidebar/ws/agent-terminals                  | dsh-better-sidebar@0.19.1                                          | 401 Unauthorized           | PASS                                                              |
| upgrade        | /sidebar/ws/agent-opens                      | dsh-better-sidebar@0.19.1                                          | 401 Unauthorized           | PASS                                                              |
| exact          | /dsh-market/api/v1/capabilities              | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/api/v1/updates                   | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/api/v1/operations                | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/api/v1/rollback                  | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/api/v1/restart                   | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/backup                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/restore                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/webdav                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/gist                             | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/registry                         | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/discovery-compatibility          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/installed                        | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/check                            | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/bundle-order                     | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/presets                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/snapshots                        | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/restore-snapshot                 | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/delete-snapshot                  | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/use-skin                         | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/toggle                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/note                             | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/favorite                         | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/groups                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/status                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/logs                             | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/updates                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/changelog                        | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/migrate-source                   | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/update                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/setup-pnpm                       | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/channel                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/region                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/github-proxy                     | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/self-uninstall                   | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/restart                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/approve-builds                   | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/cancel                           | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/uninstall                        | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/rollback                         | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| exact          | /dsh-market/install                          | dshmarket@1.45.1                                                   | 401                        | PASS                                                              |
| fallback       | /**entry-probe-6b10a2fd3109** (随机兜底探针) | @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2                   | 401                        | PASS (fallback 席位：任意未注册路径都不得 2xx)                    |
| fallback-probe | /                                            | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401                        | PASS (SPA 根路径，线上验收基线（curl / → 401）；走 fallback 席位) |
| fallback-probe | /index.html                                  | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401                        | PASS (fallback 静态服务直接命中的入口文件)                        |
| fallback-probe | /favicon.ico                                 | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401                        | PASS (浏览器默认请求的真实路径，易被静态服务绕过)                 |
| fallback-probe | / (Accept: text/html)                        | 浏览器导航分支（同 fallback 席位）                                 | 302 → /auth/login?next=%2F | PASS (浏览器导航应 302 → /auth/login?next=%2F)                    |

## 表 2 - 门自己的公开端点（4 行）

`/auth` 面是**设计上公开**的（门把 `/auth` 与 `/auth/*` 放进白名单，否则没人能登录）。
脚本仍然探测它：白名单坏掉会把所有人锁在门外，白名单漏了则是另一类事故——四条都必须
有应答，且都不许是 401。

| 入口类型 | 路径         | 来源包                                                                                             | 未认证响应 | 判定                                                                              |
| -------- | ------------ | -------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| public   | /auth        | dsh-auth-gate lib/features/password/password-endpoints.js:14 / token/auth-endpoints.js:15 [补充表] | 404        | PASS (预期 404（/auth/* 兜底，不落 SPA）；prefix 兜底：未注册的 /auth/* 一律 404) |
| public   | /auth/login  | dsh-auth-gate lib/features/password/password-endpoints.js:15（token 模式同名） [补充表]            | 200        | PASS (预期 200（登录页）；必须可达，否则无法登录)                                 |
| public   | /auth/logout | dsh-auth-gate lib/features/password/password-endpoints.js:17（token 模式同名） [补充表]            | 405        | PASS (预期 405（仅 POST）；GET 未认证不得 2xx)                                    |
| public   | /auth/status | dsh-auth-gate lib/features/password/password-endpoints.js:22（token 模式同名） [补充表]            | 200        | PASS (预期 200（未认证态 JSON）；只返回认证态，不含凭证)                          |

## 补充表

有 5 条探测不是静态发现的产物，每条都注明来源：

| 路径                                                   | 来源                                                                                                            | 为什么必须补充                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/`                                                    | fallback 席位持有者 `@deepseek-ai/dsh-host-frontend-static`                                                     | SPA 根路径由 fallback 席位响应，本身没有 `register` 调用；它也是文档里线上验收的基线（`curl /` -> 401）        |
| `/index.html`                                          | 同一 fallback 持有者                                                                                            | fallback 静态服务直接命中，没有具名路由                                                                        |
| `/favicon.ico`                                         | 同一 fallback 持有者                                                                                            | 浏览器最先请求的路径；静态服务是绕过守卫最经典的位置                                                           |
| `/auth`、`/auth/login`、`/auth/logout`、`/auth/status` | `dsh-auth-gate` 的 `lib/features/password/password-endpoints.js`（`lib/features/token/auth-endpoints.js` 同名） | 门通过包装 `register: (route) => server.register(route)` 注册它们，receiver 不叫 `webServer`，静态发现刻意不认 |

## 未覆盖

1. **运行时注册的入口。** `HostConnectionService.register(owner, channel, handler)`
   （`@deepseek-ai/dsh-client-connection`，`path: channel`）会按 channel 在运行时挂一条
   新的 prefix 路由；channel 是参数，正是扫描报出的那条动态入口。当前宿主树里没有调用方
   （线上 `/api` 前缀是直接注册的，已覆盖），但第三方插件在运行时调这个公开 API 注册的
   路径，静态扫描看不见——启动后才注册路由的插件同理。
2. **只在浏览器里发起的 WebSocket。** 握手探测证明的是门拒绝了**升级请求**；一旦握手被拒，
   就没有已建立的 socket 可供验证"连接内逐消息鉴权"（当前也没有可达的这种场景）。
3. **是谁拒的。** 门与宿主 connection 层都会回 401 `unauthorized`，所以本表证明的是
   "无凭证被拒"，而不是"确由 dsh-auth-gate 拒的"。所有 401 行都与守卫行为一致，且没有
   任何一行是 2xx。
4. **GET 以外的方法。** HTTP 入口只探 GET，升级只探握手，与线上既有验收一致；只在 POST
   下返回 2xx 的路由不会被这里抓到。
5. **依赖树以外的插件**（不在 profile `node_modules` 下的 path/link 安装）不在扫描范围内。

## 复现

```bash
# 只做静态发现（完全不发请求）
node scripts/check-live-entries.mjs --discover-only

# 对线上宿主跑完整未认证回归
node scripts/check-live-entries.mjs

# 同上，输出本文档使用的 Markdown 表格
node scripts/check-live-entries.mjs --markdown

# 换宿主 / 换 profile 依赖树
node scripts/check-live-entries.mjs --base http://127.0.0.1:3080 \
  --host-root /home/ubuntu/.dsh/profiles/web-prod-015/node_modules
```

退出码是 fail-closed 的：HTTP 入口出现 2xx、升级出现 101，或任何探测拿不到应答，都会
非 0 退出。FAIL 路径已用一个一次性的"全部放行"服务器自测过（一切 200 / 101）：61 行全部
翻成 FAIL 且进程退出 1，而线上宿主始终保持 401。

宿主版本、profile bundle 列表或任何注册路由的插件发生变化后（尤其是每次 dsh 升级后），
重新跑一遍本文件。
