# 入口覆盖回归 - dsh-auth-gate 在 dsh 0.2.2-rc.1 下

对宿主 `webServer` 路由表能暴露的每个 HTTP/WS 入口做**未认证**实打，跑在隔离的 dsh
`0.2.2-rc.1` 实例上，插件是从本修复分支 development HEAD 打出的 tarball（版本串还是
`0.18.0`，发布版本是 `0.18.1`）。

**结论：26/26 PASS，0 FAIL，3 条动态入口无法枚举（见「未覆盖」）**
（退出码 0：没有任何**受守卫**入口在无凭证时回 2xx，没有 WebSocket 握手回 101，浏览器导航
探针正好是 `302 -> /auth/login`）。

对照记录：同样的回归在 `0.2.0-rc.2` 下的结果见
`docs/deployed/entry-coverage-0.2.0-rc.2.md`。这次单独跑，是因为 DSH 0.2.2 改了路由形态：
`webServer.register` 与 `registerFallback` 现在可以收 `{ resource }` 而不是 `{ handler }`，
官方的 `/plugins` 前缀与 SPA 兜底都换成了这种形态（D33）。

## 为什么需要这条回归

`assertGuarded()` 只能证明每个入口上带守卫标记，证明不了请求真的被拒绝，也看不见包装器没
覆盖到的路由形态。0.2.2 上，假设只有 `handler` 的包装器在激活时抛错，入口停在未激活，宿主
照常服务但没有登录门，这是 fail-open。每个入口打一次真实的未认证请求，才能拦住这一类故障；
下面的 resource 前缀与 fallback 两行，正是修复前的构建会失败的地方。

只读：只用未认证的 GET 探测和 WebSocket 握手，不登录、不带 cookie、不带 `Authorization`，
不写宿主。

## 本次运行

脚本原样输出（`node scripts/check-live-entries.mjs --base http://127.0.0.1:3097
--host-root <隔离 profile 的 node_modules> --host-version 0.2.2-rc.1 --markdown`）：

