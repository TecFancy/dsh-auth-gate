# Entry coverage regression - dsh-auth-gate under dsh 0.1.5-rc.2

Live, **unauthenticated** probe of every HTTP/WS entry the host `webServer` route table
can expose, run against the production host right after the dsh 0.1.5-rc.2 upgrade.

**Verdict: 61/61 PASS, 0 FAIL, 1 dynamic entry not enumerable (see Not covered)**
(exit code 0 - no HTTP entry answered 2xx without credentials, no WebSocket upgrade
answered 101, browser navigation 302s to the login page).

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

Verbatim script output (the tool prints its own labels in Chinese; the tables below use
English headers). The window is ~1.2 s and issues 65 unauthenticated requests, one per row.

```text
时间    : 2026-09-12T16:56:01.673Z → 2026-09-12T16:56:02.879Z
目标    : http://127.0.0.1:3080（未认证；仅 GET / WS 握手）
宿主    : 0.1.5-rc.2（@deepseek-ai/dsh-base；依赖树 /home/ubuntu/.dsh/profiles/web-prod-015/node_modules）
门版本  : dsh-auth-gate@0.12.0
扫描    : 20 个含 webServer 的模块

```

| Field                      | Value                                                                          |
| -------------------------- | ------------------------------------------------------------------------------ |
| Command                    | `node scripts/check-live-entries.mjs` (`--markdown` produced the tables below) |
| Target                     | `http://127.0.0.1:3080` (unauthenticated)                                      |
| Started                    | 2026-09-12T16:56:01.673Z                                                       |
| Finished                   | 2026-09-12T16:56:02.879Z                                                       |
| Host release               | 0.1.5-rc.2 (`@deepseek-ai/dsh-base` in the profile dependency tree)            |
| Gate version               | dsh-auth-gate@0.12.0                                                           |
| Dependency tree            | `/home/ubuntu/.dsh/profiles/web-prod-015/node_modules`                         |
| Modules scanned            | 20 modules whose source mentions `webServer`                                   |
| Candidates checked by hand | 0 - every row below is either discovered or an annotated supplement            |

## How entries are discovered

The script never hardcodes a path list. For every `.js`/`.mjs`/`.cjs` module in the host
dependency tree that mentions `webServer`, it:

1. masks comments (offset-preserving) and finds calls to
   `.register(`, `.registerUpgrade(`, `.registerFallback(` whose receiver chain ends in
   `webServer` (or aliases `X = <ctx>.webServer`);
2. reads the route object literal, resolving `path` through string literals, template
   literals without substitutions, file-local `const` declarations, and named imports
   followed transitively across relative module edges (`./shared.js`, `./stream-protocol.js`);
3. follows the indirect shapes the host actually uses: `register(route)` with
   `const route = { kind, path, handler }`, and wrappers such as
   `register(captureLegacy('/dsh-market/update', { kind, path, handler }))`;
4. keeps one row per `(kind, path)` and records every call site that contributed.

A path that still cannot be resolved is printed as **dynamic** and is _not_ probed (it is
listed under "Not covered" rather than being silently counted as passing).

### Discovered entries per source package

| Source package                                   | Entries | Kinds                  |
| ------------------------------------------------ | ------- | ---------------------- |
| @deepseek-ai/dsh-api-gateway@0.1.5-rc.2          | 1       | upgrade                |
| @deepseek-ai/dsh-client-connection@0.1.5-rc.2    | 1       | prefix                 |
| @deepseek-ai/dsh-client-hmr@0.1.5-rc.2           | 1       | exact                  |
| @deepseek-ai/dsh-client-modules@0.1.5-rc.2       | 1       | prefix                 |
| @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2 | 1       | fallback               |
| @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2     | 3       | exact, prefix          |
| dsh-better-sidebar@0.19.1                        | 8       | exact, prefix, upgrade |
| dshmarket@1.45.1                                 | 40      | exact                  |

## Table 1 - unauthenticated probes (61 rows)

Pass rule: `exact`/`prefix`/`fallback` must not answer 2xx (401 expected; 302 to the login
page is recorded but still passes); `upgrade` must not answer 101. A probe that gets no
answer at all is a FAIL (fail-closed).

