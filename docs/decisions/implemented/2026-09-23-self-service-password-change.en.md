# D22. Self-service password change in the Settings panel: `POST /auth/password`, then revoke every session

## Decision

A signed-in user can rotate their own password from the dsh Settings panel. The server adds exactly
one exact route:

- **`POST /auth/password`** (registered in password mode only; token mode registers nothing, so
  `/auth/password` falls through to the prefix `/auth` 404 fallback). The body is
  `application/x-www-form-urlencoded` with `current` (current password), `password` (new password)
  and `code` (TOTP verification code, required whenever `totpMode !== "off"` and the user has a
  secret). The "new password typed twice" check lives in the client and the CLI only; it never
  enters the request body.
- **Frozen processing order:** method 405 → `parseFormBody` (415/413) → cookie locates the
  `subject` (401; cookies only, never Bearer, same as `/auth/status`; an unavailable session store,
  `sessions()` returning `undefined`, is also 401 `unauthorized`, because the plugin's gate is
  already fail-closed while `AuthService` is not ready and a half-started plugin must not be
  reported as an operator fault) → dedicated rate-limit bucket (429) → read the users snapshot
  (503; a read failure does not count as a failure; this is an **out-of-lock decision read**, and
  the authoritative in-lock snapshot is the one the `mutateUsersFile` mutator receives, see below)
  → constant-time current-password verification (**unknown users** run against `DUMMY_HASH` to keep
  existence timing equal, while **known users, disabled ones included,** run against their real hash
  and the `disabled` decision is layered on top, exactly as in the login path P9; a miss is
  `recordFailure` + 401 `invalid_credentials`) → TOTP verification (a
  missing code, a wrong code, a same-window replay, or a user without a secret under `required`
  mode is **always `recordFailure` + 401 `invalid_totp`**) → policy check (400 `policy` with
  per-rule `rules`, which also counts as a failure) → `hashPassword` (a throw also answers 503,
  like a write failure, and is not counted as a wrong password) → CAS + write inside the lock
  (503; a write failure counts as a failure but **never revokes sessions**) → **after a successful
  write** `recordSuccess` → revoke every session of that subject (**including the current one**) →
  clear the cookie → `200 {"ok":true}` with `content-type: application/json`.
- **The order is a hard constraint:** write first, revoke second. The reverse can produce "everyone
  was kicked out but the password did not change", and an attacker could trigger it at will.
- **Inside a conflict window, refuse rather than overwrite:** the mutator re-verifies the current
  password against the **fresh in-lock snapshot** taken by `mutateUsersFile` (re-running after a CAS
  conflict, at most 3 times). If someone concurrently changed that user's password, the in-lock
  re-check fails and the endpoint answers 503 instead of writing the new hash over the state the
  other writer just committed. By the same token, the snapshot injected through `loadUsers` is
  **not** an authoritative in-lock read: it only serves the existence / disabled / old-hash decision
  made before the write.
- **A successful self-service change clears the `must_change_password` flag** (when present): this
  phase only reserves that field in the schema (see D23) and the login path does not read it. The
  same mutator writes the default back conditionally (`false` is never persisted), so that P2's
  forced-change login gate, when it ships, cannot immediately stop a user who just changed their
  password.
- **TOTP second-factor confirmation reuses the same `replayGuard` singleton as the login path**
  (the existing injection point in `index.ts`; feature slices never import each other): after
  `verifyTotp` succeeds, `replayCheck(subject, counter, code)` runs, and either failure answers 401
  `invalid_totp`. **Same-window semantics: wait for the next code.** Submitting a change inside the
  30 s window already spent by the login is rejected as a replay; that is expected behavior and both
  the UI and the docs say so. **Ordering trade-off (deliberate):** TOTP verification runs **before**
  the policy check and the write, so a rejection for a policy failure burns the current 30 s window
  too and the user must wait for the next code; moving TOTP after the policy check would widen the
  code's replay surface (retries after a policy failure would no longer be window-constrained), so
  this phase does not rearrange the order.
