# dsh-auth-gate Deployment and Acceptance Checklist

This document describes how to deploy dsh-auth-gate (password mode, M3) to a public dsh web
instance and complete **deployment acceptance**. Applies to: an instance already running dsh
web (`dsh --profile web`) that needs an authentication gate.

Design basis: `docs/specs/dsh-auth-plan.md` §7/§8 (absence of an upstream PR channel, defense in
depth); specifications: `docs/implemented/impl-m2.md` (token mode), `docs/implemented/impl-m3.md` (password mode).
**Choose one of the two modes**: the text below is written for password mode (recommended, M3);
token mode only needs to skip the "create users" step and configure `tokenRef`.

---

## 0. Prerequisites

- **TLS front termination** (Nginx/Caddy reverse proxy or LB): `cookieSecure: true` depends on
  https, otherwise the browser does not save the session cookie (curl/scripts are unaffected).
  An http-only environment can only use `cookieSecure: false` (testing only).
- **`--trusted-host` and authentication are orthogonal**: `--trusted-host` is merely a
  DNS-rebinding guard, not authentication; both need to be configured. Public instance:
  `--trusted-host <domain>` points to your domain.
- Run dsh under a **low-privilege OS user** (no sudo, no other project files) — plan §8,
  defense-in-depth item 1.
- The **server has Node ≥ 22.19** (consistent with deployment) and pnpm (`dsh plugin` forwards
  to pnpm). Verified: npm's default global prefix is `/usr` (cannot install without root
  privileges); use
  `npm i -g pnpm --prefix ~/.npm-global` and `export PATH="$HOME/.npm-global/bin:$PATH"`
  (`dsh` itself is also installed in this prefix, see `docs/handoff/handoff-m2.md` §3.2).

---

## 1. Install dsh-auth-gate (one-time)

The package is published to npm (`dsh-auth-gate`); one command installs it into the target
profile:

```bash
# Server ($DSH_HOME points at the target instance, e.g. ~/.dsh or an isolated directory):
export PATH="$HOME/.npm-global/bin:$PATH"
dsh plugin --profile web add dsh-auth-gate   # forwards to pnpm, resolved from public npm (verified)
```

- After installation, the `dependencies` of `$DSH_HOME/profiles/web/package.json` include
  `dsh-auth-gate`; dependencies (`yaml`, `@deepseek-ai/*`) are resolved automatically from public
  npm.
- The CLI binary is **not** added to `PATH` — `dsh plugin add` only runs pnpm in the profile
  directory, so `dsh-auth` resolves exclusively from
  `$DSH_HOME/profiles/web/node_modules/.bin`. §2 shows the correct invocation.
- Upgrade: re-run the same command (pnpm pulls the new version).
- Uninstall: `dsh plugin --profile web remove dsh-auth-gate` (since 0.4.1 the bundle
  declaration makes `dsh plugin add` register the mount in `dsh.profile.bundles`, so
  `remove` also drops it; a leftover `- id: dsh-auth-gate` config override in
  `$DSH_HOME/cordis.patch.yml` becomes a no-op with a boot warning and can be deleted).

## 2. Configuration

1. **Create the administrator** (`users.yaml` is auto-created at
   `$DSH_HOME/auth/users.yaml`, 0600):
   ```bash
   # The CLI is not on PATH (see §1): call it through the profile.
   printf '%s\n' '<strong password>' | \
     pnpm --dir "$DSH_HOME/profiles/web" exec dsh-auth user add admin --password-stdin
   pnpm --dir "$DSH_HOME/profiles/web" exec dsh-auth user list   # confirm
   ```
   Alternative (no pnpm needed at runtime):
   `node "$DSH_HOME/profiles/web/node_modules/dsh-auth-gate/lib/cli.js" ...`.
   Multiple administrators: repeat `user add`; disable: `dsh-auth user disable <name>`.
2. **Config override**: copy the repo's `deploy/cordis.patch.yml` to
   `$DSH_HOME/cordis.patch.yml` — since 0.4.1 the template is a pure config
   override (no `insert`; the mount itself is registered by `dsh plugin add` via
   the `dsh.bundle` manifest). Adjust as needed (`cookieSecure` must match the
   TLS environment; only set `usersFile` for a non-default path).