```
-- 未认证探测 --
| 入口类型 | 路径 | 来源包 | 未认证响应 | 判定 |
| --- | --- | --- | --- | --- |
| upgrade | /api/remote.mux | @deepseek-ai/dsh-api-gateway@0.2.2-rc.1 | 401 Unauthorized | PASS |
| prefix | /api | @deepseek-ai/dsh-client-connection@0.2.2-rc.1 | 401 | PASS |
| exact | /connect | @deepseek-ai/dsh-client-connection@0.2.2-rc.1 | 401 | PASS |
| exact | /plugins/events | @deepseek-ai/dsh-client-hmr@0.2.2-rc.1 | 401 | PASS |
| prefix | /plugins | @deepseek-ai/dsh-client-modules@0.2.2-rc.1 | 401 | PASS |
| exact | /oauth/callback | @deepseek-ai/dsh-deepseek-account-platform@0.2.2-rc.1 | 401 | PASS |
| fallback | (fallback 席位：任意未注册路径) | @deepseek-ai/dsh-host-frontend-static@0.2.2-rc.1 | 401 | PASS |
| exact | /open-in-app/apps | @deepseek-ai/dsh-host-open-in-app@0.2.2-rc.1 | 401 | PASS |
| prefix | /open-in-app/icon | @deepseek-ai/dsh-host-open-in-app@0.2.2-rc.1 | 401 | PASS |
| exact | /open-in-app/open | @deepseek-ai/dsh-host-open-in-app@0.2.2-rc.1 | 401 | PASS |
| prefix | /sidebar/bundle | dsh-better-sidebar@0.28.2 | 401 | PASS |
| prefix | /sidebar/api | dsh-better-sidebar@0.28.2 | 401 | PASS |
| exact | /sidebar/upload | dsh-better-sidebar@0.28.2 | 401 | PASS |
| exact | /sidebar/write | dsh-better-sidebar@0.28.2 | 401 | PASS |
| exact | /sidebar/archive | dsh-better-sidebar@0.28.2 | 401 | PASS |
| prefix | /sidebar/file | dsh-better-sidebar@0.28.2 | 401 | PASS |
| prefix | /sidebar/html | dsh-better-sidebar@0.28.2 | 401 | PASS |
| upgrade | /sidebar/ws/agent-opens | dsh-better-sidebar@0.28.2 | 401 Unauthorized | PASS |
| upgrade | /sidebar/ws/fs-watch | dsh-better-sidebar@0.28.2 | 401 Unauthorized | PASS |
| upgrade | /sidebar/ws/sidechat | dsh-better-sidebar@0.28.2 | 401 Unauthorized | PASS |
| prefix | /video | dsh-video-preview@0.1.4 | 401 | PASS |
| fallback | /__entry-probe-b5fe0d9fd6f1__ (随机兜底探针) | @deepseek-ai/dsh-host-frontend-static@0.2.2-rc.1 | 401 | PASS (fallback 席位：任意未注册路径都不得 2xx) |
| fallback-probe | / | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (SPA 根路径，线上验收基线（curl / → 401）；走 fallback 席位) |
| fallback-probe | /index.html | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (fallback 静态服务直接命中的入口文件) |
| fallback-probe | /favicon.ico | fallback seat owner @deepseek-ai/dsh-host-frontend-static [补充表] | 401 | PASS (浏览器默认请求的真实路径，易被静态服务绕过) |
| navigation | / (Accept: text/html + Sec-Fetch-Mode: navigate) | 浏览器导航分支（同 fallback 席位） | 302 → /auth/login?next=%2F | PASS (浏览器导航应 302 → /auth/login?next=%2F；实际 302 → /auth/login?next=%2F) |

-- 门自己的公开端点（/auth 白名单，设计上不拦） --
| 入口类型 | 路径 | 来源包 | 未认证响应 | 判定 |
| --- | --- | --- | --- | --- |
| public | /auth | dsh-auth-gate lib/host/features/password/api/password-endpoints.js / lib/host/features/token/api/auth-endpoints.js [补充表] | 404 | PASS (预期 404（/auth/* 兜底，不落 SPA）；prefix 兜底：未注册的 /auth/* 一律 404) |
| public | /auth/login | dsh-auth-gate lib/host/features/password/api/password-endpoints.js（token 模式同名） [补充表] | 200 | PASS (预期 200（登录页）；必须可达，否则无法登录) |
| public | /auth/logout | dsh-auth-gate lib/host/features/password/api/password-endpoints.js（token 模式同名） [补充表] | 405 | PASS (预期 405（仅 POST）；GET 未认证不得 2xx) |
| public | /auth/status | dsh-auth-gate lib/host/features/password/api/password-endpoints.js（token 模式同名） [补充表] | 200 | PASS (预期 200（未认证态 JSON）；只返回认证态，不含凭证) |
| public | /manifest.webmanifest | dsh-auth-gate PUBLIC_STATIC_PATHS（精确白名单，见 D13） [补充表] | 200 | PASS (预期 200（Web App Manifest）；浏览器抓 manifest 不带凭证（Chromium manifest_fetcher 默认 omit），必须无凭证可达) |

-- 未能静态解析的动态入口 3 条（未探测，见文档「未覆盖」） --
  - prefix channel ← @deepseek-ai/dsh-client-connection (@deepseek-ai/dsh-client-connection/lib/index.js:871)
  - unknown route ← dshmarket (dshmarket/lib/routes.js:2331)
  - unknown {
            ...route,
            handler: (request, response) => {
           ← dshmarket (dshmarket/lib/routes.js:2333)

结论: 26/26 PASS，0 FAIL，3 条动态入口未覆盖
```

## 同一个 tarball 在 0.2.1 宿主上

修复也必须让只有 handler 的旧宿主继续可用。同一个 tarball 装进全新的 dsh `0.2.1-rc.5`
profile 后：裸 `GET /` 401，浏览器导航 `302 -> /auth/login?next=%2F`，`GET /auth/login` 200，
`GET /auth/status` 返回 200 JSON，`POST /auth/login` 用正确口令返回 302 并下发 `dsh_auth`
会话 cookie。上面那些 `/plugins` resource 前缀行在旧宿主上不存在，属于预期。

## 未覆盖

脚本无法静态枚举的三条动态入口（`dsh-client-connection` 的 prefix channel，以及 `dshmarket`
的两个路由工厂）仍由插件运行时注册，天然走被包装的 `register`；`dshmarket` 那几面在早先
`docs/deployed/entry-coverage-0.2.0-rc.2.md` 记录的运行里都是 401。