- **Dedicated rate-limit bucket:** `index.ts` creates its own `LoginRateLimiter` instance (a
  different instance and a different bucket from the login limiter) keyed by IP
  (`deps.clientIp?.(req)`) plus subject. On success `recordSuccess(ip, subject)` clears the bucket,
  so a user is never locked out by the very lockout their own change just triggered; keeping login
  and change buckets separate also removes the "hammer the change endpoint to lock the login" DoS
  amplifier. **A write or hash failure also counts as a failure in this bucket** (a deliberate,
  conservative choice): a concurrent conflict that answers 503 calls `recordFailure` too, so one user
  hitting conflicts on several devices in quick succession can briefly get 429 from the change
  endpoint. The cost is confined to the change endpoint itself: the bucket is completely independent
  of the login bucket, so sign-in is unaffected, and no exemption counter is opened for it.
- **Known residual: a failed session revocation is not retried.** After a successful write the
  endpoint calls `revokeBySubject` to sign the subject out everywhere; if **that step throws**, the
  implementation logs an error and still answers 200, neither retrying nor downgrading the response:
  `logger.error("sessions not revoked after password change: <subject> (<n> sessions)")`. The
  reasoning: the password **has already been changed on disk**, and answering 503 would make the
  user believe the change failed and not retry (or retry repeatedly), so 200 is the honest
  description of the state. The cost is recorded plainly, not glossed over: in the extreme case the
  new password is in force while the old cookie still works, and that window is bounded only by the
  session TTL (7 days by default). Mechanically, `AuthService` wraps "revoke this subject's
  sessions" in a best-effort helper with try/catch, so a failure produces an error log and the
  exception semantics are not swallowed into a silent success. **P2 candidate: retry/alert on a
  failed revocation; explicitly out of scope this phase.**
- **Known residual: the same-site subdomain CSRF vector is not handled.** The session cookie is
  fixed to `SameSite=Lax` (`COOKIE_FLAGS`), so a cross-site form POST carries no cookie and classic
  CSRF does not apply; but when an attacker controls any subdomain of the site, that vector still
  exists. This phase **adds no CSRF token** and does not change the cookie attributes; it is recorded
  plainly next to the residual above rather than glossed over. P2 candidate: a double-submit token.
- **Client:** a new `settings.section` in the Settings panel (`id: "dsh-auth-gate-account"`,
  order 500). Signed out renders no form; signed in renders the four-field form and submits with
  `fetch`, mapping errors per the frozen response matrix (401 `invalid_credentials` /
  401 `invalid_totp` / 400 `policy` / 429 `retryAfter` / 503). The success copy states that the
  password was changed and that the current device has been signed out too.
- **Audit:** success logs `logger.info("password changed")`; failures reuse the existing
  `"login rejected"` style constant strings. **No log may ever contain the current password, the new
  password or the code in plaintext** (asserted by a test).
- **Frozen-spec amendment:** the route model moves from M2's "1 prefix + 3 exact" to
  **"1 prefix + 4 exact"**, the fourth exact route being `/auth/password`. Following this repo's
  convention, the M5/M15 rows and the surrounding prose of `docs/implemented/impl-m2.md` carry a
  "D22 amendment" note as soon as this record takes effect.

## Context

Until now, rotating a password had only an offline channel (`dsh-auth user passwd`, see D23): an
administrator on a public deployment had to log into the server and open a shell to change even
their own password. That friction directly raises the odds of a password staying unchanged for
years; self-service moves the step back into the browser without adding any new privilege
escalation surface.

Technically this is a **sensitive operation inside an already authenticated session**: the request
carries a plaintext old and new password, and the action overwrites the credential itself. Four
things had to be handled at once: locating the session (who is changing), verifying the credential
(is this really them), second-factor confirmation (a TOTP user must not be able to change a password
with a stolen session cookie alone), and what happens to **existing sessions** afterwards. The first
three extend naturally from the login path; the fourth is the real decision, because one purpose of
changing a password is to evict sessions that may already have leaked, so "just save the new hash"
is not enough.

The constraints come from contracts that were already frozen: M2's route model (prefix fallback plus
exact routes, no duplicate path registration, no method routing so each handler dispatches by
`req.method` internally), M3's response-shape discipline (one constant per failure class, no
reflection of request text, `cache-control: no-store`), the limiter's bucket semantics, and the
counter-granularity of the TOTP `TotpReplayGuard` (a second submit in the same counter is rejected).
The feasibility evaluation (workspace file
`notes/tech/dsh-auth-gate/password-change-feasibility-2026-09-23.md` §3) re-checked each of these
against this repository; this record freezes the conclusions.

