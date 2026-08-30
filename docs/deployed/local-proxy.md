# Authenticated Local Proxy (dsh-auth-proxy) Design

> Status: reviewed and implemented (`feat/local-proxy`). Audience: maintainers and deployers.
> Constraints: **no dsh source changes**; Phase 1 leaves the auth-gate server-side logic untouched.

## 0. Background and Findings

Deployment shape: dsh (0.1.1-rc.2, `web` profile) runs on the server at `127.0.0.1:3080`,
Caddy terminates `https://dsh.hi-ruofei.com` and reverse-proxies to that port, and
dsh-auth-gate (0.8.0, password mode + HTTPS) guards every entry point.

Problem: a remote browser opened "Settings -> Models" on the domain and got
`加载提供方目录失败: settings are unavailable in this browser`.

Verified fact chain:

1. **dsh client**: `isLoopback` in `dsh-client-connection` only accepts the page hostname
   (`localhost` / `[::1]` / `127/8`). On a non-loopback page the settings mirror
   (`SettingsDescribeMirror`) runs in `"memory"` mode -> `view` is empty -> the Models page
   throws "settings are unavailable in this browser" client-side, without firing a request.
2. **dsh server**: `/api`'s `PRIVILEGED_METHODS` (`settings.*`, `credentials.*`, ...) re-check
   `isTrustedApiRequest` with an **empty trust list**, inspecting only Host/Origin headers —
   auth-agnostic.
3. **Caddy (existing config)**: `header_up Host 127.0.0.1:3080` + `header_up Origin http://127.0.0.1:3080`
   -> dsh already sees loopback + same-origin -> the 403 for the config plane never fires.

**Conclusion**: the config-plane API is already "double-pass" for domain requests carrying an
auth-gate session; the only blocker is the browser **page origin**. Therefore:

- add an "authenticated local proxy" that turns the page origin into loopback and reuses the
  existing chain as-is;
- **zero changes** on the server side (dsh / auth-gate / Caddy) — except the optional
  deny-list in Phase 2.1, which is an enhancement inside this repo (auth-gate's own guard).

## 1. Architecture

```
User browser (http://127.0.0.1:8443, page origin = loopback -> client-side gate passes)
   |  HTTP/1.1 + WebSocket upgrades (Cookie: dsh_auth=... held by the browser)
   v
dsh-auth proxy (user machine, strictly bound to 127.0.0.1, stateless pass-through)
   |  HTTPS + SNI=dsh.hi-ruofei.com, forwards Cookie/Bearer untouched
   v
Caddy (TLS termination; header_up Host/Origin -> 127.0.0.1:3080)
   v
dsh @ 127.0.0.1:3080
   |-- auth-gate guard (login check; the real auth boundary)
   `-- /api fence (sees loopback headers -> allows, incl. the config plane) -> Models page works
```

The proxy only has to do three things: pass everything through (including streaming), tunnel the
two WebSocket downlinks, and adapt login cookies (drop `Secure` over plain-text loopback HTTP).
It does **no** Host/Origin rewriting — Caddy overrides those anyway (and in local-verification
mode with `--target http://127.0.0.1:3080` the loopback headers are genuinely loopback).

## 2. Component: `dsh-auth proxy`

### 2.1 Form

Zero-dependency Node script (Node >= 22 built-ins only), delivered as a `bin/`-registered
standalone CLI (`dsh-auth-proxy`); no build/runtime dependencies to add to the project.

```sh
node bin/dsh-auth-proxy.js --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com
# or, installed:
dsh-auth-proxy --listen 127.0.0.1:8443 --target https://dsh.hi-ruofei.com
```

### 2.2 Options

| Flag                      | Default                     | Purpose                                                                                                                  |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--listen`                | `127.0.0.1:8443`            | Must be loopback; the program refuses to start on anything else                                                          |
| `--target`                | `https://dsh.hi-ruofei.com` | Upstream; requires https with TLS verification by default                                                                |
| `--strip-secure-cookie`   | on (disable via `--no-…`)   | Remove `Secure` from forwarded `Set-Cookie` over plain-text loopback (Chrome/Firefox generally keep it; Safari fallback) |
| `--mark-proxy`            | off                         | Add `X-Dsh-Proxy: 1` to every request (hook for the §3 deny-list)                                                        |
| `--local-token-env <VAR>` | none                        | Every proxied request must carry `Authorization: Bearer <env value>` (fail-closed: startup errors when unset)            |
| `--unsafe-plain-target`   | off                         | Allow `http://` upstreams (local verification only)                                                                      |

### 2.3 Behavior spec

1. Pages/static: `GET /`, `/assets/*`, `/plugins/<id>/client.js?rev=...` are streamed through.
2. API: `POST /api/*` streams both ways (unary/respond/SSE; attachments are never buffered).
3. WebSocket: `/api/events.mux` and `/api/events.host` upgrade handshakes are forwarded, then
   sockets are piped both ways (Node `http` `upgrade` event -> `https` upgrade -> pipe).
4. Auth entries: `/auth/*` passes through untouched (login page, `/auth/login` POST,
   `/auth/logout`, `/auth/status`); `Set-Cookie` is adapted per `--strip-secure-cookie`
   (HttpOnly/SameSite/Path preserved); 302s pass through. The browser owns the cookie for
   `127.0.0.1:8443`; the proxy is stateless and stores nothing.
5. Security: full upstream certificate verification by default; only the declared target is
   reachable; no disk persistence; rate limiting / session TTL remain auth-gate's.

## 3. Security Boundary: the `X-Dsh-Proxy` Deny-List (Phase 2.1)

Through the proxy the `/api` fence also treats `host.pickDirectory`, `host.openPath`,
`settings.openDocument` and `llm.discoverModels` as loopback, so a remote _authenticated_ user
could trigger host-native capabilities (dialogs, opening host paths, SSRF-style probes).
Defense: `--mark-proxy` adds `X-Dsh-Proxy: 1`; the auth-gate guard answers `403 forbidden`
(same shape as the fence) for marked requests hitting those methods, after the gate allowed
them. Unmarked traffic behaves exactly as if the proxy were not deployed. HTTP only; the
WebSocket event channels are unaffected. The marker is spoofable, but spoofing only denies the
spoofing caller (self-inflicted refusal; no amplification surface).

## 4. Verification Matrix

### Phase 0 — link verification (no code changes, on the server)

| #   | Operation                                                                                                                   | Result                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 0.1 | No-credential request with simulated Caddy headers (loopback Host/Origin)                                                   | 401 from auth-gate guard (not the fence's 403) — guard runs first     |
| 0.2 | Temp user login -> cookie; retry with correct RPC envelope                                                                  | `200 {"ok":true,...}` with the full settings document — the key proof |
| 0.3 | `POST /auth/logout` (GET is 405) revokes the session; `user disable` blocks new logins; both verified, temp user cleaned up | 302 then 401 / login 401                                              |

Control group: domain Host + valid session -> the fence's `403 forbidden` (`PRIVILEGED_METHODS`
is real and auth-agnostic).

