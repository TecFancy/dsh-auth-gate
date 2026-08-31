# Grok 4.6 Review — launch-token auto bridge (commit 19c8431)

- **Date**: 2026-09-01
- **Reviewer**: grok-4.6 (subscription, 500K context, xhigh effort available)
- **Scope**: `feat: bridge dsh launch token into password login session` (19c8431, development)
- **Verdict**: **request-changes**
- **Standard**: repo `AGENTS.md` + `.agents/skills/dsh-auth-code-review/SKILL.md` (enforcement / doc sync / real-entry-path testing / fail-closed discipline)
- **Reference implementation**: dsh 0.1.2-alpha `dsh-client-connection` `BrowserAuth.authenticatedUrl` / `authorizeIndex`

## Overall assessment

The fail-open behavior and TOTP reuse of this bridge are correct, but the 302 Location builds an absolute URL carrying the launchToken by concatenating an unvalidated Host with a hardcoded `http`, which amounts to a credential-carrying redirect on the login-success path; combined with the repo's existing recommended "half-shell Host rewrite" topology and zero documentation, production can easily be 302'd to `127.0.0.1` or plaintext http. It should be changed to a relative path `/?token=…` (don't use Host to build the origin); add validation and documentation before merging.

---

## Findings

| ID  | Severity | Title                                                                                                            |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| F1  | major    | 302 Location built from unvalidated Host, carrying the process launchToken                                       |
| F2  | major    | Hardcoded `http://` issues plaintext absolute redirects under TLS reverse-proxy deployments                      |
| F3  | major    | This change ships zero documentation and directly conflicts with the existing recommended reverse-proxy topology |
| F4  | minor    | Missing connection is completely silent; catch message is misleading and poisons the one-shot warning latch      |
| F5  | minor    | Tests do not cover the bridge assembly point, nor lock in "session cookie still sent on success"                 |
| F6  | nit      | `makeLaunchTokenBridge` never returns undefined; the conditional spread is dead code                             |

### F1 — major — 302 Location built from unvalidated Host, carrying the process launchToken

**Location**: `src/index.ts` `makeLaunchTokenBridge` (~L128–L133); `src/features/password/session-issue.ts` L35–L43; Host source `src/features/password/password-login.ts` L86.

**Issue**: `req.headers.host` is concatenated directly into `` `http://${host}` ``, and the return value of `authenticatedUrl` verbatim becomes the 302 `Location`. The dsh-side implementation is:

```js
authenticatedUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", this.launchToken);
  return url.href;
}
```

The host name is not rewritten. After a successful login the browser can be sent to `http://<Host>/?token=<process launchToken>`. A browser same-origin POST cannot forge Host, so this is not a one-click CSRF; but a reverse proxy / CDN / absolute-form request / malformed Host can deliver the process-level token to the wrong authority. `issueSession` also performs zero validation of the returned URL's scheme/host/pathname/query.

**Fix**: Don't build the origin from Host. Call `authenticatedUrl("http://127.0.0.1")` only to extract the token, then 302 to the relative address `/?token=<token>`. A relative Location stays locked to the browser's current origin, and also eliminates F2. If an absolute URL is still used, it must be WHATWG-normalized and then require that the host matches the request Host, pathname is `/`, and only the `token` query parameter is allowed; otherwise fall back to `next`.

### F2 — major — Hardcoded `http://` issues plaintext absolute redirects under TLS reverse-proxy deployments

**Location**: `src/index.ts` L133: ``connection.authenticatedUrl(`http://${host}`)``.

**Issue**: In production Caddy terminates HTTPS and node only listens on loopback. The login page is at `https://<publicHost>`, yet on success the Location is `http://<Host>/?token=…`. The token ends up in the :80 access log / plaintext link; if :80 is not open, the user is stuck with "logged in but can't reach /"; even if Caddy's HTTP→HTTPS preserves the query, that adds an extra hop and double logging. The `authenticatedUrl` contract requires the canonical browser origin. `cookieSecure` defaults to `true`, which contradicts the hardcoded http.

**Fix**: Change to the relative `/?token=…` together with F1. Don't read `X-Forwarded-Proto` (spoofable, same discipline as P10 not reading XFF). If an absolute URL is required, use https only when `cookieSecure === true`, and document explicitly that it covers only the one topology of "TLS termination + transparent Host passthrough".

### F3 — major — This change ships zero documentation and directly conflicts with the existing recommended reverse-proxy topology

**Location**: commit `19c8431` touches only four files under `src/`; conflicting docs `docs/deployed/reverse-proxy.md` / `reverse-proxy_zh.md` §3–§4.2.

**Issue**: The existing docs set the half-shell as the recommendation: `header_up Host 127.0.0.1:3080`. When deployed per the docs, the bridge 302s to `http://127.0.0.1:3080/?token=…`: the public browser jumps to the user's own machine or fails; even if it reaches dsh, `authorizeIndex` binds the cookie to the request Host, minting a host-only cookie for 127.0.0.1, and the public origin gets 401 again on the next request. The review pack's "must pass through Host" requirement runs counter to the published recommended configuration and was never written down. That `next` is unconditionally dropped is likewise undocumented. The code-review skill's blocking item "Docs match the code" is not satisfied.

**Fix**: Don't modify the frozen `impl-m3.md`. Add a new `docs/implemented/impl-launch-token-bridge.md`, and sync the reverse-proxy docs and README: when this bridge is enabled on 0.1.2-alpha+, Host rewriting binds the wrong mint cookie; the settings page 403 and the launch-token cookie cannot both be fixed by the same Host rewrite.

### F4 — minor — Missing connection is completely silent; catch message is misleading and poisons the one-shot warning latch

**Location**: `src/index.ts` L125–L140.

**Issue**: When `connection === undefined` / no `authenticatedUrl`, it returns `undefined` directly without logging; `warnedMissing` is only set in the catch. When wiring fails, login still 302s to `/` and then hits the token gate with 401 — zero signal on the operations side. When an invalid `baseUrl` makes `new URL` throw, the log says `connection service is unavailable` and the latch stays locked forever. The official bridge only ever `resolve(undefined)` and never rejects, so `issueSession`'s catch in fact never fires on it.

**Fix**: undefined / missing function → warn once per process; function throws → warn and include `error.message`; keep the two latches separate. The fail-open behavior can be kept.

### F5 — minor — Tests do not cover the bridge assembly point, nor lock in "session cookie still sent on success"

**Location**: `src/features/password/password-endpoints.login-bridge.test.ts`; missing from `src/integration.password.test.ts`.

**Issue**: The 5 test cases inject a fake `launchTokenBridge`, bypassing `ctx.get("connection")`. Silent mount failure is exactly the core risk of this change. The hit path does not assert that `Set-Cookie` still contains `dsh_auth`, and there are no regressions for external-link Location / malformed Host.

**Fix**: Integration test provides a fake `connection.authenticatedUrl`, asserting relative Location + session cookie. Unit test: an external-link Location must fall back to `next`.

### F6 — nit — `makeLaunchTokenBridge` never returns undefined

**Location**: `src/index.ts` L124, L225.

**Issue**: The signature is `| undefined`, but the implementation always returns the closure; `...(launchTokenBridge === undefined ? {} : { launchTokenBridge })` always takes the latter branch.

**Fix**: Drop the `| undefined` and the conditional spread, or probe once at apply time before deciding whether to inject.

---

## Point-by-point responses to the §5 concerns (the original 6 questions from the review input pack)

### 1. Security: exposure surface of the token appearing in the 302 Location

**Verdict**: The process-level random token itself is acceptable, but **the current absolute URL construction is not** (see F1/F2). The exposure surface is also not the same as the "URL printed at startup".

**Reasoning**:

- Token generation: `processLaunchToken` uses `randomBytes(32)` base64url, held in a WeakMap keyed by the process owner, stably reused within the process. `authenticatedUrl` does **not generate a new token on each call**, and it is not predictable. This part is fine.
- The startup-printed URL goes to local stdout, its audience is the operator. This bridge puts the same token on the `Location` of **every successful login**: Caddy/node access logs, reverse-proxy logs, browser history, Referer (if subsequently navigating cross-site), screenshots. The 303's `referrer-policy: no-referrer` is on dsh's `authorizeIndex`; **auth-gate's own 302 does not set this header**. The frequency goes from "once per process" to "once per login", so the exposure surface can no longer be called equivalent.
- Safer alternatives:
  1. **Relative `/?token=` (recommended, this plugin can land it independently)**: does not hand Host/scheme to the Location; mint still binds the cookie via dsh against the real request Host.
  2. **auth-gate writes the dsh cookie directly**: would require reading the `client-connection/browser-session` grant in `credentials`, replicating the `dsh-auth-` + sha256(authority) naming and the HMAC payload, coupling tightly to the dsh version — rejected.
  3. **dsh uses a fixed token / a separate mint RPC**: requires upstream, out of scope for this repo; a fixed token is worse than process-random.
- Don't merge before switching to the relative Location. On the logging side, the reverse-proxy docs should require redacting the `token=` query (Caddy `log_skip` / filters) — that is an operational mitigation, not an excuse for the code.

### 2. Correctness: `ctx.get("connection")` and the silent fallback

**Verdict**: The lazy `ctx.get` pattern is consistent with `makeTokenResolver` — **the wiring itself will most likely work**; but the missing path is blinder than credentials, disguising "the bridge wasn't mounted" as "the user still has to paste the token manually" (F4).

**Reasoning**:

- `HostConnectionService` `provide`s under the name `"connection"` (dsh-client-connection `super(ctx, "connection")`). auth-gate is a Host plugin on the same web profile, and a cordis child ctx can read ancestor services by default. credentials uses the same lazy get, verified in production — so "the profile layer definitely cannot read root" is not the first hypothesis.
- The real correctness hole is observability: zero logs when `connection === undefined` or an older version lacks `authenticatedUrl` (`src/index.ts` L130–L131). Missing credentials is fail-closed + `log.error`; here it is fail-open + silent. From the user's perspective, login 302s successfully and is immediately followed by a 401 on `/` — the same as before the change, so operations will think the 0.1.2 bridge is "broken" rather than "not connected".
- Wrapping `ctx.get` + `authenticatedUrl()` in `try/catch` is right (`new URL` can throw). The mistake is in the catch message and the single latch.
- Manual e2e cannot replace an integration test that locks in the `ctx.get("connection")` assembly edge (F5). Suggest adding a real-stack test rather than only a log.

### 3. TOTP and rate limiting: does the redirect difference become a new probing surface

**Verdict**: **No new probeable surface is introduced on the denial paths.** The Location shape on the success path changed, but it cannot be used to enumerate users or bypass rate limiting.

**Reasoning**:

- Wrong password / unknown user / disabled: still 401 `invalid credentials` (`rejectedInvalid`), never reaches `issueSession`.
- Wrong TOTP code: still 401 + challenge-page HTML (`rejectTotp`), challenge cookie preserved.
- Rate limiting: still 429 + `retry-after`, before `issueSession` (`rateLimitOk`).
- TOTP first stage success: still 302 to `/auth/login?next=…`, **does not go through the bridge** (the `needsTotp` branch of `handlePasswordSubmit` is unchanged).
- Second stage success: like plain-password success, goes through `issueSession` → bridge (`password-login.ts` L148–L155, test `bridges on TOTP challenge submit`). If an attacker can already elicit this 302, TOTP has already passed; whether the Location is absolute or relative adds no extra information.
- On success the `Location` changes from the relative `next` to an absolute token-carrying one; it only distinguishes "whether this dsh exposes authenticatedUrl", and only after authentication already succeeded. The rate-limit counter runs after `recordSuccess`, and a bridge throw already clears the bucket — this is the original P10 semantics, not a new hole.
- Don't introduce any Location difference on failure responses. There is none today. Keep it that way.

### 4. Multiple Hosts: LAN IP + domain dual entry points

**Verdict**: **There is no cross-authority cookie confusion (cookie name is bound to the authority)**; the risks are "two entry points, two 30-day tickets" and "Host rewriting signs the ticket to 127.0.0.1". This is dsh's existing gate model; the bridge turns it from a manual URL into a login-triggered automation, making it easier to trip over.

**Reasoning**:

- The dsh cookie name = `dsh-auth-` + sha256(authority), and the authority is also signed inside the payload (`requestAuthority` = `new URL("http://" + host).host`). A ticket minted on `example.com` fails verification for a request with `Host: 10.0.0.5`. There is no "domain ticket reused on a LAN IP" confusion.
- Single-gate model (plan §1): passing either entry point = full-instance authority. Two entry points just mean two equivalent full-authority tickets, not privilege escalation.
- If Caddy rewrites both entry points to `127.0.0.1:3080`, both entry points mint **the same** loopback ticket; the browser cannot store it on the public origin (host-only). This is F3's production failure mode, not a LAN/domain cross-ticket.
- With the relative `/?token=`, the Host of the mint request is still the one the browser actually visited. Each entry point minting independently still holds, and is no longer rewritten a second time by the bridge's `http://${host}`. A single sentence in the docs suffices; no need for a Host allowlist in code (allowlisting is dsh `trustedHosts`' responsibility).

