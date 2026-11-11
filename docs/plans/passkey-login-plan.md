# Passkey (WebAuthn) sign-in: feasibility and implementation plan

> Status: **proposed, not started** (2026-11-11). Once approved this becomes the executable spec
> `docs/specs/passkey-webauthn.md`.
> Target milestone: **M6** (roadmap in `docs/specs/dsh-auth-plan.md` §9); release follows release-please
> (`feat:` → v0.19.0).
> Applies to `mode: "password"`. Token mode is unaffected (a non-off `passkey` value there logs an error
> and behaves as off).
> Related decision: D35 (`docs/decisions/proposed/2026-11-11-passkey-login.en.md`).
> Research inputs: `data/tmp/passkey-research/` (local directory, not committed).

## 1. Verdict

**Feasible, recommended; a mature library does the server-side verification, with hand-written browser glue.**

- `navigator.credentials` is a standard browser API, and the login page is already self-contained
  server-rendered HTML with progressive-enhancement inline JS. The new endpoints fit the existing `/auth`
  route table, and sessions, rate limiting, anti-enumeration and the failure card are all reused.
- Server-side verification goes to `@simplewebauthn/server@14.1.0` (MIT, Node ≥22; 10 direct / 21 transitive
  packages, ~870 KiB unpacked, host side only): CBOR/COSE/signature/attestation are **no longer hand-written**,
  and we keep only the policy layer (ceremony store, credential transaction, rate limiting, audit, UI). The browser
  glue is ~60–80 lines of `get`/`create` + base64url; the login page still ships zero third-party resources.
- The deployment prerequisites already exist: TLS termination in front of dsh (`cookieSecure: true` already
  needs it) and a configured `publicHost`. One new hard constraint: **the RP ID must be a domain and must
  match `publicHost`**. IP literals, plain `http://` intranet addresses and the `dsh-auth-proxy` local proxy
  (`http://127.0.0.1:8443`) cannot use passkeys; this goes into known-limitations.
- Explicitly out of scope: passkey-only sign-in, attestation policy, related origin requests,
  Playwright/CDP e2e. "Password sign-in still works without JS" remains an invariant.

## 2. Where we are

The login flow is already pluggable (plan §5): M2 token gate, M3 password, M4 two-stage TOTP. Sessions go
through `SessionStore` + `issueLoginSession` (`src/host/features/password/model/session-issue.ts:75-89`), and
the `/auth` prefix is passed through by the gate, so each endpoint does its own authentication and CSRF
checks (`src/host/features/password/model/password-gate.ts:47-72`, `src/host/shared/http/origin.ts:50-74`).

What is missing is **a sign-in method that does not involve a password**. TOTP only adds a second code to a
password; it does not stop phishing (real-time OTP forwarding), and it leaves password reuse, spraying and
offline cracking untouched. A passkey removes the password from the login path and binds the credential to
the origin (phishing-resistant).

Reusable: the SSR login page and failure cards, the urlencoded form channel
(`parseFormBody`/`formField`), `LoginRateLimiter`, `checkRequestOrigin`, `session-issue`, the client
"Account security" settings block, the CLI skeleton, and the integration-test harness. Missing: there is no
JSON body parser (this design stays on urlencoded and needs none) and no browser test layer (acceptance is
unit tests + real-stack integration + a manually recorded demo).

## 3. Scope

**v1 delivers**

| Capability       | Detail                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in          | A "Sign in with a passkey" button on the login page; username-less (discoverable credentials); one touch / biometric                                                                                             |
| Registration     | From Settings → Account security → Passkeys, for a signed-in user with a **full** session plus **re-authentication** (current password, plus a TOTP code when enabled); `excludeCredentials` prevents duplicates |
| Self-service     | List and remove own credentials (label, created, last used, backup eligibility)                                                                                                                                  |
| CLI              | `dsh-auth passkey list <user>`, `dsh-auth passkey rm <user> --id <id-or-prefix> [--all]`                                                                                                                         |
| Config           | `passkey: "off"/"optional"` (default off), RP display name, RP ID override, extra origins, counter policy                                                                                                        |
| Conditional UI   | The login page offers passkeys in the browser's autofill; off by default, an administrator can enable it from Account security and it takes effect immediately                                                   |
| Audit / failures | Registration, sign-in and counter regressions go to `ctx.logger`; failures are uniform 401; the login failure card stays the same shape                                                                          |

