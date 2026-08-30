# dsh-auth feasibility plan (v3, threat model revision)

> Goal: give the publicly deployed dsh web application-layer authentication capability, landable without any upstream modification.
> Status: core mount points verified in practice via live probe (probe `authp-1` cleaned up with `cordis_undefine` per user request).

---

## 0. Confirmed decisions (2026-08-14, v3)

| #   | Decision                                                                                                  | Impact                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No multi-user/session isolation** (the protected object is the entire instance, not inter-user privacy) | Phase 3 deleted; `subject` purely for audit; plan greatly simplified                                                            |
| 2   | Sessions must persist across restarts                                                                     | Use a storage domain (`dsh-storage-json` already in the composition), see §5                                                    |
| 3   | No upstream PR channel                                                                                    | Wrapping mount points becomes long-term → self-check/regression discipline; privileged methods still pinned to loopback, see §7 |
| 4   | Probe cleanup                                                                                             | Already `cordis_undefine`d, no residue                                                                                          |

**Phased roadmap (final version):**

1. Phase 1: random token protection (shared passphrase);
2. Phase 2: real login, credentials maintained in a config file (multiple entries = each admin's own credentials, mutually non-isolated);
3. Phase 3: OTP (TOTP) hardening.

---

## 1. Threat model: what this gate actually protects

Revised understanding: the **auth gate protects not just the "API Key" item but the single entry point of the entire dsh instance**. An unauthorized party who passes the trust fence (`--trusted-host`, which is only a DNS-rebinding barrier, not authentication) can reach:

| Asset               | Exposure path                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The API Key itself  | The GUI's `credentials.describe` is pinned to loopback and can't be read; but the agent's bash tool can directly `cat ~/.dsh/.credentials.yaml` (unless blocked by the file sandbox)           |
| LLM quota           | The more realistic main loss: no need to steal the Key — just open an agent session and freeload the API quota (cost abuse)                                                                    |
| All session history | Session list/content RPCs are open to every browser that gets past the fence; the agent shell can also read `sessions/*.jsonl` — which may contain secrets agents previously read into context |
| Server RCE          | The agent plane = arbitrary shell execution (the bash tool of the standard preset), which is the server shell exported outside                                                                 |

**Clarification about workspaces**: the workspace is a GUI organizational concept, **not an access-control boundary**. All sessions live in the same `DSH_HOME/sessions`, and any client that passes the gate can see and open all sessions (including others'). "Adding a local workspace on the client side" cannot stop cross-session reading. If inter-client privacy were ever needed in the future, that would be multi-user isolation — already decided not to do.

**Corollary**: the single-gate model (past the gate = full access) matches the protection goal exactly, so the plan is therefore the simplest; multi-user isolation is deleted.

---

## 2. Conclusion

**Feasible, and verified in practice.** The `webServer` service has no middleware, but its dispatch model of "look up the handler in a table per request" lets a Host plugin **with no upstream changes** guard-wrap all HTTP requests and all WS upgrades. Empirical evidence (probe already cleaned up, the conclusion is archived):

- fallback (SPA index), the `/api` prefix (including the dynamic-plugin RPC channel), exact routes, and both WS upgrades (`/api/events.mux`, `/api/events.host`) can all be intercepted, with zero perturbation on pass-through;
- wrapping the "existing table + registration methods" double insurance is unaffected by the order in which composition rows apply.

Implementation shape: **a static npm package (`dsh-auth`) + a web profile composition row** (production); the dynamic plugin was prototype-only (excluded: no `node:crypto`/`fetch`, invalidates on restart).

---

## 3. Current-state inventory (points; full code locations in the appendix)

- `webServer` service (`@deepseek-ai/dsh-host-webserver`): three tables `exact`/`prefixes`/`upgrades` + a single `fallback` slot; dispatch exact → longest prefix → fallback → 404; duplicate `(kind, path)` throws; **no middleware concept**.
- `@deepseek-ai/dsh-client-connection`: prefix route `/api` (bridging `apiProxy`) + two WS upgrades; every request first passes the `isTrustedApiRequest` trust fence (against DNS rebinding / cross-site) — **the comment states explicitly "not authentication"**.
- `PRIVILEGED_METHODS` (17 methods: `settings.*`, `credentials.*`, `agentPreset.*`, etc.) use an empty trust list to pin to loopback — comment original: "until a real authentication layer exists".
- `@deepseek-ai/dsh-host-frontend-static` exclusively owns the fallback to serve the SPA dist.
- Composition layer: the web profile root is empty, the patch stack = bundle patches (dsh-base → dsh-web-app → dsh-deeptutor) → profile layer → `$DSH_HOME/cordis.patch.yml` → `--patch` override layer; rows are overridden by id.
- The entire dependency tree has no auth package/service/event; the `/api` interceptor can only take over hit endpoints and the fence precedes it → it cannot serve as the gate.

---

## 4. Mount point: `webServer` guard wrapping

### 4.1 Principle

In the Host plugin's `apply`:

1. **Wrap the existing**: iterate `server.exact`/`server.prefixes`/`server.upgrades`, replacing each `handler` with `guard(original handler)`; wrap `server.fallback` the same way;
2. **Wrap the incremental**: override the instance methods `register`/`registerUpgrade`/`registerFallback`, so future registrations automatically go through the guard;
3. **Guard logic** takes `(req, res)` (for upgrades `(req, socket, head)`): public path whitelist / session validation, either allow or write its own 302/401, and for an invalid WS directly refuse the handshake (never entering `ws` negotiation);
4. **auth's own endpoints** (login/callback/logout/status) are registered with the original `register` captured before wrapping, to avoid self-blocking;
5. **Reversible lifecycle**: restore the original methods and table snapshots in `ctx.effect` (guard is withdrawn on deactivation/uninstall).

### 4.2 Skeleton (concept code, written for the static package)

```js
export function apply(ctx, config) {
  const server = ctx.webServer; // inject: ['webServer', ...]
  const guard = (kind) => (handler) => async (req, res) => {
    const pathname = String(req.url ?? "/").split("?")[0];
    const decision = await ctx.auth.decide(req, { kind, pathname }); // auth service: whitelist/session/target
    if (decision === "allow") return handler(req, res);
    if (decision === "redirect") {
      res.writeHead(302, { location: `/auth/login?next=${encodeURIComponent(pathname)}` });
      return res.end();
    }
    res.writeHead(401);
    return res.end("unauthorized");
  };
  const orig = {
    register: server.register.bind(server),
    registerUpgrade: server.registerUpgrade.bind(server),
    registerFallback: server.registerFallback.bind(server),
  };
  const snap = {
    exact: new Map(server.exact),
    prefixes: new Map(server.prefixes),
    upgrades: new Map(server.upgrades),
    fallback: server.fallback,
  };
  for (const [p, r] of server.exact)
    server.exact.set(p, { ...r, handler: guard("exact")(r.handler) });
  for (const [p, r] of server.prefixes)
    server.prefixes.set(p, { ...r, handler: guard("prefix")(r.handler) });
  for (const [p, r] of server.upgrades)
    server.upgrades.set(p, { ...r, handler: guardUpgrade(r.handler) });
  if (server.fallback) server.fallback = guard("fallback")(server.fallback);
  server.register = (r) => orig.register({ ...r, handler: guard(r.kind)(r.handler) });
  server.registerUpgrade = (r) => orig.registerUpgrade({ ...r, handler: guardUpgrade(r.handler) });
  server.registerFallback = (h) => orig.registerFallback(guard("fallback")(h));
  // auth public endpoints (orig.register) + self-check + restore, see §7/§8
}
```

### 4.3 Risks and discipline (long-term applicable with no upstream channel)

- Wrapping depends on `WebServer` internal fields and the "look up at request time" behavior, which are non-contract interfaces. **Every dsh upgrade must be regressed.**
- Startup self-check: probe-style check that all four entry classes are wrapped (unwrapped = bare-exposure; error at startup and write log).
- The guard code is centralized in one module, so if upstream provides contract middleware in the future, the migration surface is minimal.

---

## 5. Architecture design: gate constant, login flow pluggable

Key design: the **guard (gate) always does exactly one thing** — check the public whitelist, check the session cookie, and write 302/401 by target. "How a session is produced" is a **pluggable login flow**, layered by phase, without changing the gate:

```
request → guard → whitelist? ──yes──→ allow
               └─no→ session cookie valid? ──yes──→ allow (subject attached to request context, audit only)
                           └─no→ HTML navigation → 302 /auth/login
                                API/WS    → 401 / refuse handshake

login flows (enabled per phase):
  Phase-1 token flow   : POST /auth/login {token} → validate shared token → issue session
  Phase-2 password flow: POST /auth/login {username, password} → look up users file (hash) → issue session
  Phase-3 otp flow     : after password passes + TOTP validation → issue session (two-stage)
```

- Session records carry `subject` (fixed `"token"` in phase 1, the username in phase 2), **used for audit** (knowing in logs which credential produced the session), not paving the way for isolation.
- The login page is self-served by auth (self-contained HTML string, no third-party resources): the SPA sits behind the gate, so the login page must not depend on the SPA.
- All subsequent browser-side requests carry the cookie automatically (fetch/WS are issued by the upstream client; we don't change client code).

---

## 6. Phased design

### Phase 1: random token protection

- Generate a high-entropy token at deploy time (e.g. `openssl rand -hex 32`), write it into `.credentials.yaml` (entry name e.g. `DSH_AUTH_TOKEN`); the plugin config declares it as a **credential reference** (the `credentials` service only recognizes environment-variable names, resolving the value from `.credentials.yaml`/env — consistent with dsh's existing secret mechanism, the config surface never holds the value).
- Entry: `POST /auth/login` (self-contained page + form) submits the token → constant-time comparison → issue session cookie; also supports `Authorization: Bearer <token>` (curl/script friendly) to pass the guard directly.
- Session: §5's persistent session + `HttpOnly; Secure; SameSite=Lax; Path=/`.

### Phase 2: real login + config-file credentials

- Credentials file: `$DSH_HOME/auth/users.yaml` (self-created — the settings/credentials seams are a namespace/ single-value model respectively and can't fit a user table). Entry: `username → { passwordHash, totpSecret?, disabled? }`.
  Multiple entries' semantics: **each admin's own login credential, fully visible to each other** (no isolation).
- Password hashing: **scrypt (`node:crypto` built-in, chosen for M3 implementation — see §9 roadmap note)**; argon2id (`@node-rs/argon2` with a precompiled binary) and bcryptjs (pure JS) are alternatives. **Plaintext passwords never appear in files**.
- Companion admin CLI: `dsh-auth user add/list/disable` (generate hash, edit users.yaml) — to avoid hand-writing hashes and getting them wrong.
- Login rate limiting: count by IP + account, exponential backoff on failure; constant-time comparison.

### Phase 3: OTP (TOTP)

- RFC 6238 TOTP: `node:crypto` HMAC suffices, no extra dependency inside the static package.
- Add `totpSecret` to users.yaml; two-stage login: password passes → TOTP challenge page → issue session.
- Config items: OTP global switch, optional per-user, attempt rate limiting (TOTP window ±1, record recent verification codes for replay prevention).

### (Deleted) multi-user session isolation

Not doing it. Reason: the threat model is "protect the single entry of the whole instance", where everyone inside the gate trusts each other; session cross-reading is not a problem in a single-gate model. If inter-client privacy were truly needed in the future, session ownership filtering would need upstream cooperation — a separate project then.

---

## 7. Limitations of having no upstream PR channel

| Limitation                                        | Impact                                                                                        | Countermeasure                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrapping is a **non-contract interface**          | dsh upgrades may change field names/dispatch behavior → silent failure = bare exposure        | Startup self-check (§4.3) + upgrade regression checklist + keep an eye on dsh version changes                                                                                     |
| `PRIVILEGED_METHODS` **still pinned to loopback** | Even authenticated users can't change settings/credentials from the GUI (config only via SSH) | Accept (small impact under the single-gate model; it even closes the "insiders change config" path); optional hacky switch (guard rewrites the Host header to unlock) default off |
| No auth events/middleware                         | Must build the `auth` service name + wrapping ourselves                                       | No impact (one line on the host plane, single instance)                                                                                                                           |
| Login page can't be rendered with the SPA         | SPA unreachable in the pre-auth stage                                                         | Self-contained HTML login page (planned); post-auth session state/logout button can add a client half (browser plugin) into the GUI                                               |
| Trust fence doesn't know auth                     | `--trusted-host` still needs configuration; the two are orthogonal and stack                  | Note it in the deployment doc                                                                                                                                                     |

---

## 8. Defense in depth and security points

**Measures orthogonal to the gate, specifically serving the "protect the API Key" goal:**

- [ ] Server runs dsh under a **separate low-privilege OS user** (no sudo, no other project files) — if the agent plane is compromised, the damage is confined to that user; the API-Key leak blast radius is also minimized
- [ ] `.credentials.yaml` `chmod 600`; users.yaml also 600
- [ ] Tighten the sandbox policy of server deployment (agent tools restricted to the workspace, not reading `DSH_HOME`) — note this weakens agent capabilities, weigh as needed; at minimum don't read `.credentials.yaml` by default
- [ ] Treat session logs as **secret-bearing materials** (agents may have read secrets into context): protect them equally when backing up/sharing

**Points about the gate itself:**

- [ ] Session tokens stored only as SHA-256 digests; generated with 256-bit `crypto.randomBytes`
- [ ] Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/` (Secure relies on frontend TLS termination)
- [ ] Rotate the token on every successful login (anti-session-fixation); logout revokes and writes to disk
- [ ] Login rate limiting (IP+account, exponential backoff); TOTP replay prevention
- [ ] Passwords scrypt (node:crypto built-in, implemented in M3), zero plaintext in files
- [ ] Constant-time comparison; logs never record tokens/passwords
- [ ] fail-closed discipline: if the auth row is disabled, it's bare exposure → deployment acceptance checklist includes an "auth row health" check
- [ ] Self-contained login page (no CDN/third-party resources)
- [ ] dsh upgrade regression: four entry-class wrapping self-check + login flow smoke test

---

## 9. Roadmap

| Phase | Content                                                                                                                              | Deliverable                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| M0    | Probe verification of mount points                                                                                                   | ✅ done (probe already cleaned up)                 |
| M1    | `dsh-auth` package skeleton + guard + startup self-check + persistent sessions (storage domain)                                      | ✅ done: npm package host half + profile row       |
| M2    | Phase 1: random token gate (credentials reference + Bearer + login page issues cookie)                                               | ✅ done: deployable minimal public protection      |
| M3    | Phase 2: users.yaml + password hashing (**scrypt**, see note below) + login rate limiting + `dsh-auth user` CLI                      | ✅ done: real login                                |
| M4    | Phase 3: TOTP two-stage login + config items                                                                                         | OTP hardening                                      |
| M5    | Standalone reverse-proxy shell mode (proxy shell): listens on public net itself + reverse-proxies a bare dsh + Host/Origin rewriting | planned (recorded 2026-08-15, awaiting scheduling) |

> M3 note: per the user's decision, password hashing uses `node:crypto` **scrypt** (N=2¹⁶/r=8/p=1, zero added native dependency; spec `docs/implemented/impl-m3.md` P1/P2), replacing the argon2id/bcryptjs candidates in the earlier draft of this section.

### M5 (planned): standalone reverse-proxy shell mode (standalone proxy shell)

> 2026-08-15 project initiation driven by production-deployment evidence; read `docs/deployed/deployment.md` §8 (semi-shell production topology and fence fact table) before scheduling.

**Background (empirical findings)**: dsh 0.1.0-rc.6's browser trust fence pins privileged methods such as `settings.*` / `credentials.*` / `llm.discoverModels` to loopback only (`dsh-client-connection` `PRIVILEGED_METHODS`, which `--trusted-host` can't open up). Behind a public reverse proxy these endpoints are always 403. Measured matrix:

| Upstream Host                 | Origin           | privileged API |
| ----------------------------- | ---------------- | -------------- |
| `dsh.hi-ruofei.com` (current) | any              | 403            |
| `127.0.0.1:3080` (rewritten)  | matches loopback | 200            |
| `127.0.0.1:3080` (rewritten)  | stripped         | 200            |
| `127.0.0.1:3080` (rewritten)  | doesn't match    | 403            |

Conclusion: **"making dsh believe it's on loopback" and authentication must both be borne by the same shell layer** — adding only an auth shell without rewriting Host/Origin is ineffective (the fence and auth are orthogonal).

**Goal**: dsh-auth-gate adds a standalone deployment form — launched in a bare cordis context (standalone mount paradigm in repo-root `.serve-login.tmp.mjs`), listening on the public port itself, with a built-in reverse proxy to the "bare dsh" (zero plugins), automatically rewriting the Host/Origin headers; the login page/session/rate limiting/Bearer/logout reuse the existing gate logic and also cover the proxied entry.

**Benefits**:

- The dsh instance has zero plugins and zero coupling; upgrading dsh has no guard-compatibility risk (the current plugin form must run the deployment.md §5 regression on every upgrade);
- Settings page/credential management fully usable behind public net (privileged 403 disappears, no SSH tunnel needed);
- The shell is versioned and released independently, sharing the gate/session code with the plugin form (requires abstracting a common layer).

**Technical points**:

- Proxy layer: the cordis `webServer` registers a catch-all reverse-proxy route (forwarding + header rewriting) + upgrade-channel pass-through (WS 101);
- Header rules (measured): `Host: 127.0.0.1:<upstream port>` + strip `Origin` (or rewrite to the loopback origin); `Sec-Fetch-Site: cross-site` is still rejected by the fence (keep, defense in depth); cross-site cookies are covered by the gate's `SameSite=Lax` fallback;
- The session cookie's `Secure` relies on the shell's TLS termination (reusing deployment.md's precondition);
- Form entry suggested: `dsh-auth proxy --upstream 127.0.0.1:3080 --port 8443` (password/token mode config unchanged).

**Acceptance criteria** (echoing deployment.md §4's spirit):

- Unauthenticated: HTML 302 to the login page / API 401; after login `settings.describe`/`credentials.describe`/`settings.update` 200; WS with cookie 101, no cookie 401;
- Full public-browser flow: login → settings page with zero transport failures → chat streaming works;
- Bare-dsh side has no plugins and doesn't need `--trusted-host` (Host always loopback).

**Dependencies/risks**:

- The reverse proxy must handle streaming/SSE/WS/large bodies (dsh request-body limit 167772160 bytes);
- The proxy layer is a new attack surface: header-rewrite correctness is the priority; the upstream is fixed (`127.0.0.1`), so the SSRF surface is small;
- During coexistence with the plugin form, two entry points must be maintained; the spec first needs to abstract the common gate/session layer (suggested as M5's first step).

---

## 10. Appendix: key code locations

| Fact                                                              | Location                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webServer`: route tables/registration/dispatch/upgrade listening | `node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js` (register L53, registerUpgrade L67, registerFallback L82, match L194, upgrade listening L132) |
| `/api` prefix route + trust fence + WS registration               | `node_modules/@deepseek-ai/dsh-client-connection/lib/index.js` (isTrustedApiRequest L184, /api route L550-561, WS L566-585)                               |
| PRIVILEGED_METHODS (loopback-pinned list)                         | same file L504-520 (intent comment L485-503)                                                                                                              |
| SPA fallback slot                                                 | `node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js` L69-83                                                                                  |
| web host composition (webserver/connection rows)                  | `node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml` (webserver L115-120, connection L156-163)                                                        |
| storage domain usage pattern                                      | `node_modules/@deepseek-ai/dsh-message-feedback/lib/types/spec.js` + `lib/index.js` L258-267                                                              |
| credentials reference model (environment-variable names)          | `node_modules/@deepseek-ai/dsh-credentials/lib/types/index.js`                                                                                            |
| profile patch layer stack and bundle mechanism                    | `dsh/lib/profile-boot-*.js` (composeProfile)                                                                                                              |
| local web profile bundles                                         | `C:\Users\Randal_Wang\.dsh\profiles\web\package.json`                                                                                                     |