### 5. Test strength

**Verdict**: The 5 unit tests are sufficient for **issueSession's fail-open branch** but not for **bridge assembly and redirect safety**. Suggest adding integration tests, but don't treat "adding integration.password.test.ts" as the only blocker; regression cases for F1/F2 are more urgent.

**Reasoning**:

- Covered: hit, `undefined`, throw, no Host, TOTP second stage. This locks in the product decision that "a bridge failure must not block the 302 that issues the session".
- Not covered (skill "Real entry path"): `apply` → `makeLaunchTokenBridge` → `ctx.get("connection")`. The hand-mounted fake cuts out the entire assembly point.
- Not covered (security): external-link Location, `http://` absolute URL, relative Location assertions, Set-Cookie on success.
- Live e2e has value, but cannot go into CI and cannot catch Host rewriting / HTTPS downgrade.
- **Integration test needed**: yes, a minimal single one suffices (fake connection + POST `/auth/login` + assert Location and Set-Cookie). The existing `mountPasswordStack` already has real cordis/webserver/storage, so adding a fake connection via `ctx.provide`/`plugin` is cheap. Not "pile on 5 more unit tests".

### 6. Documentation sync

**Verdict**: **Do not write into `impl-m3.md` (frozen)**. Open a separate `docs/implemented/impl-launch-token-bridge.md`, and update the reverse-proxy docs and README. The current diff has zero documentation, so by repo standards it cannot be merged.