**v1 explicitly does not**

- `passkey: "required"` (passkey-only or forced enrolment): the lockout risk (all devices lost and the password
  path disabled) is unresolved; `totp: "required"` is no longer a reason (passkey sign-in is not constrained by it,
  see §5.8); environments needing "passkey only" keep `passkey: "off"` and use password/TOTP until v2.
- Attestation validation / MDS allow-lists; `appid`; `largeBlob`/`prf`/`credProtect`.
- Related origin requests (`/.well-known/webauthn`) and multiple registrable domains: v1 only accepts the exact
  origins listed in `passkeyOrigins`.
- Admin-issued one-time enrolment links; cross-device QR onboarding pages.
- Playwright/CDP virtual authenticators: the repo has no browser test layer; 1.5–2 person-days to cover ~50
  lines of glue is not worth it. jsdom unit tests plus a manual acceptance matrix instead.
- Login-page localisation: the login page is server-rendered and English-only by existing convention.

## 4. Threat model: what passkeys change

| Attack                                     | Today (password + optional TOTP)                  | With passkeys                                                                                  |
| ------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Phishing site impersonating the login page | Password phishable; TOTP forwardable in real time | Origin-bound: the browser refuses to release the credential elsewhere; **no longer phishable** |
| Offline cracking after a dump              | scrypt hashes can be attacked offline             | The server holds no private key; nothing to crack                                              |
| Credential stuffing / spraying             | Password policy + rate limiting                   | Unchanged (the password path remains)                                                          |
| Stolen session cookie                      | At risk                                           | **Unchanged**; still TLS/Host/Origin/SameSite/short TTL                                        |
| Compromised endpoint (keylogger/extension) | At risk                                           | Partly: sessions can still be stolen, private keys cannot (synced passkeys are the exception)  |
| Phishing the recovery channel              | Password remains an entry point                   | **Unchanged**: v1 keeps password sign-in, so a phisher can still phish the password            |
| Admin privilege abuse                      | At risk                                           | Unchanged                                                                                      |

Two boundaries that must be documented:

1. **A synced passkey is not device-bound**: iCloud Keychain, Google Password Manager, 1Password, etc. sync
   the private key to the cloud and usually set `BE` (backup eligible). A compromised cloud account plus local
   unlock is enough. We must not claim parity with a hardware security key. GitHub's passkey docs likewise
   acknowledge cloud-synced passkeys while still counting them as satisfying 2FA — this plan adopts the same
   model.
2. **Registration is the only new persistence surface**: an attacker who steals a session cookie and can add a
   passkey keeps permanent access (a password change does not evict it). Registration therefore requires
   re-authentication (§5.7). This is a security red line, not an option.

## 5. Design

### 5.1 The three flows

```
Sign-in (anonymous):
  GET /auth/login                     ← page renders the passkey affordance (shown by JS when enabled + supported)
  POST /auth/passkey/options          ← create challenge, store ceremony, Set-Cookie opaque id (120 s)
  navigator.credentials.get(...)      ← platform authenticator / cross-device (UV required, allowCredentials: [])
  POST /auth/passkey/login            ← plain form POST (hidden fields); verified → issueLoginSession → 302 next

Registration (signed in + re-authentication):
  POST /auth/passkey/register/options ← fields label/password/code; verify password (+TOTP) → options + cookie
  navigator.credentials.create(...)   ← residentKey required, UV required, excludeCredentials = existing ids
  POST /auth/passkey/register         ← verify attestationObject/authData/signature → write users.yaml → summary

Management (signed in):
  GET  /auth/passkey                  ← own credential list (no hashes, no key material)
  POST /auth/passkey/remove           ← field id; delete; guard for the last credential (§5.9)
```

The finish step uses a **hidden form POST, not fetch**: the 302 semantics, cookie issuance, failure card and
absence of CORS details stay identical to password sign-in. Only the options call needs fetch (JSON).

### 5.2 Configuration

Flat camelCase, same shape as `totp`; total options grow from 12 to 17:

