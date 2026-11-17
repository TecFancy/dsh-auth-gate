# Entry coverage regression - dsh-auth-gate under dsh 0.2.0-rc.2

Live, **unauthenticated** probe of every HTTP/WS entry the host `webServer` route table
can expose, run against an isolated dsh `0.2.0-rc.2` instance carrying the workspace
build of this fix branch (version string `0.15.0`; it already contains the unreleased
P2 changes, so it is **not** the npm-published `0.15.0`).

**Verdict: 67/67 PASS, 0 FAIL, 1 dynamic entry not enumerable (see Not covered)**
(exit code 0 - no **guarded** entry answered 2xx without credentials, no WebSocket upgrade
answered 101, and the browser-navigation probe answered exactly `302 -> /auth/login`).

The gate's own public endpoints are a separate, deliberate group in the run output:
`/auth/login` and `/auth/status` answer 200 without credentials by design, and
`/manifest.webmanifest` is on the public static allowlist (D13) - all three are probed in that
group and must stay reachable. They are excluded from the 67 guarded rows above.

Companion record: the same regression under `0.1.5-rc.2` is
`docs/deployed/entry-coverage-0.1.5-rc.2.md`; the corridor decision behind this run is
ADR D26 (`docs/decisions/implemented/2026-09-29-dsh-020-host-corridor.en.md`).

## Why this regression exists

`assertGuarded()` (`src/gate/self-check.ts`) only checks that the guard **marker** sits on
the wrapped handlers. A marker proves that `wrapServer()` ran - it does not prove that a
request is actually denied, and it cannot see an entry the wrapper never reached. This
script closes that gap with one real unauthenticated request per entry, so a dsh upgrade
that adds or re-shapes a route table entry (new `kind`, new plugin, renamed path) fails
loudly instead of passing the marker check.

Read-only by construction: only unauthenticated GET probes and WebSocket handshakes; no
login attempt, no cookie, no `Authorization` header, no write to the host.

## The run

Verbatim script output. The tree in `--host-root` is the isolated profile's dependency
tree, which is what makes this run different from the production probe: on `0.2.0-rc.2`
the discovery now also sees third-party route tables (`dsh-better-sidebar` 8 entries,
`dshmarket` 44 entries, `@tecfancy/dsh-dock-terminal` 1 upgrade entry), and every one of
them is behind the gate.

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

## How entries are discovered

Static scan of every module mentioning `webServer` in the host dependency tree (29
modules here), resolving `register({ kind, path })`, `registerUpgrade({ path })` and
`registerFallback(handler)` call sites, including indirect `const route = {...}` forms and
`captureLegacy(path, {...})` wrappers. Each discovered entry then gets one unauthenticated
probe: `exact`/`prefix` via HTTP GET, `upgrade` via a hand-written WebSocket handshake.

A guard that answers **401** to a non-navigation request is a pass: the plugin's
navigation predicate is `Sec-Fetch-Mode: navigate` / `Sec-Fetch-Dest: document` only
(fail-closed - a request without those headers is treated as API traffic, not as a
browser navigation), so the probe's plain GET is expected to be denied rather than
redirected. The `navigation` row therefore sends both headers and is judged on the exact
outcome `302 -> /auth/login`; a stripped gate that serves the SPA with 200 fails that row
instead of passing it as "non-2xx".

This branch also teaches the probe to send those headers (`probeHttp(..., extraHeaders)`
plus the `navigation` kind): before the change the row sent `Accept: text/html` only, got
401, and was judged PASS by the generic "non-2xx" rule - the 302 branch was documented but
never asserted.

## Not covered

- **One dynamic entry**: the `prefix` channel registered by
  `@deepseek-ai/dsh-client-connection` (`lib/index.js:656`) is not statically resolvable;
  it is exercised indirectly by the `fallback` probes.
- **Authenticated behavior**: this probe only proves the _unauthenticated_ side. Logged-in
  flows are covered by the repository's integration tests and by the isolated end-to-end
  run recorded in `docs/deployed/deployment.md` §5.1.
- **Plugins not installed in the probe profile**: the isolated profile carries the
  production plugin set plus the workspace build; a profile with further route-table
  plugins would discover further rows.

## Reproducing

```sh
# Static discovery only (no requests at all)
node scripts/check-live-entries.mjs --discover-only

# Full unauthenticated regression against the isolated 0.2.0-rc.2 instance
node scripts/check-live-entries.mjs \
  --base http://127.0.0.1:3086 \
  --host-root /data/disk/dsh-isolated/home/dsh-020rc2/profiles/web-020-full/node_modules \
  --host-version 0.2.0-rc.2

# Same, with Markdown tables for this document
node scripts/check-live-entries.mjs --base http://127.0.0.1:3086 \
  --host-root /data/disk/dsh-isolated/home/dsh-020rc2/profiles/web-020-full/node_modules \
  --host-version 0.2.0-rc.2 --markdown
```
