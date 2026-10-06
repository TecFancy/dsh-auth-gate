# impl-launch-token-bridge — dsh launch-token auto bridge

> **Status**: an increment after M3 (**not** part of the M3 frozen spec; `impl-m3.md` P14's success-path
> contract remains "302 → next"; this document is its compatibility-layer override on dsh ≥ 0.1.2-alpha).
> By the same construction it is now also the override of `impl-m2.md`'s success-path contract for the
> shared-token mode (since issue #99).
> **Applies to**: dsh ≥ 0.1.2-alpha (`dsh-client-connection`'s `authenticatedUrl` exists);
> earlier versions have zero behavioral change (the bridge auto-falls back).
> **Source**: live test on 2026-08-31 (isolated instance dsh-test.example.com) + `19c8431` +
> `grok-4.6 review` (`docs/reviews/grok46-launch-token-bridge-review.md`, F1–F6 all landed) +
> `issue #99` (the token-mode miss, re-reviewed by grok-4.7 on two routes).

## 1. Background

Starting with dsh 0.1.2-alpha, dsh web adds a **page-level launch-token gate** (`dsh-client-connection`'s
`authorizeIndex`): the browser's first visit must carry the launch token (`/?token=<launchToken>`) to mint a
30-day cookie bound to the Host authority; no token and no cookie → 401. launchToken is randomized per process
start (`randomBytes(32)` base64url).

Problem: after a successful auth-gate sign-in the 302 goes to `next`, but a fresh browser has no dsh cookie → it
still hits the token gate, forcing the user to manually copy the `?token=` URL from the terminal.

Issue #99 supplied the missing half: the **shared-token mode** (M2) never wired this bridge into its sign-in
success path. A fresh browser passed auth-gate and received the `dsh_auth` cookie, yet still had no dsh
browser-session cookie, so every `/api` request answered 401; the only recovery was pasting the launch URL a
second time. The bridge shipped as an increment of the password flow and token mode was left out of scope, so
that gap stayed open.

## 2. Behavior Contract

| Scenario                                                                       | Behavior                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password sign-in success (no TOTP)                                             | Issue session cookie → 302 **relative** `/?token=<launchToken>`                                                                                                                 |
| TOTP two-step, second step success                                             | Same as above (clear challenge cookie + issue session + relative redirect)                                                                                                      |
| Shared-token sign-in success (token mode)                                      | Same as above (one bridge instance, one failure semantics)                                                                                                                      |
| Bridge not configured / connection missing / older dsh (no `authenticatedUrl`) | 302 to the original `next`, redirect target unchanged (warn once per process: `launch-token bridge inactive: ...`; one extra `referrer-policy` response header, see D-bridge-8) |
| `authenticatedUrl` throws / returns no token                                   | 302 to the original `next` (warn once per process: `launch-token bridge unavailable: ...`); the same extra `referrer-policy` header                                             |
| Sign-in failure (401/429/503)                                                  | Exactly as in M3/T4 (password) and M2 (token), the bridge is not part of any failure path                                                                                       |

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
  The assembly side must be covered by integration tests: issue #99's defect was "the endpoint is correct, the
  wiring drops the dependency", and hand-mounted unit tests stay green through it (grok-4.7 review A8).
- **D-bridge-7 (token-mode parity)**: the M2 shared-token sign-in uses the same bridge instance and the same
  failure semantics (`bridge() ?? next`) as the password sign-in; the override of `impl-m2.md`'s success-path
  contract has the same character as the override of `impl-m3.md` P14. Token mode has no restricted session
  (`must_change_password` is password-only), so its success path needs no branch that skips the bridge
  (issue #99).
- **D-bridge-8 (no referrer)**: `referrer-policy: no-referrer` is sent on three 302s: both of the guard's
  navigation denials to the login page (`denyHttp`, the plain `"deny"` path and the `{deny:{redirect}}` path)
  and both modes' success redirects. The guard's two are the ones that matter: a denied URL may itself carry
  `/?token=`, and without the header the browser sends that full token-bearing URL as the Referer of the
  follow-up login-page request. On the success redirects it is defence in depth (it suppresses the Referer of
  the "login page URL → `/?token=`" hop); it is not the header protecting the token inside the Location —
  Location, request target, access logs and browser history still show it (see D-bridge-5). Read "zero
  behavioral change" for older dsh as "unchanged redirect target", with one extra response header.
- **D-bridge-9 (rejected: keep the query in the guard's `next`)**: issue #99 suggested building `next` from
  `pathname + search` in the guard's navigation denial, so the original `?token=` would survive the login
  round-trip. **Not adopted**, in order of weight: (1) it writes the process launch token into the
  **unauthenticated** login document URL and its Referer, encoded as `token%3D`, which slips past the `token=`
  log redaction D-bridge-5 recommends; (2) when the bridge hits, D-bridge-2 discards `next` anyway, so the main
  path gains nothing; (3) a client-supplied token that lands on any path other than `/` is answered with 401 by
  `authorizeIndex` even when a valid cookie exists.
  One boundary worth stating: if the bridge is **unavailable** (`authenticatedUrl` throws or returns an empty
  token while the page gate is still active), this PR does not self-rescue — the user still sees issue #99's
  symptom and still recovers by reopening the launch URL printed at startup. Bridge failure is fail-open inside
  the contract, not a scenario this PR claims to fix.
  Note also that keeping the query would mint a cookie for a _fresh_ launch URL (pathname is `/` and the token
  is this process's), so it is not a functionally empty option; declining it trades that extra self-rescue path
  for not reflecting the token into an unauthenticated page. If query fidelity is ever wanted, it belongs in a
  separate change that strips credential-shaped parameters before composing `next`.

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
- **Multiple replicas (Kubernetes and similar)**: the bridge reads the connection of the process that handled
  this sign-in. Without a sticky session, the follow-up `GET /?token=` answered by another replica returns 401.
  Password mode has carried this assumption since its first version; token mode inherits the same constraint, so
  deployment needs a single process or sticky routing.

## 5. Tests

- `src/features/password/password-endpoints.login-bridge.test.ts` (4 cases): hit (relative URL + Set-Cookie
  still contains `dsh_auth`) / undefined fallback / throw fallback / TOTP second-step hit (incl. challenge-cookie
  cleanup assertion).
- `src/shared/login-redirect.test.ts` (6 cases): the fallback rules both success paths share — no bridge /
  `undefined` (silent) / throw / empty string plus `//evil`, absolute URL, backslash and control characters /
  a missing logger and a throwing logger still resolve to a redirect target.
- `src/features/token/auth-endpoints.login-bridge.test.ts` (7 cases): hit (relative URL + Set-Cookie +
  `referrer-policy`) / undefined fallback / throw fallback with warn / unsafe location fallback with warn / no
  bridge injected / 401 never calls the bridge / 503 never calls the bridge.
- `src/integration.password.test.ts` (1 new case): real stack + fake connection → sign-in 302 relative
  `/?token=launchTok123` + session cookie.
- `src/integration.auth.test.ts` (2 new cases): real stack + fake connection registered _after_ the plugin
  applies (locking the lazy lookup) → token sign-in 302 relative `/?token=launchTok-it` (does not contain the
  form's shared token) + session cookie + a second hop to `GET /?token=` with that cookie that is no longer
  bounced back to the login page; with a connection service that has no `authenticatedUrl`, the redirect falls
  back to `next`.

## 6. Change Log

| commit    | Content                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `19c8431` | First version: `makeLaunchTokenBridge` + `issueSession` passes host through (absolute URL)                                                                                                                                                                                                                                                                                                                        |
| `b7e48e5` | grok-4.6 review F1–F6 landed: relative redirect taking only the token, two warn latches, host dependency removed, `src/launch-token-bridge.ts` extracted (root-layer whitelist), integration test locks the assembly side, this document + reverse-proxy doc notes                                                                                                                                                |
| `#103`    | issue #99: token mode uses the same bridge (D-bridge-7); the success 302s and the guard's login redirect carry `referrer-policy: no-referrer` (D-bridge-8); the fallback rule is extracted into `resolvePostLoginLocation`, shared by both success paths; D-bridge-9 records the rejected guard-query change, while the multi-replica sticky-session constraint lives in §4 and `docs/deployed/reverse-proxy*.md` |