```yaml
- id: dsh-auth-gate
  config:
    mode: "password"
    publicHost: "https://dsh.example.com" # existing; the only anchor for passkeys (never the Host header)
    passkey: "off" # "off" (default) | "optional"
    passkeyRpName: "DeepSeek Harness" # display name only
    passkeyRpId: "" # "" = hostname of publicHost (no port, no scheme)
    passkeyOrigins: [] # [] = [origin(publicHost)]; multiple for domain/port migration
    passkeyEnforceCounter: false # true = reject counter regression on device-bound credentials
    passkeyConditionalUi: false # passkey autofill on the login page; off by default, toggled in Settings
```

Derivation and self-check (fixed rules, no best-effort):

- `passkey` non-off but `publicHost` empty/invalid → **error log and behave as off** (the feature fails closed;
  the instance still starts; a feature misconfiguration must not take the whole login gate down).
- `rpId` must be a valid domain string (no scheme/port/path, **not an IP literal**, `localhost` special-cased);
  every origin must be `https`, or `http://localhost[:port]`; the origin hostname must equal `rpId` or be a
  subdomain of it.
- Origins compare as **exact scheme + host + port strings** (W3C L3 §13.4.9); no subdomain wildcards.
- The login page and all `/auth` responses send
  `Permissions-Policy: publickey-credentials-get=(), publickey-credentials-create=()`, so the instance cannot
  be used as a WebAuthn relay inside a cross-origin iframe (v1 does not support embedding; `crossOrigin: true`
  is always rejected).
- Staging and production origins are different, so credentials are not shared between them (expected; document it).

### 5.3 Cross-half contract (`src/protocol/`, each half enters through its single bridge)

New path constants in `src/protocol/index.ts` (pin them in `index.test.ts` first; `host:check` requires every
constant to be registered exactly once):

| Constant                        | Path                             | Method    | Auth                       |
| ------------------------------- | -------------------------------- | --------- | -------------------------- |
| `PASSKEY_OPTIONS_PATH`          | `/auth/passkey/options`          | POST      | anonymous (sign-in begin)  |
| `PASSKEY_LOGIN_PATH`            | `/auth/passkey/login`            | POST form | anonymous (sign-in finish) |
| `PASSKEY_REGISTER_OPTIONS_PATH` | `/auth/passkey/register/options` | POST form | session + re-auth          |
| `PASSKEY_REGISTER_PATH`         | `/auth/passkey/register`         | POST form | session                    |
| `PASSKEY_PATH`                  | `/auth/passkey`                  | GET       | session                    |
| `PASSKEY_REMOVE_PATH`           | `/auth/passkey/remove`           | POST form | session                    |
| `PASSKEY_SETTINGS_PATH`         | `/auth/passkey/settings`         | GET/POST  | admin session              |

`payloads.ts` gains pure types (additive only): options responses reuse the library's
`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` (the client passes them through);
the assertion/registration requests map urlencoded flat fields (`id`, `client_data_json`, `authenticator_data`,
`signature`, `attestation_object`, `transports`, `next`) into the library's `RegistrationResponseJSON` /
`AuthenticationResponseJSON` inside the endpoint; plus `PasskeySummary` (id prefix, label, createdAt, lastUsedAt,
backupEligible, transports), `PasskeyListResponse`, `PasskeySettingsResponse` (`conditionalUiEnabled`, admin
read/write) and `PasskeyErrorBody` (`unauthorized | forbidden | locked | unavailable | bad_request`).

Status-code matrix matches existing endpoints: 405 (with `allow`) → 415 (non-urlencoded) → 413 (oversized body)
→ 401 (unauthenticated/failed verification, uniform) → 403 (restricted session/finishing registration) → 429
(`locked` + `retry-after`) → 503 (session store unavailable).

### 5.4 Storage model (`users.yaml`, `version: 1` unchanged)

```yaml
users:
  alice:
    passwordHash: "scrypt$..."
    passkeyUserHandle: "<base64url 32 random bytes>" # one per user, created on first enrolment
    passkeys:
      - credentialId: "<base64url credentialId>"
        publicKeyCose: "<base64url raw COSE bytes>" # store raw COSE, not JWK
        alg: -7
        signCount: 3
        aaguid: "<uuid>"
        be: false
        bs: false
        uvInitialized: true
        transports: ["internal", "hybrid"]
        label: "MacBook Touch ID"
        createdAt: 1762760400000
        lastUsedAt: 1762764000000
```

