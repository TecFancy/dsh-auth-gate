# Reverse-proxy deployment guide

Deploying dsh-auth-gate in front of a **public** dsh web instance always goes
through a reverse proxy (TLS terminator). This guide collects what we learned
from production (2026-08-15): the Caddy setup that works, the browser-trust
fence gotcha behind the `403`s, and the recommended "semi-shell" topology.

> Companion docs: `docs/deployed/deployment.md` (Chinese, ops checklist and acceptance
> steps) and `docs/specs/dsh-auth-plan.md` §9 M5 (the planned standalone shell).

## 1. Why a reverse proxy is required

- dsh's CLI **refuses `--host 0.0.0.0`** on purpose — the web app is designed
  to sit behind a proxy on loopback (`dsh web --host 127.0.0.1 --port 3080`).
- `cookieSecure: true` (default) needs HTTPS; the proxy terminates TLS.
- Use a low-privilege OS user for the dsh process (defense in depth).

## 2. The browser-trust fence gotcha (read this first)

dsh 0.1.0-rc.6 ships a browser-trust fence on `/api` (DNS-rebinding + CSRF
defense). Some methods are **hard-pinned to loopback-only** — `settings.*`,
`credentials.*`, `llm.discoverModels` (`PRIVILEGED_METHODS` in
`dsh-client-connection`). `--trusted-host` does **not** open them. Behind any
reverse proxy the browser's `Host: your.domain` fails the check, so the
Settings page shows `403` + `transport failure for /api/settings.describe`
even when the dsh-auth-gate login worked. This is **not** a dsh-auth-gate bug:
removing the gate does not help (verified 2026-08-15).

Measured header matrix (authenticated request to `/api/settings.describe`):

| Upstream `Host` header             | `Origin`          | Result |
| ---------------------------------- | ----------------- | ------ |
| `dsh.hi-ruofei.com` (pass-through) | anything          | 403    |
| `127.0.0.1:3080` (rewritten)       | matching loopback | 200    |
| `127.0.0.1:3080` (rewritten)       | stripped          | 200    |
| `127.0.0.1:3080` (rewritten)       | mismatched        | 403    |

**Conclusion:** the layer that makes dsh believe it is on loopback must be the
same layer that authenticates. Auth alone (gate or not) never fixes the 403s.

## 3. Topology options

| Option                           | Auth                                   | Host/Origin rewrite     | Settings page          | Notes                                                            |
| -------------------------------- | -------------------------------------- | ----------------------- | ---------------------- | ---------------------------------------------------------------- |
| Plain proxy (Caddy pass-through) | dsh-auth-gate                          | no                      | 403 on privileged APIs | works except Settings                                            |
| **Semi-shell (recommended)**     | dsh-auth-gate                          | **yes** (2 Caddy lines) | **fully works**        | keep the login page, rate limit, revocation                      |
| Standalone shell (M5, roadmap)   | dsh-auth-gate as its own proxy process | built-in                | fully works            | dsh runs with zero plugins; see `docs/specs/dsh-auth-plan.md` §9 |

The fence being neutralized by the rewrite is compensated by the gate: the
session cookie is `SameSite=Lax`, so cross-site / DNS-rebinding requests never
carry it and are rejected with `401`. Defense in depth shifts from
"fence + gate" to "gate + SameSite".

## 4. Configs

### 4.1 Caddy — plain proxy (Settings page will 403 on privileged APIs)

```
dsh.hi-ruofei.com {
	reverse_proxy 127.0.0.1:3080
}
```

### 4.2 Caddy — semi-shell (recommended: Host rewrite + Origin strip)

```
dsh.hi-ruofei.com {
	reverse_proxy 127.0.0.1:3080 {
		header_up Host 127.0.0.1:3080   # dsh sees a loopback Host
		header_up -Origin                # drop Origin so the fence's match passes
	}
}
```

Reload: `sudo systemctl reload caddy`. WebSocket upgrades pass through the
same rules (verified: `101` with cookie, `401` without).

### 4.2.1 Note: launch-token gate (dsh ≥ 0.1.2-alpha) + dsh-auth-gate bridge

Since 0.1.2-alpha, dsh web keeps a page-level launch-token gate: a fresh browser
needs `/?token=<launchToken>` once to mint a 30-day, Host-bound session cookie.
dsh-auth-gate bridges this after a successful login by redirecting to a
**relative** `/?token=…` (details in `docs/implemented/impl-launch-token-bridge.md`).

- **The relative redirect works in both topologies** (plain pass-through and the
  semi-shell above): the browser stays on your origin, and the minted cookie is
  bound to whatever Host the (possibly rewritten) request carries.
- **Never use an absolute `http://127.0.0.1:3080/…` redirect here** — under the
  semi-shell rewrite it would point the user's browser at their own machine. The
  bridge deliberately drops host/scheme from `authenticatedUrl` and keeps only
  the token.
- The launch token appears in the 302 `Location`, hence in access logs; prefer
  redacting `token=` in proxy logs (Caddy `log_skip` / filters) as operational
  hygiene.

### 4.3 nginx equivalent

```nginx
server {
    listen 443 ssl;
    server_name dsh.hi-ruofei.com;
    # ... ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host 127.0.0.1:3080;   # loopback Host
        proxy_set_header Origin "";             # clear Origin (empty string removes it)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; # WebSocket
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

## 5. Verification quicklist

```sh
# unauthenticated: page navigation 302 to /auth/login, API 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: text/html" https://dsh.hi-ruofei.com/__dsh_api   # 302
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: application/json" https://dsh.hi-ruofei.com/__dsh_api  # 401
# after login (cookie jar):
#   settings.describe / credentials.describe → 200 (semi-shell)
#   WebSocket upgrade on /api/events.host → 101 with cookie, 401 without
```

Full acceptance checklist: `docs/deployed/deployment.md` §4 (A–I).

## 6. Troubleshooting

| Symptom                                         | Cause                                                     | Fix                                        |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| Settings page: `transport failure ... HTTP 403` | fence loopback pin; proxy passes public Host              | semi-shell rewrite (§4.2)                  |
| All `/api` 401 right after a login              | stale session (service restarted; sessions are in-memory) | log in again                               |
| Login `429`                                     | rate limiter locked (per proxy exit IP)                   | wait for `retry-after`, or restart dsh-web |
| Browser won't keep the session                  | `cookieSecure: true` without HTTPS                        | terminate TLS at the proxy                 |
| WS `401` without cookie                         | gate rejects upgrade                                      | expected fail-closed; log in first         |

## 7. Security notes

- Never run a bare dsh instance publicly without a gate or shell: the agent
  has workspace write access and `$DSH_HOME/.credentials.yaml` holds your LLM
  API keys (anyone can burn your quota).
- dsh-web restarts wipe in-memory sessions — all browsers must log in again.
- Rate limiting aggregates per proxy exit IP (do not trust `X-Forwarded-For`).