| Entry kind     | Path                                                  | Source package                                                         | Unauthenticated response   | Verdict                                                                                |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| upgrade        | /api/remote.mux                                       | @deepseek-ai/dsh-api-gateway@0.1.5-rc.2                                | 401 Unauthorized           | PASS                                                                                   |
| prefix         | /api                                                  | @deepseek-ai/dsh-client-connection@0.1.5-rc.2                          | 401                        | PASS                                                                                   |
| exact          | /plugins/events                                       | @deepseek-ai/dsh-client-hmr@0.1.5-rc.2                                 | 401                        | PASS                                                                                   |
| prefix         | /plugins                                              | @deepseek-ai/dsh-client-modules@0.1.5-rc.2                             | 401                        | PASS                                                                                   |
| fallback       | (fallback seat: any unregistered path)                | @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2                       | 401                        | PASS                                                                                   |
| exact          | /open-in-app/apps                                     | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                           | 401                        | PASS                                                                                   |
| prefix         | /open-in-app/icon                                     | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                           | 401                        | PASS                                                                                   |
| exact          | /open-in-app/open                                     | @deepseek-ai/dsh-host-open-in-app@0.1.5-rc.2                           | 401                        | PASS                                                                                   |
| prefix         | /sidebar/bundle                                       | dsh-better-sidebar@0.19.1                                              | 401                        | PASS                                                                                   |
| prefix         | /sidebar/api                                          | dsh-better-sidebar@0.19.1                                              | 401                        | PASS                                                                                   |
| exact          | /sidebar/upload                                       | dsh-better-sidebar@0.19.1                                              | 401                        | PASS                                                                                   |
| prefix         | /sidebar/file                                         | dsh-better-sidebar@0.19.1                                              | 401                        | PASS                                                                                   |
| prefix         | /sidebar/html                                         | dsh-better-sidebar@0.19.1                                              | 401                        | PASS                                                                                   |
| upgrade        | /sidebar/ws/terminal                                  | dsh-better-sidebar@0.19.1                                              | 401 Unauthorized           | PASS                                                                                   |
| upgrade        | /sidebar/ws/agent-terminals                           | dsh-better-sidebar@0.19.1                                              | 401 Unauthorized           | PASS                                                                                   |
| upgrade        | /sidebar/ws/agent-opens                               | dsh-better-sidebar@0.19.1                                              | 401 Unauthorized           | PASS                                                                                   |
| exact          | /dsh-market/api/v1/capabilities                       | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/api/v1/updates                            | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/api/v1/operations                         | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/api/v1/rollback                           | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/api/v1/restart                            | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/backup                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/restore                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/webdav                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/gist                                      | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/registry                                  | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/discovery-compatibility                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/installed                                 | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/check                                     | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/bundle-order                              | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/presets                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/snapshots                                 | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/restore-snapshot                          | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/delete-snapshot                           | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/use-skin                                  | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/toggle                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/note                                      | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/favorite                                  | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/groups                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/status                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/logs                                      | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/updates                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/changelog                                 | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/migrate-source                            | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/update                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/setup-pnpm                                | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/channel                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/region                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/github-proxy                              | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/self-uninstall                            | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/restart                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/approve-builds                            | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/cancel                                    | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/uninstall                                 | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/rollback                                  | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| exact          | /dsh-market/install                                   | dshmarket@1.45.1                                                       | 401                        | PASS                                                                                   |
| fallback       | /**entry-probe-6b10a2fd3109** (random fallback probe) | @deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2                       | 401                        | PASS (fallback seat: no unregistered path may return 2xx)                              |
| fallback-probe | /                                                     | fallback seat owner @deepseek-ai/dsh-host-frontend-static [supplement] | 401                        | PASS (SPA root; live acceptance baseline (curl / -> 401); served by the fallback seat) |
| fallback-probe | /index.html                                           | fallback seat owner @deepseek-ai/dsh-host-frontend-static [supplement] | 401                        | PASS (entry file served directly by the fallback static server)                        |
| fallback-probe | /favicon.ico                                          | fallback seat owner @deepseek-ai/dsh-host-frontend-static [supplement] | 401                        | PASS (path browsers request by default; a classic way static serving bypasses a guard) |
| fallback-probe | / (Accept: text/html)                                 | browser navigation branch (same fallback seat)                         | 302 → /auth/login?next=%2F | PASS (browser navigation must 302 to /auth/login?next=%2F)                             |

## Table 2 - the gate's own public endpoints (5 rows)

The `/auth` surface is **public by design** (the gate whitelists `/auth` and `/auth/*` so
people can log in). The script still probes it, because a broken whitelist would lock
everyone out and a leaked one would matter: all five must answer, none may 401. The last row,
`/manifest.webmanifest`, is not part of `/auth` but must likewise stay reachable without
credentials (browser manifest fetches omit credentials; see D13), so it belongs in this table.

| Entry kind | Path                  | Source package                                                                                               | Unauthenticated response | Verdict                                                                                                                                                  |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public     | /auth                 | dsh-auth-gate lib/features/password/password-endpoints.js:14 / token/auth-endpoints.js:15 [supplement]       | 404                      | PASS (expected 404 (the /auth/* catch-all keeps unknown paths off the SPA); prefix catch-all)                                                            |
| public     | /auth/login           | dsh-auth-gate lib/features/password/password-endpoints.js:15 (same path in token mode) [supplement]          | 200                      | PASS (expected 200 (login page); must stay reachable or nobody can log in)                                                                               |
| public     | /auth/logout          | dsh-auth-gate lib/features/password/password-endpoints.js:17 (same path in token mode) [supplement]          | 405                      | PASS (expected 405 (POST only); an unauthenticated GET must not be 2xx)                                                                                  |
| public     | /auth/status          | dsh-auth-gate lib/features/password/password-endpoints.js:22 (same path in token mode) [supplement]          | 200                      | PASS (expected 200 (unauthenticated state JSON); state only, never credentials)                                                                          |
| public     | /manifest.webmanifest | dsh-host-frontend-static@0.1.5-rc.2 (fallback seat) + dsh-auth-gate whitelist (D13, 2026-09-18) [supplement] | 200                      | PASS (expected 200 (browser manifest fetches omit credentials by spec, so it must stay reachable unauthenticated); exact whitelist, neighbours stay 401) |

## Supplements

Six probes are not products of static discovery. Each is annotated with its source:

| Path                                                   | Source                                                                                                               | Why it is a supplement                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                    | fallback seat owner `@deepseek-ai/dsh-host-frontend-static`                                                          | the SPA root is served by the fallback seat, so it has no `register` call of its own; this is also the documented live acceptance check (`curl /` -> 401)                                                                                                   |
| `/index.html`                                          | same fallback owner                                                                                                  | the fallback static server answers it without a named route                                                                                                                                                                                                 |
| `/favicon.ico`                                         | same fallback owner                                                                                                  | the path browsers request first; a static server is the easiest place to bypass a guard                                                                                                                                                                     |
| `/auth`, `/auth/login`, `/auth/logout`, `/auth/status` | `dsh-auth-gate` `lib/features/password/password-endpoints.js` (same paths in `lib/features/token/auth-endpoints.js`) | the gate registers them through the wrapper `register: (route) => server.register(route)`, so the receiver is not named `webServer` and static discovery deliberately ignores it                                                                            |
| `/manifest.webmanifest`                                | same fallback owner; the gate's public whitelist is D13 (2026-09-18)                                                 | browsers fetch manifests without credentials by spec (Chromium only attaches cookies for `crossorigin="use-credentials"`), so a purely guarded static path stays **401 even when logged in** — unlike `/favicon.ico`, a normal request that carries cookies |

## Not covered

1. **Runtime-registered entries.** `HostConnectionService.register(owner, channel, handler)`
   (`@deepseek-ai/dsh-client-connection`, `path: channel`) mounts a _new_ prefix route per
   channel at runtime; the channel is a parameter, so the path is the one dynamic entry the
   scan reports. No in-tree caller exists today (the shipped `/api` prefix is registered
   directly and is covered), but a third-party plugin calling that public API at runtime is
   invisible to a static scan, and so is any plugin that registers routes after startup.
2. **WebSocket upgrades that only exist in the browser.** The handshake probe proves the
   gate denies the _upgrade request_; it cannot exercise per-message authorization inside an
   already-accepted socket (there is none to reach while all handshakes are denied).
3. **Who rejected the request.** Both the gate and the host connection layer answer 401
   `unauthorized`, so the table proves "denied without credentials", not "denied by
   dsh-auth-gate specifically". Every 401 row is consistent with the guard, and no row was
   2xx.
4. **Methods other than GET.** Only GET is probed for HTTP entries and the handshake for
   upgrades, matching the documented live check. A route that returned 2xx only for POST
   would not be caught here.
5. **Plugins activated from outside this dependency tree** (a path or link install not
   present under the profile's `node_modules`) are not in the scan surface.

## Reproducing

```bash
# Static discovery only (no requests at all)
node scripts/check-live-entries.mjs --discover-only

# Full unauthenticated regression against the live host
node scripts/check-live-entries.mjs

# Same, with Markdown tables for this document
node scripts/check-live-entries.mjs --markdown

# Another host / another profile tree
node scripts/check-live-entries.mjs --base http://127.0.0.1:3080 \
  --host-root /home/ubuntu/.dsh/profiles/web-prod-015/node_modules
```

Exit code is fail-closed: any 2xx on an HTTP entry, any 101 on an upgrade, or any probe
that gets no answer exits non-zero. The FAIL path was self-tested against a throwaway
permissive server (everything 200 / 101): all 61 rows flipped to FAIL and the process
exited 1, while the live host continued to answer 401.

Re-run this file whenever the host release, the profile bundle list, or any
route-registering plugin changes - in particular after every dsh upgrade.