Rules:

- Embedded in `users.yaml` (no separate `passkeys.yaml`): reuses `mutateUsersFile` locking + CAS + `.strict()`
  schema + 0600 permissions (`src/host/entities/user/model/users-file.ts`), and credentials follow the user's
  disabled/deleted state naturally.
- Adding fields touches five places: `UserRecord`, `userRecordSchema` (explicit new keys under `.strict()`),
  loader defaults, writer serialisation (`false`/empty arrays omitted so old files stay byte-identical), and
  the `src/host/entities/user/index.ts` export.
- Limits: ≤ 10 credentials per user; `label` ≤ 64 chars, control characters rejected (still escaped when
  rendered); `credentialId` ≤ 1023 bytes and **globally unique** (a credential cannot belong to two users).
- **TOCTOU**: global uniqueness, the per-user cap and first-time `passkeyUserHandle` creation must be
  re-checked inside the **same** `mutateUsersFile` mutator (lock + CAS) before writing. A lock-free pre-check
  followed by a write lets concurrent enrolments bypass the cap or overwrite a record.
- `signCount` is kept **in process memory** by default and is not written on every sign-in; `lastUsedAt` is
  persisted on a throttle (at most once per hour, for display only). Writing `users.yaml` on every sign-in adds
  write amplification and CAS contention with concurrent password changes, and "log on failure" already means
  the persisted value is unreliable. Cost: cross-restart clone detection is limited, so `passkeyEnforceCounter`
  is **best effort** and the docs must not claim reliable clone protection.
- `userHandle` must be `randomBytes(32)`, **never** username/e-mail/sequence id (it syncs to the cloud; the spec
  requires no PII).
- `/auth/status` only gains `passkeyEnabled: boolean` (config pass-through, always present); it never exposes
  whether a user has credentials. The client fetches the list from the authenticated `GET /auth/passkey`.

### 5.5 One-time state: a ceremony store (deliberately not the TOTP challenge cookie)

The WebAuthn challenge is a secret the server **must read back**, exactly once. That is different from the TOTP
stage cookie, which only records "stage cleared". Design:

- `Map<ceremonyId, Ceremony>`, process-level singleton (same lifetime as `LoginRateLimiter` /
  `TotpReplayGuard`); `Ceremony = { kind: "login" | "register"; challenge: Uint8Array; userId?: string; userHandle?: string; label?: string; expiresAt: number }`.
- The `dsh_auth_pk` cookie holds only a `randomBytes(32)` base64url id with attributes
  `Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=120` (`Secure` follows `cookieSecure`). TTL 120 s, 1024-entry cap (drop expired first, then the oldest), and **delete before verify** so a concurrent replay succeeds at most once.
- **The cap does not stop eviction attacks**: `/auth/passkey/options` must be rate-limited per client IP plus a
  global bucket (an independent `LoginRateLimiter` instance), and registration options additionally per user;
  otherwise an anonymous caller can create entries until other users' ceremonies are evicted.
- Restart/reload drops in-flight ceremonies; the user retries once. Same promise as the TOTP challenge cookie.
  **Single-process assumption**: the map only holds for one instance; multi-replica deployments need sticky
  sessions or shared storage and are explicitly unsupported in v1 (documented as a deployment limit).
- **Alternative considered** (recorded in the decision): D10's stateless signed cookie can carry a challenge,
  but replay protection then needs a "used challenge" set whose check-then-record race is harder to get right
  than delete-before-verify, and registration would have to sign the label/user binding into the cookie too.
  The in-memory map is not a second session store; it is per-ceremony state that never outlives the login.

### 5.6 Server-side verification (via `@simplewebauthn/server`)

Verification goes to `@simplewebauthn/server@14.1.0`: `generateRegistrationOptions` /
`generateAuthenticationOptions` produce the options, and `verifyRegistrationResponse` /
`verifyAuthenticationResponse` handle CBOR/COSE/signature/attestation parsing and checks. **We still own**:

1. The one-time ceremony: the library generates the challenge, but storage, cookie binding (opaque id + HttpOnly),
   TTL and **delete-before-verify** are ours.
