# 入口覆盖回归 - dsh 0.2.0-rc.2 上的 dsh-auth-gate

对宿主 `webServer` 路由表可能暴露的每个 HTTP/WS 入口做**未认证**实打探测；本次运行在
隔离的 dsh `0.2.0-rc.2` 实例上，装的是本修复分支的工作区构建（版本串仍是 `0.15.0`，
但它已包含**未发布**的 P2 改动，因此**不是** npm 上发布的那个 `0.15.0`）。

**结论：67/67 PASS，0 FAIL，1 条动态入口未能枚举（见「未覆盖」）**
（退出码 0——没有任何**受守卫**入口在无凭证时返回 2xx，没有 WebSocket 握手返回 101，
浏览器导航探针返回的正是 `302 -> /auth/login`）。

门自己的公开端点在输出里单列一组：`/auth/login` 与 `/auth/status` 按设计允许未认证 200，
`/manifest.webmanifest` 在公开静态白名单里（D13）——这三条都在该组里被探测，且必须保持可达。
它们不计入上面的 67 条受守卫行。

配套记录：`0.1.5-rc.2` 上的同一条回归见
`docs/deployed/entry-coverage-0.1.5-rc.2_zh.md`；本次运行背后的走廊决策是 ADR D26
（`docs/decisions/implemented/2026-09-29-dsh-020-host-corridor.zh.md`）。

## 为什么需要这条回归

`assertGuarded()`（`src/gate/self-check.ts`）只检查守卫**标记**在不在被包装的 handler 上。
标记只能证明 `wrapServer()` 跑过——不能证明请求真的被拒，也看不见包装器从未触达的入口。
本脚本用**每个入口一条真实未认证请求**补上这一层：dsh 升级若新增或改变了路由表入口
（新的 `kind`、新插件、改名路径），会响亮失败，而不是靠标记检查蒙混过关。

只读保证：仅未认证 GET 探测与 WebSocket 握手；不登录、不带 cookie/Authorization、不写宿主任何文件。

## 本次运行

脚本原始输出如下。`--host-root` 指向隔离 profile 的依赖树，这也是本次运行与生产那次不同的地方：
在 `0.2.0-rc.2` 上，静态发现还看到了第三方插件的路由表（`dsh-better-sidebar` 8 条、
`dshmarket` 44 条、`@tecfancy/dsh-dock-terminal` 1 条 upgrade），**它们全部在门后面**。