3. Confirm no other line occupies the `dsh-auth-gate` id (the patch stack overrides by id).

## 3. Startup and Health Check

```bash
cd "$DSH_HOME" && DSH_HOME="$DSH_HOME" setsid dsh --profile web --port 3081 \
  > ~/dsh.log 2>&1 < /dev/null &                         # wait ~25s
tail -f ~/dsh.log                                        # expected: no errors
```

(Verified: in an SSH session, `nohup ... &` may hang ssh for 2 minutes because a child process
holds the fd — **a hang does not mean failure**; `setsid` returns immediately; after startup,
open another connection to check `pgrep` and the port. To stop:
`pkill -f "[d]sh --profile web"` — the bracket trick prevents self-kill; kill and startup are in
two separate connections.)

Startup self-check (M1): if the four categories of entry points are not fully covered, it
**fails loud** (process startup fails and reports
`guard self-check failed`) — successful startup means the guard is in place. The log should show
`session domain opened: dsh_auth_sessions`; no `user store unavailable` /
`users file not found` (that warn is normal before first login — a missing file = empty user set,
fail-closed).

## 4. Acceptance Checklist (run each item after deployment)

Run on the server itself (or via SSH tunnel). `jar` is a curl cookie jar; `<TOKEN>` is the
`dsh_auth` value from the `set-cookie` in the login response (43 characters).

```bash
# A. Login page and the guard
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/auth/login          # 200
curl -s http://127.0.0.1:3081/auth/login | grep -o 'name="username"'                # hit

# B. Unauthenticated rejection (navigation 302 / API 401)
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: text/html" http://127.0.0.1:3081/__dsh_api  # 302
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: application/json" http://127.0.0.1:3081/__dsh_api  # 401

# C. Login (wrong → 401; correct → 302 + set-cookie)
curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" http://127.0.0.1:3081/auth/login  # 401
curl -s -i -d "username=admin&password=<password>" -c jar http://127.0.0.1:3081/auth/login | head -3  # 302 + set-cookie

# D. Session cookie and Bearer session token
curl -s -o /dev/null -w "%{http_code}\n" -b jar http://127.0.0.1:3081/__dsh_api      # 200
curl -s -b jar http://127.0.0.1:3081/auth/status                                     # {"authenticated":true}
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <TOKEN>" http://127.0.0.1:3081/__dsh_api  # 200

# E. Route discipline (/auth falls through without hitting the SPA fallback; method discipline)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/auth/whatever         # 404
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://127.0.0.1:3081/auth/login  # 405

# F. WS upgrade channel (first-line status is enough; timing out via --max-time is normal)
curl --http1.1 -s -i --max-time 2 -b jar -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H "Sec-WebSocket-Version: 13" \
  http://127.0.0.1:3081/api/events.host | head -1                                    # 101
# no-cookie variant → first line 401

# G. Logout and revocation
curl -s -i -X POST "http://127.0.0.1:3081/auth/logout?next=/" -b jar | head -3        # 302 + Max-Age=0
curl -s -o /dev/null -w "%{http_code}\n" -b jar http://127.0.0.1:3081/__dsh_api      # 401

# H. Rate limiting (run last — locks for 30s onward)
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" \
  http://127.0.0.1:3081/auth/login; done       # first ~N times 401, after lock 429 (IP bucket accumulates prior failures)
curl -s -i -d "username=admin&password=<password>" http://127.0.0.1:3081/auth/login | head -3  # 429 + retry-after

# I. Browser path (optional, requires an https environment): incognito window → visit → 302 to /auth/login →
#    login → enter the instance; a prominent "Sign out / 退出登录" button sits inside the Settings panel
#    (Settings → General, bottom; client half, 0.6.5+), or visit /auth/logout?next=/ via URL to log out.
```

All green = deployment acceptance passes. **Every failure path must fail** (401/403 semantics,
never swallow errors) — any "silent pass-through" (unauthenticated returning 200/101) is a
deployment error. Verified note: `cookieSecure: true` only affects browsers (curl's cookie jar
does not check `Secure`, so the acceptance sequence runs the same); the lock count in group H
accumulates prior failures from earlier steps (e.g. the `wrong` attempt in C) — look for the
`429 + retry-after` to appear.