2. Passing expectations: `expectedChallenge` (the ceremony value), `expectedOrigin` (`passkeyOrigins`),
   `expectedRPID` (`passkeyRpId`), `requireUserVerification: true`; at registration `supportedAlgorithmIDs:
[-7, -257, -8]`, `attestationType: "none"`, `userID` = `passkeyUserHandle`, `excludeCredentials` = existing ids.
3. Post-registration policy: reject `BE=0 && BS=1`; global credential uniqueness, per-user cap (≤ 10) and
   first-time userHandle creation are re-checked inside the **same** `mutateUsersFile` transaction; store `BE` for
   the sign-in consistency check.
4. Post-authentication policy: `response.userHandle` must be present and equal to the stored `passkeyUserHandle`;
   `BE` must equal the registration value (reject otherwise, §7.2); signature/COSE are verified by the library (no
   hand-written `crypto.verify`); the counter is taken from the library's `newCounter` and kept in process memory
   (regressions only warn by default, see §5.8).
5. Failure handling: uniform 401, equal work (unknown credential runs a verify against a fixed dummy or an
   equal-length compare), `cache-control: no-store`, bound parsing/verification cost; library exception messages go
   to server logs only, never to the response.
6. Request bodies stay urlencoded flat fields mapped into the library's JSON shape; bounds: fields ≤ 8/64 KiB,
   total ≤ 16 KiB.

**Why not hand-write**: CBOR/COSE/signature boundaries are the easiest place to get wrong (the research brief itself
wrote the COSE `crv` label incorrectly), and that layer is exactly what the library covers. What remains is the
business-policy layer (storage, binding, rate limiting, audit), which our tests still cover fully. The dependency
cost is accepted explicitly: 21 transitive packages, ~870 KiB unpacked, host side only, never in the browser bundle.

### 5.7 Pages and interaction

- Login page: SSR renders the button placeholder (`hidden`); inline JS feature-detects (`window.PublicKeyCredential`)
  and unhides it. Click → fetch options → `navigator.credentials.get` → fill a hidden form
  (`id/client_data_json/.../next`) → submit. Failures render the same server-side card with one new constant
  message (never request text); `AbortError` (user cancelled) just restores the button. Inline JS ~60–80 lines,
  CSS +0.4 KiB (inside the 6 KiB budget).
- Conditional UI: when the toggle is on, the login page calls
  `navigator.credentials.get({ mediation: "conditional" })` after load so passkeys appear in the password field's
  autofill (Chrome 108 / Firefox 119 / Safari 16+); the button path remains, unsupported browsers and `AbortError`
  fall back silently, and the password form is unaffected.
- Settings toggle: an administrator sees "Enable passkey autofill on the login page" in Account security; the
  toggle writes via `POST /auth/passkey/settings` to the host settings service and updates the runtime flag
  immediately; off by default, current state shown on the page (read-only for non-admins).
- Settings panel: new `src/client/features/passkey/**` slice (api/model/ui) mounted in the signed-in branch of
  account-section; list + "Add passkey" form (label + current password + TOTP code) → create → finish → refresh;
  delete button. Copy goes into both zh/en dictionaries in `src/client/shared/i18n/account-copy.ts`.
- Registration re-authentication: `register/options` verifies the current password (via `verifyPassword`; wrong
  password is a uniform 401; separate rate-limit bucket) and, when `totp !== "off"` and the user has a secret,
  also requires a code (reusing `verifyTotpCode` + the shared `replayCheck`). **A session alone is not enough to
  register** — this is the only block against "stolen cookie → backdoor passkey".
- CLI copy stays in the existing English style; `dsh-auth passkey rm` matches a credentialId prefix (≥ 8 chars)
  and supports `--all`.

### 5.8 Interaction with TOTP, restricted sessions, disabled users

- **TOTP**: **adopt GitHub's passkey model** — [GitHub Docs: About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
  states that passkeys satisfy both the password and 2FA requirements, so a passkey sign-in completes in a single
  step even when the account has TOTP enabled. A passkey sign-in is therefore always a **complete authentication**,
  and `totp` explicitly means "two-step verification for **password** sign-in": `totp: "required"` constrains the
  password path only and never blocks passkeys. When `totp: "required"` and passkeys are enabled, the plugin logs
  an info line at startup (no warn, no downgrade): passkeys satisfy 2FA. Environments that need an independent
  second factor and do not accept synced passkeys set `passkey: "off"`, the single escape hatch.
  The residual risk is documented honestly: synced passkeys (BE=1) are copied to the cloud and are not equivalent
  to a hardware key; the GitHub precedent and the phishing-resistance gain outweigh that risk, and TOTP itself can
  be relayed in real time. The alternative (TOTP after the passkey, two stages) is a v2 item that first requires
  lifting the TOTP second stage out of the password slice.