```text
== dsh-auth-gate 入口覆盖回归（未认证实打，只读） ==
时间    : 2026-09-29T14:53:33.711Z → 2026-09-29T14:53:35.769Z
目标    : http://127.0.0.1:3086（未认证；仅 GET / WS 握手）
宿主    : 0.2.0-rc.2（@deepseek-ai/dsh-base；依赖树 /data/disk/dsh-isolated/home/dsh-020rc2/profiles/web-020-full/node_modules）
门版本  : dsh-auth-gate@0.15.0
扫描    : 29 个含 webServer 的模块

发现入口: 62 条（exact/prefix/upgrade/fallback），来自 10 个包
  - @deepseek-ai/dsh-api-gateway@0.2.0-rc.2: 1 条 [upgrade]
  - @deepseek-ai/dsh-client-connection@0.2.0-rc.2: 1 条 [prefix]
  - @deepseek-ai/dsh-client-hmr@0.2.0-rc.2: 1 条 [exact]
  - @deepseek-ai/dsh-client-modules@0.2.0-rc.2: 1 条 [prefix]
  - @deepseek-ai/dsh-deepseek-account-platform@0.2.0-rc.2: 1 条 [exact]
  - @deepseek-ai/dsh-host-frontend-static@0.2.0-rc.2: 1 条 [fallback]
  - @deepseek-ai/dsh-host-open-in-app@0.2.0-rc.2: 3 条 [exact, prefix]
  - @tecfancy/dsh-dock-terminal@0.5.3: 1 条 [upgrade]
  - dsh-better-sidebar@0.24.1: 8 条 [exact, prefix, upgrade]
  - dshmarket@1.66.5: 44 条 [exact]

-- 未认证探测 --
| 入口类型 | 路径 | 来源包 | 未认证响应 | 判定 |
| --- | --- | --- | --- | --- |
| upgrade | /api/remote.mux | @deepseek-ai/dsh-api-gateway@0.2.0-rc.2 | 401 Unauthorized | PASS |
| prefix | /api | @deepseek-ai/dsh-client-connection@0.2.0-rc.2 | 401 | PASS |
| exact | /plugins/events | @deepseek-ai/dsh-client-hmr@0.2.0-rc.2 | 401 | PASS |
| prefix | /plugins | @deepseek-ai/dsh-client-modules@0.2.0-rc.2 | 401 | PASS |
| exact | /oauth/callback | @deepseek-ai/dsh-deepseek-account-platform@0.2.0-rc.2 | 401 | PASS |
| fallback | (fallback 席位：任意未注册路径) | @deepseek-ai/dsh-host-frontend-static@0.2.0-rc.2 | 401 | PASS |
| exact | /open-in-app/apps | @deepseek-ai/dsh-host-open-in-app@0.2.0-rc.2 | 401 | PASS |
| prefix | /open-in-app/icon | @deepseek-ai/dsh-host-open-in-app@0.2.0-rc.2 | 401 | PASS |
| exact | /open-in-app/open | @deepseek-ai/dsh-host-open-in-app@0.2.0-rc.2 | 401 | PASS |
| upgrade | /dock-terminal/ws | @tecfancy/dsh-dock-terminal@0.5.3 | 401 Unauthorized | PASS |
| prefix | /sidebar/bundle | dsh-better-sidebar@0.24.1 | 401 | PASS |
| prefix | /sidebar/api | dsh-better-sidebar@0.24.1 | 401 | PASS |
| exact | /sidebar/upload | dsh-better-sidebar@0.24.1 | 401 | PASS |
| exact | /sidebar/archive | dsh-better-sidebar@0.24.1 | 401 | PASS |
| prefix | /sidebar/file | dsh-better-sidebar@0.24.1 | 401 | PASS |
| prefix | /sidebar/html | dsh-better-sidebar@0.24.1 | 401 | PASS |
| upgrade | /sidebar/ws/agent-opens | dsh-better-sidebar@0.24.1 | 401 Unauthorized | PASS |
| upgrade | /sidebar/ws/fs-watch | dsh-better-sidebar@0.24.1 | 401 Unauthorized | PASS |
| exact | /dsh-market/api/v1/capabilities | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/api/v1/updates/summary | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/api/v1/updates | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/api/v1/operations | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/api/v1/rollback | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/api/v1/restart | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/backup | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/restore | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/webdav | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/gist | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/registry | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/discovery-compatibility | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/find-compatible | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/installed | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/check | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/bundle-order | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/presets | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/snapshots | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/restore-snapshot | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/delete-snapshot | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/use-skin | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/toggle | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/note | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/favorite | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/block | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/groups | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/status | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/logs | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/updates | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/changelog | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/migrate-source | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/update | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/setup-pnpm | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/channel | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/region | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/github-proxy | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/build-env | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/self-uninstall | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/restart | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/approve-builds | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/cancel | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/uninstall | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/rollback | dshmarket@1.66.5 | 401 | PASS |
| exact | /dsh-market/install | dshmarket@1.66.5 | 401 | PASS |
| fallback | /__entry-probe-710bcc9c0ca4__ (随机兜底探针) | @deepseek-ai/dsh-host-frontend-static@0.2.0-rc.2 | 401 | PASS (fallback 席位：任意未注册路径都不得 2xx) |
| fallback-probe | / | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (SPA 根路径，线上验收基线（curl / → 401）；走 fallback 席位) |
| fallback-probe | /index.html | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (fallback 静态服务直接命中的入口文件) |
| fallback-probe | /favicon.ico | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (浏览器默认请求的真实路径，易被静态服务绕过) |
| navigation | / (Accept: text/html + Sec-Fetch-Mode: navigate) | 浏览器导航分支（同 fallback 席位） | 302 → /auth/login?next=%2F | PASS (浏览器导航应 302 → /auth/login?next=%2F；实际 302 → /auth/login?next=%2F) |

-- 门自己的公开端点（/auth 白名单，设计上不拦） --
| 入口类型 | 路径 | 来源包 | 未认证响应 | 判定 |
| --- | --- | --- | --- | --- |
| public | /auth | dsh-auth-gate lib/features/password/password-endpoints.js:14 / token/auth-endpoints.js:15 [补充表] | 404 | PASS (预期 404（/auth/* 兜底，不落 SPA）；prefix 兜底：未注册的 /auth/* 一律 404) |
| public | /auth/login | dsh-auth-gate lib/features/password/password-endpoints.js:15（token 模式同名） [补充表] | 200 | PASS (预期 200（登录页）；必须可达，否则无法登录) |
| public | /auth/logout | dsh-auth-gate lib/features/password/password-endpoints.js:17（token 模式同名） [补充表] | 405 | PASS (预期 405（仅 POST）；GET 未认证不得 2xx) |
| public | /auth/status | dsh-auth-gate lib/features/password/password-endpoints.js:22（token 模式同名） [补充表] | 200 | PASS (预期 200（未认证态 JSON）；只返回认证态，不含凭证) |
| public | /manifest.webmanifest | dsh-auth-gate PUBLIC_STATIC_PATHS（精确白名单，见 D13） [补充表] | 200 | PASS (预期 200（Web App Manifest）；浏览器抓 manifest 不带凭证（Chromium manifest_fetcher 默认 omit），必须无凭证可达) |

-- 未能静态解析的动态入口 1 条（未探测，见文档「未覆盖」） --
  - prefix channel ← @deepseek-ai/dsh-client-connection (@deepseek-ai/dsh-client-connection/lib/index.js:656)

结论: 67/67 PASS，0 FAIL，1 条动态入口未覆盖
```