## 5. Upgrade and Regression (mandatory after every dsh upgrade)

The guard wrapper depends on `webServer`'s non-contractual internal structures (plan §7)
— **after each dsh upgrade**:

1. Start up (§3) — a fail-loud self-check means failure;
2. Run acceptance groups B/D/F of the checklist (guard + session + WS);
3. Check `boot.log` for any new error/warn;
4. **For dsh upgrades to 0.1.2-alpha and later**: dsh web adds a page-level
   launch-token gate (a fresh browser needs `/?token=` once). dsh-auth-gate
   bridges it after a successful login via a relative `/?token=…` redirect (see
   `docs/implemented/impl-launch-token-bridge.md`). After the upgrade, run
   acceptance item A with a **fresh browser** (no dsh cookie): signing in should
   land directly on the instance — no 401 token-gate wall. In `boot.log`,
   `launch-token bridge inactive` is expected only when dsh has no
   `authenticatedUrl` (older dsh); `launch-token bridge unavailable` warrants
   connection-service troubleshooting.

### 5.1 Upgrading dsh-auth-gate (0.11.0 → 0.11.1, TOTP hardening)

Real-world bumps (verified on `web-test`, 2026-08-30):

1. **Fresh releases are blocked by pnpm's `minimumReleaseAge`** — a plain
   `pnpm up dsh-auth-gate` may silently do nothing. Pin the version explicitly and use the
   pnpm major that matches the profile's `node_modules` (the profile declares
   `packageManager: pnpm@11.22.0`; the system pnpm 9.x fails on store mismatch):
   ```sh
   corepack pnpm@11.22.0 --dir "$DSH_HOME/profiles/<profile>" up dsh-auth-gate@0.11.1
   # verify: grep '"version"' "$DSH_HOME/profiles/<profile>/node_modules/dsh-auth-gate/package.json"
   ```
2. **Restarting invalidates in-flight TOTP challenges** (HMAC-signed challenge cookie,
   process-keyed, ADR D10): users on the code page must re-enter their password
   (window ≤ 5 minutes). The legacy plaintext cookie format also stops working after
   upgrade — treated as "no challenge", users simply see the password page.
3. After upgrade, run at least: `dsh-auth user list` sanity, then the TOTP acceptance
   round — password stage → challenge cookie (3-part signed value) → code page → correct
   code → session; wrong code → 401 with the challenge-page error slot; `/auth/status`
   with the session cookie → `authenticated: true`.

## 6. Troubleshooting

| Symptom                                   | Cause                                                                | Handling                                                         |
| ----------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Startup failure `guard self-check failed` | Wrapper does not cover all entry points (dsh version changed)        | Upgrade dsh-auth-gate or report (do not bypass the self-check)   |
| Login always 401                          | Wrong password / user disabled / users.yaml missing (empty user set) | `dsh-auth user list`; confirm `$DSH_HOME` matches the instance   |
| Login 503 `user store unavailable`        | users.yaml syntax/schema error, permissions too loose (not 600)      | `chmod 600`; `dsh-auth user list` to reproduce the error message |
| Login 429                                 | Rate-limit lock (in-memory state, cleared on restart)                | Wait for `retry-after` or restart the instance                   |
| Rejected after browser login              | `cookieSecure: true` but no https                                    | Add TLS front termination, or temporarily false (testing only)   |
| API still 401 after authentication        | Reverse proxy does not forward cookie/Authorization                  | Check the reverse proxy's header pass-through config             |

## 7. Security Notes (plan §8 concrete checklist)

- [ ] Both `$DSH_HOME/.credentials.yaml` and `auth/users.yaml` are `chmod 600` (dsh-auth CLI
      auto-sets 600).
- [ ] Treat session logs as confidential material (protect backups/sharing equally).
- [ ] Fold upgrade regression (§5) into the ops process; add auth-line health checks
      (`boot.log` + acceptance B/D/F) to monitoring.
- [ ] Password hashes are scrypt (`docs/implemented/impl-m3.md` P1); the file has zero plaintext.
- [ ] A disabled user only blocks new logins (issued sessions remain valid within TTL, a known
      M3 limitation).