- **Restricted sessions**: success always goes through `issueLoginSession` (`must_change_password` → 15-minute
  restricted session, password page only). Registration and management endpoints require `kind === "full"`;
  restricted sessions get 403 (same shape as admin endpoints).
- **Disabled/deleted users**: passkey sign-in reads users.yaml at login time; disabled users get the uniform 401;
  deleting a user deletes the credentials with the record.
- **Admin password reset** of another user does not touch passkeys (matching today's behaviour of not touching
  TOTP secrets); session revocation does not revoke credentials.
- **`passkeyEnforceCounter`**: default false (warn only); true rejects regressions only for device-bound
  credentials (`be=false && bs=false`). Counters live in process memory and do not survive restarts, so this is
  best-effort detection, not a clone-protection guarantee.

### 5.9 Recovery, audit and operations

- Lost device: other credentials still work; all lost → password sign-in, then remove old and add new in
  Settings; password also forgotten → admin `dsh-auth user passwd`. v1 has no recovery codes; document that the
  password is the last recovery channel.
- CLI: `passkey list` (label/created/last used/BE), `passkey rm --all`. Removal of the last credential warns
  when the user has no usable password (only meaningful with `passkey: "required"`, not in v1); the password path
  always exists.
- Audit: registration/removal/successful sign-in/counter regression → `logger.info` (username, first 8 chars of
  the credentialId; never the full value, never clientData); failure reasons only in server logs, never in the
  response.
- Operations: the deployment doc gains a checklist and symptom table for "RP ID / publicHost / HTTPS / proxy
  port" (the three typical causes of "passkeys never work"); known-limitations gains: IP/HTTP direct access is
  unsupported, the local proxy mode is unsupported, iOS third-party browsers may be unavailable (feature-detect
  and degrade), attestation is not
  validated, no passkey-only mode, conditional UI off by default (admin toggle in Settings).
- Version corridor: the feature does not touch `engines.dsh` or the storage-domain peer; `lib/` is rebuilt in the
  same commit; route literals only live in `src/protocol/`.

## 6. Implementation approach: a mature library for verification

| Option                                                         | Trade-off                                                                                                                                                          | Verdict                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| A. `@simplewebauthn/server@14.1.0` + hand-written browser glue | MIT, dual ESM/CJS, Node ≥22; 10 direct / 21 transitive packages, ~870 KiB unpacked (host side only); CBOR/COSE/signature/attestation handled by the library        | **Chosen**                                |
| B. Hand-written verifier (`node:crypto` + minimal CBOR/COSE)   | zero runtime deps, but 250–400 lines of security-boundary code + 300–400 lines of tests; COSE label details are easy to get wrong (the research brief already did) | Not chosen                                |
| C. Only `@levischuck/tiny-cbor`                                | 0 deps, 140 KiB unpacked; solves CBOR only, COSE/verification still hand-written                                                                                   | Fallback (if the dependency review fails) |
| D. `fido2-lib`                                                 | 12 packages; `cbor-extract` is a native module compiled at install time                                                                                            | Not chosen                                |

Rationale: the reviewer's point that "a bigger dependency is not automatically less secure" is right — A is chosen
because **it covers the security boundary that is easiest to get wrong**, while our own work sits in the policy layer
it does not cover (ceremony, credential transaction, rate limiting, audit, UI). The cost is accepted explicitly: the
published plugin pulls 21 transitive packages, ~1 MB, host side only (never in the browser bundle); the version is
**pinned exactly** to `14.1.0`, `lock:check` only allows the public registry, and upgrades go through a separate PR
with regression tests. No `@simplewebauthn/browser`: the login page's zero-third-party-resource rule keeps the
~60–80 lines of `get`/`create` + base64url hand-written (not a security boundary; the server verifies).

## 7. Phasing, effort and acceptance