## 入口是怎么发现的

扫描宿主依赖树里所有提到 `webServer` 的模块（本次 29 个），解析
`register({ kind, path })` / `registerUpgrade({ path })` / `registerFallback(handler)`
调用点，含 `const route = {...}` 间接形态与 `captureLegacy(path, {...})` 包装。随后每个入口发
一条未认证探测：`exact`/`prefix` 走 HTTP GET，`upgrade` 走手写 WebSocket 握手。

非导航请求拿到 **401** 即为通过：本插件的导航判定只认
`Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document`（fail-closed——缺这两个头一律按
API 流量处理），所以探测用的裸 GET 本就应当被拒，而不是被 302 到登录页。`navigation` 这一行
因此会带上这两个头，并按**确切结果** `302 -> /auth/login` 判定；门被摘掉、SPA 直接 200 时这行会
失败，而不是靠"非 2xx 即通过"混过去。

本分支同时让探针会发这两个头（`probeHttp(..., extraHeaders)` + `navigation` 判定）：改动之前
这一行只发 `Accept: text/html`、拿到 401，却被通用的"非 2xx"规则判成 PASS——302 分支写在文档里，
但从未被断言过。

## 未覆盖

- **1 条动态入口**：`@deepseek-ai/dsh-client-connection`（`lib/index.js:656`）注册的
  `prefix` 通道无法静态解析，只能由 `fallback` 探针间接覆盖。
- **已认证行为**：本探测只证明**未认证**一侧。登录后的流程由仓库集成测试，以及
  `docs/deployed/deployment_zh.md` §5.1 记录的隔离端到端运行覆盖。
- **未装进探测 profile 的插件**：隔离 profile 装的是生产插件集 + 本工作区构建；
  再挂别的路由表插件会多出新的行。

## 复现

```sh
# 只做静态发现（完全不发请求）
node scripts/check-live-entries.mjs --discover-only

# 对隔离的 0.2.0-rc.2 实例跑完整未认证回归
node scripts/check-live-entries.mjs \
  --base http://127.0.0.1:3086 \
  --host-root /data/disk/dsh-isolated/home/dsh-020rc2/profiles/web-020-full/node_modules \
  --host-version 0.2.0-rc.2

# 同上，输出本文档使用的 Markdown 表格
node scripts/check-live-entries.mjs --base http://127.0.0.1:3086 \
  --host-root /data/disk/dsh-isolated/home/dsh-020rc2/profiles/web-020-full/node_modules \
  --host-version 0.2.0-rc.2 --markdown
```