## Alternatives Considered

- **A separate change-password page (`GET /auth/password` + `302` + form submit)** - rejected: it
  adds a GET exact route and a new page, straining the 6 KB CSS budget and the anti-phishing identity
  block, and a `302` makes a fetch client read a failure as a successful navigation (the exact trap
  already argued in D20). `fetch` from the Settings panel plus `200 {"ok":true}` follows the same
  pattern as the existing `/auth/status` call: the status code is the result, no redirect needed.
- **Revoke only the other devices, keep the current session** - rejected: the most common trigger
  for a password change is a suspected credential leak, and at that moment **there is no way to tell**
  which session belongs to an attacker. Keeping the current session silently assumes "this device is
  clean", which is exactly the assumption that cannot be verified. Revoking everything including the
  current session is simple, assertable, and costs the user one extra sign-in.
- **No TOTP confirmation (the session cookie is enough)** - rejected: a session cookie is a
  long-lived credential (7 days by default) and a password change is credential rotation; without
  confirmation, a stolen session means permanent account takeover, because the attacker can change
  the password and lock the real owner out. Requiring the code restores the "holds both the password
  and the device" strength the login path already has.
- **Force a password change through the login path (`must_change_password` in effect)** - rejected:
  this phase only reserves the `must_change_password` field in the schema (see D23); the login path
  **does not read** it. Forced routing would change the login success path, add a mandatory
  change-password page and handle branches such as "what if the change fails"; both the work and the
  regression surface are large. Admin-side resets in this phase are "reset + revoke every session of
  the target + audit" (P2). Reserving the field guarantees P2 only adds, never reworks.
- **Share the login rate-limit bucket** - rejected: an attacker could hammer the change endpoint
  until the victim's bucket answers 429, which would then lock the victim's **login** as well, a DoS
  amplifier. Separate instance, separate bucket, no cross-talk.
- **Build a local `replayGuard` instance inside the change endpoint** - rejected: the same TOTP code
  would then be accepted twice inside one 30 s window, breaking the consumption semantics. Sharing
  the singleton is the only correct shape given the slice boundary (feature slices may not import
  each other); the cost is "wait for the next code in the same window", recorded honestly rather
  than hidden.
- **Add `GET /auth/users` / `POST /auth/users/password` admin endpoints in the same pass** -
  rejected for this phase: that is P2 and it opens a new HTTP privilege-escalation surface with its
  own audit requirements. Role grants go through the CLI only (D23); P1 adds no administrator
  operation endpoint.

## Why

This is the smallest server-side change that hands password rotation back to the user inside the
Settings panel: one exact route, one feature file and one shared policy module. It does not change
the shape of the route model (still a prefix fallback plus exact routes), does not change any
existing failure shape, adds no dependency and opens no privilege-escalation surface. Every security
judgment reuses a component already proven in production: constant-time password verification, the
`DUMMY_HASH` existence-equalization trick, `LoginRateLimiter`, the `TotpReplayGuard` singleton and
`buildSetCookie` for clearing the cookie.

The ordering constraint (write first, revoke second) structurally rules out the worst failure mode
("everyone kicked out but the password unchanged"); a failed write answers 503 and keeps every
session alive. The opposite direction (a successful write with a failed revocation) cannot be
eliminated inside one transaction, so the team deliberately chose "answer 200 truthfully, log an
error, do not retry" and recorded "a stale cookie survives until the TTL" as a known residual
instead of skipping it silently. Revoking the current session as well makes "changing a password is
a terminal step" assertable and keeps the E2E criterion simple: after a change, the old cookie must
be dead and the user must sign in again. The "same window needs the next code" consequence of
sharing the TOTP singleton is a known behavior documented in the UI and here, not a defect.

Independent evaluation and evidence index: the feasibility evaluation
`notes/tech/dsh-auth-gate/password-change-feasibility-2026-09-23.md` §3 (server-side key points 1
to 13) and §6 (decided by the owner on 2026-09-23 16:49). The frozen implementation contract lives
in the workspace at `tmp/auth-pwchange/CONTRACT.md` §1, §4, §5 and §6.