| Slice                                           | Content                                                                                                                                                                                                                                                       | Estimate       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| PR1 contract + storage + ceremony               | protocol constants/types and pinned-value tests; users.yaml fields (schema/loader/writer) with unit tests; ceremony store + cookie; config + startup self-check; CLI list/rm; `passkeyEnabled` in `/auth/status`                                              | ~2 person-days |
| PR2 sign-in + conditional UI                    | add and pin the library version; options/login endpoints (generate/verify); login-page button + conditional-UI inline JS; failure-card constant; rate limiting/anti-enumeration; real-stack integration test + manual acceptance                              | ~2 person-days |
| PR3 registration + management + settings + docs | register options/finish + re-authentication; client feature + account-section; conditional-UI settings toggle (admin, settings-persisted, off by default); i18n; audit; README/known-limitations/config skill; ADR moved to implemented; `lib/` rebuild; demo | ~2 person-days |

Total **~6–7 person-days** (including library integration, the settings toggle and the security tests; excluding
review rounds and real-device matrix time). The three PRs depend on each other in order and are independently
reviewable; each PR passes its own relevant gates (`host:check`, README routes, bilingual docs, `lib/` rebuild)
rather than deferring all of them to PR3.

**Definition of done**

1. `npm run verify` (14 steps) green, including the 80% coverage red line, `host:check` route/README checks,
   `decisions:check`, `docs:check`, `readme:parity`.
2. Unit tests: the parameters passed to the library (expectedChallenge/origin/RP ID/UV/algorithm allow-list);
   ceremony issue/expiry/replay/concurrency; credential transaction (uniqueness/cap/userHandle/concurrent
   enrolment); rate limiting; uniform anti-enumeration responses.
3. Integration (real cordis + WebServer stack): begin → sign with a self-built authenticator → finish, asserting
   302 + `set-cookie` + a usable session; failure path 401 with no cookie; disabled-user and restricted-session
   cases.
4. Integration fixtures: W3C §16.2 (ES256/`fmt:none`), §16.4 (`crossOrigin` rejection), §16.6 (1023-byte credId)
   plus a self-built authenticator's registration/sign-in inputs, verifying the library-call contract and our
   rejection paths; library exceptions must never reach the response.
5. Manual acceptance matrix: Chrome/Edge (Windows Hello), Safari (macOS Touch ID), Safari iOS, Firefox, Android
   Chrome; cross-device sign-in; cancel/timeout/no-passkey failure copy; password sign-in unaffected without JS.
6. Docs: both READMEs (config table, CLI, first run), known-limitations, deployment checklist, config skill, ADR
   moved to implemented when landed.

## 8. Risks and mitigations

| Risk                                                               | Impact                                                              | Mitigation                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registration without re-authentication → backdoor passkey**      | A hijacked session yields permanent access                          | Registration requires the current password (+TOTP); `Sec-Fetch-Site`/Origin checks; separate rate-limit bucket; audit                                                                     |
| **RP ID/origin mismatch with the existing proxy shell deployment** | Every passkey sign-in fails with an incomprehensible browser error  | Only derive from `publicHost` (never the `Host` header); startup self-check + error-log downgrade to off; failure card gives an actionable hint; password path untouched                  |
| Library supply chain / upgrade surface                             | Vulnerabilities and breaking upgrades across 21 transitive packages | Pin `14.1.0` exactly; `lock:check` allows the public registry only; upgrades via a separate PR with full regression; fallback `@levischuck/tiny-cbor` with hand-written COSE/verification |
| `signCount=0` misjudging synced passkeys                           | Locking legitimate users out                                        | Compare only when both sides are non-zero; warn by default; `passkeyEnforceCounter` only for device-bound credentials                                                                     |
| Session theft (unchanged)                                          | Impersonation                                                       | Out of scope for v1 (TLS/host threat model); documented that passkeys do not change it                                                                                                    |
| Browser/enterprise policy disables WebAuthn                        | Button unusable                                                     | Feature-detect and hide; password always works; iOS third-party browsers documented                                                                                                       |
| Doc/README drift                                                   | Gate goes red or misconfigurations                                  | `host:check` + `readme:parity` force both READMEs; config skill updated in the same PR                                                                                                    |
| Anonymous options flood evicting other ceremonies                  | Other users' sign-in ceremonies get evicted (availability)          | Rate-limit options per IP + a global bucket; entry cap + expiry sweeper; single-process assumption documented                                                                             |
| Concurrent enrolment bypassing the cap / uniqueness                | Overwritten or excess credentials                                   | Uniqueness, cap and userHandle re-checked inside the same `mutateUsersFile` lock                                                                                                          |
| Counters mistaken for clone protection                             | Security promise overstated                                         | Counters live in memory; `passkeyEnforceCounter` labelled best-effort; README states the boundary                                                                                         |
| Operators treating passkeys as an independent second factor        | Mismatch with the TOTP security assumption                          | Document that passkeys are two factors in one and may be synced; environments needing an independent factor set `passkey: "off"`                                                          |