**Reasoning**:

- `AGENTS.md`: `impl-m3.md` is the sole authority for M3, and P14 states success → 302 `next`. This bridge rewrites that success path; it is an increment after M3, and forcing it into the frozen spec would make future maintainers mistake it for P14's original behavior.
- Naming: `impl-bridge.md` is too generic (the repo also has proxy/half-shell). Suggest `impl-launch-token-bridge.md`, opening with the statement "not part of M3; a compatibility layer for dsh ≥ 0.1.2-alpha; zero behavior change on older versions".
- Decisions that must be written into that doc: fail-open applies only to the success redirect; relative Location; why `next` is dropped (dsh only mints when `pathname === "/"`); the TOTP second stage is equally affected; incompatible with half-shell Host rewriting; access logs contain the token.
- `docs/specs/dsh-auth-plan.md` need not change (a roadmap is not a changelog). `CHANGELOG` is generated by release-please on squash into main; don't hand-edit it this time.

---

## Suggested landing order (before merge)

1. **Fix the redirect construction (F1+F2)**: `authenticatedUrl` only extracts the token → `Location: /?token=…`; invalid return values fall back to `next`.
2. **Add tests (F5)**: external-link fallback + real-stack fake connection + Set-Cookie.
3. **Write docs (F3)**: `impl-launch-token-bridge.md` + reverse-proxy guide correction + one README sentence.
4. **Add logging (F4)**, and delete the dead code along the way (F6).

Don't change the denial paths, don't change rate limiting, don't wire the bridge into token mode (this change's scope is password/TOTP; if token mode should also get direct access, open a separate change).

---

## Explicitly out of review scope, not findings

- token mode `POST /auth/login` still 302s to `next` and does not go through the bridge: this commit's description covers only password.
- `password-login.ts` line count already exceeds P24's 250: extracting `session-issue.ts` pays down debt; it is not over-limit introduced by this bridge.
- Login CSRF is still missing (P21): this bridge does not enlarge denial/cross-user isolation (the plan already decided there is no multi-user isolation).