- [ ] Rate limiting is in-memory and cleared on restart; in a reverse-proxy deployment, rate
      limiting aggregates by egress IP (do not trust X-Forwarded-For).

## 8. Public Deployment Variant (effective 2026-08-15 on dsh.hi-ruofei.com): Semi-Shell

> §1–§7 of this document are the "plugin form" (the guard lives inside the dsh process). After
> production validation on 2026-08-15, the public instance switches to the **semi-shell** variant;
> the long-term direction is `docs/specs/dsh-auth-plan.md` §9 M5 (independent reverse-proxy shell).

### 8.1 Why a Shell Is Needed: The Browser-Trust Fence and Authentication Are Orthogonal

`dsh-client-connection` in dsh 0.1.0-rc.6 **pins** privileged methods such as
`settings.*`/`credentials.*`/`llm.discoverModels` to loopback only (PRIVILEGED_METHODS,
`--trusted-host` cannot loosen this). Under a public reverse proxy, the settings page's
`settings.describe`/`credentials.describe` always return 403 ("transport failure"),
**unrelated to dsh-auth-gate** — removing the guard and running bare still returns 403
(verified 2026-08-15).

Verified header matrix (cookie access to `/api/settings.describe` after login):

| Upstream Host                                  | Origin           | Result |
| ---------------------------------------------- | ---------------- | ------ |
| `dsh.hi-ruofei.com` (passed through unchanged) | any              | 403    |
| `127.0.0.1:3080` (rewritten)                   | matches loopback | 200    |
| `127.0.0.1:3080` (rewritten)                   | stripped         | 200    |
| `127.0.0.1:3080` (rewritten)                   | does not match   | 403    |

### 8.2 Semi-Shell Topology (current production)

```
public dsh.hi-ruofei.com (Caddy, TLS)
  └─ reverse_proxy 127.0.0.1:3080 {
         header_up Host 127.0.0.1:3080   # rewrite Host → dsh treats it as loopback
         header_up -Origin                # strip Origin → passes the fence's Origin match
     }
       └─ dsh web (with the dsh-auth-gate guard; authentication logic unchanged)
```

- Effect: all 13 settings-page APIs return 200 with zero console errors; login/rate
  limiting/revocation/Bearer all preserved; WS returns 101 normally.
- Cost: dsh's browser-trust fence is bypassed (Host always loopback, Origin always absent);
  compensated by the guard — the session cookie's `SameSite=Lax` → cross-site/rebinding requests
  get no cookie → 401. Defense in depth changes from "fence + guard" to "guard + SameSite".
- Rollback: `/etc/caddy/Caddyfile.bak.shell` (pre-shell) and
  `$DSH_HOME/cordis.patch.yml.bak` (guard-disabled state) are archived; after restoring, restart
  dsh-web and reload caddy to return to the plugin form.

### 8.3 Ops Notes (semi-shell specific)

- Run the upgrade regression (§5) as usual; additionally smoke-test the settings page: after
  login, click "Settings" and confirm there is no `transport failure` and no 403 console errors.
- `--trusted-host dsh.hi-ruofei.com` is already redundant after the rewrite (Host always
  loopback), but keeping it is harmless.
- Sessions are still in-memory: after a dsh-web restart every browser must log in again (all old
  cookies return 401, which is normal fail-closed behavior).
- Bare-running lesson: **do not** run bare in public without the shell and without the guard —
  agents have workspace write access and `$DSH_HOME/.credentials.yaml` contains model API keys,
  so anyone could freely invoke them.

## 9. Authenticated Local Proxy (optional extension, as of 2026-08-26)

> The semi-shell (§8) fixed the server-side `/api` fence; dsh's **client** still has a
> "page origin must be loopback" check (`isLoopback` in `dsh-client-connection` only accepts
> `localhost` / `[::1]` / `127/8`): on a domain page the settings mirror runs in memory mode and
> the settings page reports "settings are unavailable in this browser" (client-side, unrelated
> to authentication). This extension provides a loopback page entry on the **user's machine**,
> composing with the semi-shell and the guard to deliver "remote config editing with real
> authentication throughout", without touching dsh sources.

### 9.1 Topology and Authentication