## 9. Decision status

**Decided**

1. **Verifier**: server-side `@simplewebauthn/server` (user confirmed; browser glue stays hand-written).
2. **TOTP relationship**: GitHub model — passkey sign-in is always a complete authentication; `totp` scopes the
   password path only.
3. **Default**: `passkey: "off"`.
4. **Conditional UI**: shipped in v1, off by default, enabled by an administrator from Account security (effective
   immediately).

**Still open**

1. **Strength of verification when removing a credential**: session + `checkRequestOrigin`; re-auth (password +
   TOTP code) for the last credential or `--all`. (Decided.)
2. **CLI one-time enrolment link** (admin-issued, for remote users): v2; v1 is "sign in, then enrol". (Decided.)

> All six decisions were approved on 2026-11-11 and implementation has started; PR1 begins with the contract,
> `users.yaml` fields, the ceremony store and the CLI.

> **Implementation status (2026-11-12)**: PR1 is committed (`152e46b`). PR2 is complete and the full
> `npm run verify` chain is green (160 files / 1379 tests, including lint/FSD/coverage/build/bundle/host
> checks): `@simplewebauthn/server@14.1.0` (pinned exactly), `POST /auth/passkey/options` and
> `/auth/passkey/login` (library verification, discoverable/username-less sign-in, userHandle/BE/counter
> policy, a separate rate-limit bucket, dummy equal-work), the login-page passkey button with inline JS and
> conditional UI (autofill, gated by `passkeyConditionalUi`), passkey retry on failure cards, and a real-stack
> integration test with a self-built EC P-256 authenticator. The change sits in the `feat/passkey-login`
> worktree (including the rebuilt `lib/`), uncommitted; PR3 (registration/management, settings toggle,
> README/deployment docs, ADR moved to implemented) remains.

## 10. References

- W3C WebAuthn Level 3: registration checks §7.1, authentication checks §7.2, `fmt:none` §8.7, BE/BS flags
  §6.1.3, RFC 8152 COSE Key labels (kty=1, alg=3, crv/x/y=-1/-2/-3), exact origin matching §13.4.9, related
  origins §5.11, official vectors §16.2/§16.4/§16.6.
- MDN / caniuse: browser support and conditional-UI versions (Chrome 108 / Firefox 119 / Safari 16; iOS
  third-party browsers use WKWebView and are unreliable).
- In-repo anchors: `src/host/features/password/api/password-endpoints.ts:136-170` (route registration model),
  `src/host/features/password/model/session-issue.ts:75-89` (single session issuance path),
  `src/host/features/password/model/challenge-cookie.ts` (D10 signed-cookie precedent),
  `src/host/shared/http/origin.ts:50-74` (CSRF check), `src/host/entities/user/model/users-file.ts` (users.yaml),
  `src/endpoints-wiring.ts` (root wiring), `src/client/widgets/account-section/ui/account-section.tsx:58-79`.
- External review: `docs/reviews/kimi-k3.1-passkey-review.md` (2026-11-11, Kimi K3.1 Pro, request-changes;
  F1–F8 addressed above).
- `@simplewebauthn/server` v14.1.0 docs (options generation and the expected-value parameters of `verify*`):
  [simplewebauthn.dev](https://simplewebauthn.dev/docs/packages/server).
- GitHub Docs: [About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
  (passkeys satisfy both password and 2FA; the position on cloud-synced passkeys).
- Related decisions: D2 (fail-closed/startup self-check), D3 (zero-dependency scrypt precedent), D10 (HMAC
  challenge cookie), D19 (client IP), D31 (cross-half contract), D35 (this proposal).