Gotchas found during verification (matter for Phase 1):

- **curl does not send `Secure` cookies to `http://127.0.0.1`** (no localhost exemption in its
  cookie engine) — use an explicit `Cookie:` header or https; browsers are exempt (localhost is
  a trustworthy origin), and `--strip-secure-cookie` is the Safari fallback.
- The RPC envelope must be
  `{"type":"client-request","rpcId":"<string>","method":"...","payload":{}}` with
  `Content-Type: application/json`, else 415 / schema-validation errors.

### Phase 1 — proxy implementation and verification (proxy run on the server)

| #   | Operation                                                                                                                | Result                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| M1  | `--target http://127.0.0.1:3080`: GET / -> 302 login; login -> cookie; `settings.describe` with the cookie               | 200 `ok:true`; `Set-Cookie` without `Secure`                                                                     |
| M2  | `--target https://dsh.hi-ruofei.com` (production form; Caddy rewrites headers): repeat M1                                | 200 `ok:true`                                                                                                    |
| M3  | Headless Chromium through the proxy: login -> Settings -> Models                                                         | Provider rows (DeepSeek/opencode-go) with key badges and edit/delete buttons; no "settings are unavailable" text |
| M4  | Regression: the same browser opened directly on the domain                                                               | Still shows the original error (expected — no proxy), proving the proxy is necessary and sufficient              |
| M5  | `GET /api/events.mux` with the session cookie through the proxy                                                          | `101 Switching Protocols`                                                                                        |
| M6  | Cleanup: all four temp sessions revoked via `POST /auth/logout`, temp user disabled, proxies stopped, temp files removed | —                                                                                                                |

Two proxy defects found and fixed (covered by unit tests):

1. **Empty `Sec-WebSocket-Protocol` header**: the forwarder defaulted it to `""` when the
   client did not send one; dsh's WS handler returned 400. Now forwarded only when present.
2. **Unhandled EPIPE crashed the process**: half-closed sockets in the pipe kept being written
   with no `error` listener (reproduced under the browser's concurrent bundle load). All HTTP/WS
   sockets now get destroy-on-error and unified handling.

Environment notes: run the proxy under `nohup`/systemd (a plain background job gets SIGHUP when
the shell exits); see the curl Secure-cookie gotcha above.

## 5. Phase 2 Options

| #   | Item                    | Status                                                                                                                                                          |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `X-Dsh-Proxy` deny-list | Implemented (guard + `--mark-proxy`); requires publishing a new auth-gate version and upgrading the production profile (deployment decision, not executed here) |
| 2.2 | Local token gate        | Implemented (`--local-token-env`); documented here and in the deployment docs                                                                                   |
| 2.3 | Distribution            | `npm pack` includes the bin (`files: ["lib"]`); systemd unit example shipped; README/deployment sections updated                                                |
| 2.4 | Local TLS               | Optional; `https://localhost:8443` (mkcert) can replace strip-Secure                                                                                            |

## 6. Risks and Rollback

- **R1 host-native capabilities**: mitigated by 2.1 (marker + deny-list); until deployed,
  treat the proxy as "single-admin use only".
- **R2 Safari Secure-cookie refusal**: strip `Secure` by default (single loopback hop), or 2.4.
- **R3 temp verification users**: one-time random passwords, `disable` after use, nothing
  persisted in plaintext.
- **Rollback**: the proxy is a purely local component — delete it and everything is back;
  the server side is untouched.
