# Entry coverage regression - dsh-auth-gate under dsh 0.2.2-rc.1

Live, **unauthenticated** probe of every HTTP/WS entry the host `webServer` route table can
expose, run against an isolated dsh `0.2.2-rc.1` instance carrying a tarball built from the
development HEAD of this fix branch (version string `0.18.0`; the released fix is `0.18.1`).

**Verdict: 26/26 PASS, 0 FAIL, 3 dynamic entries not enumerable (see Not covered)**
(exit code 0 - no **guarded** entry answered 2xx without credentials, no WebSocket upgrade
answered 101, and the browser-navigation probe answered exactly `302 -> /auth/login`).

Companion record: the same regression under `0.2.0-rc.2` is
`docs/deployed/entry-coverage-0.2.0-rc.2.md`. This run exists because DSH 0.2.2 changed the
route shape: `webServer.register` and `registerFallback` may now take `{ resource }` instead
of `{ handler }`, and the official `/plugins` prefix and SPA fallback use that shape (D33).

## Why this regression exists

`assertGuarded()` proves the guard marker sits on each entry, not that a request is denied,
and it cannot see a route shape the wrapper never reached. On 0.2.2 a wrapper that assumed
`handler` threw during activation, the entry stayed inactive, and the host kept serving with
no login gate (fail-open). One real unauthenticated request per entry catches that class of
failure; the resource prefix and fallback rows below are the ones the pre-fix build failed.

Read-only by construction: only unauthenticated GET probes and WebSocket handshakes; no login
attempt, no cookie, no `Authorization` header, no write to the host.

## The run

Verbatim script output (`node scripts/check-live-entries.mjs --base http://127.0.0.1:3097
--host-root <isolated profile node_modules> --host-version 0.2.2-rc.1 --markdown`):

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

## Same tarball on the 0.2.1 host

The fix must also keep the handler-only hosts working. The same tarball installed into a fresh
dsh `0.2.1-rc.5` profile answered: plain `GET /` 401, browser navigation `302 ->
/auth/login?next=%2F`, `GET /auth/login` 200, `GET /auth/status` 200 JSON, and
`POST /auth/login` with valid credentials `302` plus a `dsh_auth` session cookie. The
`/plugins` resource-prefix rows above do not exist on that host, which is expected.

## Not covered

The three dynamic entries the script cannot enumerate statically (`dsh-client-connection`'s
prefix channel and two `dshmarket` route factories) are exercised by the plugin and remain
behind the gate by construction: they register through the wrapped `register` API, and the
`dshmarket` surfaces answered 401 in earlier runs recorded in
`docs/deployed/entry-coverage-0.2.0-rc.2.md`.