```
User browser (http://127.0.0.1:8443  -- page origin loopback; client-side gate passes)
   └─ dsh-auth-proxy (user machine, strictly bound to 127.0.0.1, stateless pass-through)
        └─ https://dsh.hi-ruofei.com (SNI/Host = domain)
             └─ Caddy (§8.2 header rewrite: Host/Origin -> 127.0.0.1:3080)
                  └─ dsh web + dsh-auth-gate (authentication unchanged)
```

- Authentication reuses auth-gate: the login page and its 302/Set-Cookie pass through untouched
  (the cookie is owned by `127.0.0.1:8443`); `--strip-secure-cookie` (default on) removes the
  `Secure` attribute over plain-text loopback HTTP (one hop only; Chrome/Firefox would keep it
  anyway; Safari fallback). `HttpOnly`/`SameSite=Lax`/`Path=/` are preserved.
- The proxy stores no sessions or credentials (stateless; restart simply invalidates it).
- WebSocket upgrades (`/api/events.mux`, `/api/events.host`) are tunneled through the proxy too.

### 9.2 Usage

```sh
node lib/proxy-cli.js --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com --mark-proxy
# Open http://127.0.0.1:8443 in the browser -> auth-gate login -> edit the settings pages
```

| Flag                      | Default                     | Purpose                                                                                                             |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `--listen`                | `127.0.0.1:8443`            | Must be loopback (startup refuses anything else; no LAN trampoline)                                                 |
| `--target`                | `https://dsh.hi-ruofei.com` | Upstream; requires https with TLS verification by default                                                           |
| `--strip-secure-cookie`   | on (`--no-…` disables)      | Remove `Secure` over plain-text loopback HTTP                                                                       |
| `--mark-proxy`            | off                         | Add `X-Dsh-Proxy: 1` to every request (enables the §9.3 deny-list)                                                  |
| `--local-token-env <VAR>` | none                        | Every request must carry `Authorization: Bearer <env value>` (fail-closed: startup errors if the variable is unset) |
| `--unsafe-plain-target`   | off                         | Allow `http://` upstreams (local verification only)                                                                 |

### 9.3 Security Boundary: the `X-Dsh-Proxy` Deny-List (Phase 2.1)

Through the proxy the `/api` fence also treats `host.pickDirectory`, `host.openPath`,
`settings.openDocument` and `llm.discoverModels` as loopback, so a remote _authenticated_ user
could trigger **host-native capabilities** (dialogs, opening host paths, SSRF-style probes).
Defense: run the proxy with `--mark-proxy`; the auth-gate guard answers `403 forbidden` (same
shape as the `/api` fence) for marked requests hitting those methods, after the gate allowed them.

- **Unmarked traffic behaves exactly as if the proxy were not deployed**; the operator opts in.
- HTTP routes only; the WebSocket event channels are not on the deny list and are unaffected.
- The marker header is spoofable, but spoofing only denies the spoofing caller (the refusal is
  self-inflicted); no amplification surface.

### 9.4 systemd Unit

Template: `deploy/systemd/dsh-auth-proxy.service.example`

```sh
sudo cp deploy/systemd/dsh-auth-proxy.service.example /etc/systemd/system/dsh-auth-proxy.service
# Edit ExecStart (binary path and --target) for the actual deployment
sudo systemctl daemon-reload && sudo systemctl enable --now dsh-auth-proxy
```

### 9.5 Acceptance Checklist (run each item after deployment)

1. The proxy prints `listening on http://127.0.0.1:8443 -> …`; a non-loopback `--listen` exits
   with an error;
2. `curl GET /` (with `Accept: text/html`) -> `302 /auth/login`;
3. `POST /auth/login` -> `302 + set-cookie` (**without `Secure`**);
4. With the cookie, `POST /api/settings.describe` (RPC envelope
   `{"type":"client-request","rpcId":"x","method":"…","payload":{}}`,
   `Content-Type: application/json`) -> `200 {"ok":true,…}`;
5. Browser: after login, "Settings -> Models" shows no "settings are unavailable" and the
   provider rows are editable;
6. With `--mark-proxy`: a marked `settings.describe` still returns 200; `host.openPath` returns 403;
7. Regression: the models page opened directly on `https://dsh.hi-ruofei.com` still shows the
   original error (expected — no proxy).
