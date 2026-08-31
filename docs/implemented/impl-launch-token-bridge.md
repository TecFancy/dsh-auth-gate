# impl-launch-token-bridge — dsh launch-token auto bridge

> **Status**: an increment after M3 (**not** part of the M3 frozen spec; `impl-m3.md` P14's success-path
> contract remains "302 → next"; this document is its compatibility-layer override on dsh ≥ 0.1.2-alpha).
> **Applies to**: dsh ≥ 0.1.2-alpha (`dsh-client-connection`'s `authenticatedUrl` exists);
> earlier versions have zero behavioral change (the bridge auto-falls back).
> **Source**: live test on 2026-08-31 (isolated instance dsh-test.hi-ruofei.com) + `19c8431` +
> `grok-4.6 review` (`docs/reviews/grok46-launch-token-bridge-review.md`, F1–F6 all landed).

## 1. Background

Starting with dsh 0.1.2-alpha, dsh web adds a **page-level launch-token gate** (`dsh-client-connection`'s
`authorizeIndex`): the browser's first visit must carry the launch token (`/?token=<launchToken>`) to mint a
30-day cookie bound to the Host authority; no token and no cookie → 401. launchToken is randomized per process
start (`randomBytes(32)` base64url).

Problem: after a successful auth-gate sign-in the 302 goes to `next`, but a fresh browser has no dsh cookie → it
still hits the token gate, forcing the user to manually copy the `?token=` URL from the terminal.

## 2. Behavior Contract

| Scenario                                                                       | Behavior                                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Password sign-in success (no TOTP)                                             | Issue session cookie → 302 **relative** `/?token=<launchToken>`                                                 |
| TOTP two-step, second step success                                             | Same as above (clear challenge cookie + issue session + relative redirect)                                      |
| Bridge not configured / connection missing / older dsh (no `authenticatedUrl`) | 302 to the original `next`, zero behavioral change (warn once per process: `launch-token bridge inactive: ...`) |
| `authenticatedUrl` throws / returns no token                                   | 302 to the original `next` (warn once per process: `launch-token bridge unavailable: ...`)                      |
| Sign-in failure (401/429/503)                                                  | Exactly as in M3/T4, the bridge is not part of any failure path                                                 |

**fail-open scope**: the bridge only affects the "redirect target after a successful sign-in"; denial paths,
rate limiting, TOTP challenges and session issuance are all untouched. Bridge failure (returning undefined /
throwing) never affects sign-in success.

## 3. Frozen Design Decisions

- **D-bridge-1 (relative redirect)**: Location is always relative to `/?token=...`. From the return value of
  `connection.authenticatedUrl("http://127.0.0.1")` **only the token is extracted**; host/scheme/other query
  params are all discarded (`new URL(...).searchParams.get("token")`). Rationale: a) under a TLS reverse proxy
  (Caddy terminating TLS) a hardcoded `http://` causes protocol downgrade + the token leaking into plaintext
  logs (grok F2); b) an unvalidated request Host spliced into Location would send the process-level token to the
  wrong authority (grok F1); c) relative addresses are completed by the browser against the current origin, so
  the minted cookie is always bound to the origin the user actually visited.
- **D-bridge-2 (drop `next`)**: when the bridge hits, `next` is dropped — dsh's mint only runs at
  `pathname === "/"`, so the next target page cannot coexist with the mint; after sign-in the user first lands
  on `/` (gets the token), then a 303 back to `/`. Deep links (`next=/some/page`) no longer go straight through
  once the bridge is enabled — a known trade-off.
- **D-bridge-3 (silent-degradation discipline)**: two warn latches, alarmed separately, each warn-once per
  process — ① service missing/no function (`inactive`, hinting dsh < 0.1.2-alpha) ② call/resolution exception
  (`unavailable` with the error message). Avoids "missing service" and "Host switch triggers exception"
  polluting each other's alarms (grok F4). Old behavior: the previous implementation logged `error` with a
  single latch.
- **D-bridge-4 (Host-independent)**: the bridge neither reads nor depends on the request Host. Whether the
  reverse proxy rewrites the Host (semi-shell) or not does not affect the redirect target; the minted cookie's
  authority is determined by the actual mint request's Host (see §4).
- **D-bridge-5 (exposure surface)**: the 302 Location carries the process-level launchToken (entering access
  logs / browser history). Same token and same exposure level as the URL dsh prints at startup (valid only for
  the process lifetime; the 30-day cookie is managed by the dsh side). It is recommended that the reverse proxy
  redact the `token=` query in logs (caddy `log_skip` / filters) as an operational mitigation.
- **D-bridge-6 (tests)**: unit tests hand-mount an injected bridge to lock the fail-open branches; integration
  tests use a real cordis stack + a fake service via `ctx.provide("connection", ...)` to lock the assembly side
  (`ctx.get` → bridge → 302), asserting the relative Location and the Set-Cookie are still issued (grok F5).

## 4. Deployment Notes (relation to reverse-proxy topology)

- **Normal reverse proxy (Host passthrough)**: mint request Host = public domain → cookie bound to the domain
  authority; subsequent requests pass validation with the same Host. ✅
- **Semi-shell (rewrites Host to 127.0.0.1:3080)**: after the relative redirect the mint request Host =
  loopback → the cookie name is computed for the loopback authority; the semi-shell simultaneously rewrites the
  Host of all subsequent requests to loopback, so validation matches and it works. ✅ (**Prerequisite**: the
  redirect must be a relative path — the old implementation's absolute redirect `http://${host}` sends the
  browser to `http://127.0.0.1:3080` under a semi-shell, which fails on the user's machine. See the notes in
  `docs/deployed/reverse-proxy*.md`.)
- Multiple entry points (LAN IP + domain): cookie names bind to their own authorities and are not reused across
  them (dsh single-gate model: passing any entry point = full-instance access; two equivalent full-access
  tickets, not a privilege escalation).

## 5. Tests

- `src/features/password/password-endpoints.login-bridge.test.ts` (4 cases): hit (relative URL + Set-Cookie
  still contains `dsh_auth`) / undefined fallback / throw fallback / TOTP second-step hit (incl. challenge-cookie
  cleanup assertion).
- `src/integration.password.test.ts` (1 new case): real stack + fake connection → sign-in 302 relative
  `/?token=launchTok123` + session cookie.

## 6. Change Log

| commit    | Content                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `19c8431` | First version: `makeLaunchTokenBridge` + `issueSession` passes host through (absolute URL)                                                                                                                                                                         |
| `b7e48e5` | grok-4.6 review F1–F6 landed: relative redirect taking only the token, two warn latches, host dependency removed, `src/launch-token-bridge.ts` extracted (root-layer whitelist), integration test locks the assembly side, this document + reverse-proxy doc notes |
