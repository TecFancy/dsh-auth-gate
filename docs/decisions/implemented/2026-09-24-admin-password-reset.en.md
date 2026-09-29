# D25. Admin password reset and the forced-change login gate

## Decision

Add exactly two admin endpoints (registered in password mode only) and turn the reserved
`must_change_password` field into a real login gate. The password-mode routing model becomes
**1 prefix + 6 exact**; token mode keeps its 3 exact routes.

1. **`GET /auth/users` (admin list)**: no session `401`; a session that is not an admin **or is a
   restricted session** `403`; success `200 {"users":[{"name","role","disabled","totpEnabled",
"mustChangePassword"}]}`, ordered by `name` (the existing `compareNames`). **Field whitelist**
   (asserted by key-set equality): no pagination, no ETag, no hash/salt/scrypt parameters/session
   count/last-login time; a missing field must not 500. `cache-control: no-store` +
   `pragma: no-cache`. `/auth/users` **does not** write an audit event per call (noise).
2. **`POST /auth/users/password` (an admin resetting someone else's password)**: urlencoded fields
   `target` (**body only**; a `target` in the query is always ignored), `password`, `confirm`,
   `code` (the **actor's own** TOTP, required only when the actor has TOTP enabled; an actor without
   TOTP who sends `code` gets it **ignored**, hard-coded, never a 400, and the code still never
   reaches a log). Success `200 {"ok":true,"sessionsRevoked":boolean}`.
3. **Processing order (hard constraint, assertable step by step)**: `405` → `415/413` (reusing the
   existing form-body parsing and size cap) → **Origin / `Sec-Fetch-Site`** → session `401` →
   **non-admin `403`** (re-read `role === "admin" && !disabled` from `users.yaml` on every request,
   never a cached session value) → **restricted session `403`** → admin rate-limit bucket →
   re-read users → **target name validity `400`** (the same `USERNAME_RE` the CLI uses, no disk
   touch) → **target missing `404`** → **`target === actor` `403`** (before TOTP, so the actor cannot
   burn their own 30-second window) → **policy `400`** (reusing `password-policy.ts`, including
   `≠ old password`, verified once against the target's current hash; **policy runs before TOTP**,
   a non-compliant password must not consume a code) → **conditional TOTP `401`** (only when the
   actor has it enabled; a wrong or same-window-replayed code writes nothing, sharing the login
   path's `TotpReplayGuard` singleton with consume-on-verify) → **in-lock RMW write**
   (`mutateUsersFile`: set `must_change_password: true`; **`totpSecret` untouched byte for byte**;
   not part of the last-admin check) → **revoke every session of the target (not the actor)** →
   **clear the target's login lockout bucket and self-service change bucket** → `200` + audit.
   Why this order: Origin sits after 405/415 and before 401 (an authenticated script without an
   Origin should get 403, not a fake 401, and a malformed body need not go through CSRF judgment
   first); non-admin 403 precedes 404 (otherwise a non-admin could probe existence through 404);
   rate limiting sits after 403 (an ordinary user must not be able to fill an admin's bucket with
   429s).
4. **Forced-change login gate (restricted session)**: after password + TOTP succeed, a user with
   `must_change_password === true` gets a `kind: "password-change-only"` session (**15 minute** TTL,
   not renewed; cookie name/attributes/path identical to a full session) and a `302 /auth/password`
   (**`next` ignored**); no flag means a full session. **Login failures (wrong password or wrong
   TOTP) are indistinguishable** between flagged and unflagged users (the flag is never read before
   the password check). The restricted allow-list is hard-coded: `GET`/`POST /auth/password` (the
   POST still requires `current`), `GET /auth/status` (own fields only) and `POST /auth/logout`
   (must be allowed, or the user cannot hand the browser over before the TTL expires);
   `GET /auth/login` → `302 /auth/password`; `POST /auth/login` → `403` (log out first);
   `/auth/users*` → reaches the handler, `403` (**not** a gate 302); host `/api`, static assets,
   `/plugins` and WS upgrades are all denied (navigation `302 /auth/password`, API `401`, WS
   handshake refused). **The gate trusts `session.kind` only** and must not read the live yaml flag
   per request to allow or downgrade (otherwise "flag cleared + revoke failed" would promote a
   restricted cookie to full). Navigation vs API uses `Sec-Fetch-Mode: navigate` /
   `Sec-Fetch-Dest: document`, **never an `Accept` substring**. A restricted session's self-service
   change still goes through the **P1 change bucket**; being signed in is no exemption.
5. **`GET /auth/password` (merged, no new route)**: a full or restricted session → `200` with the
   plugin's **server-rendered, JavaScript-free change form** (zero external references: CSS inlined,
   no host static or `/plugins` URL, no `<script>`; fields `current`/`password`/`confirm`/`code`;
   `autocomplete="new-password"`; **no `value` pre-filled anywhere**; hidden field `nav=1`;
   `Referrer-Policy: no-referrer`; `cache-control: no-store` + `pragma: no-cache`; the `notice`
   query only accepts the whitelisted value `password-changed`). **Unauthenticated →
   `302 /auth/login?next=/auth/password` (the only semantics)**: the URL must not render the login
   page, and a browser navigation must not get a 401 (either would break the restricted loop).
6. **`POST /auth/password`**: the existing P1 self-service semantics are unchanged (including "the
   `current` password is required"), with two additions: the Origin check and response shaping.
   **Only when the hidden field `nav=1` is present** does success answer
   `302 /auth/login?notice=password-changed`; otherwise the existing `200 {"ok":true}` stands.
   **`allow: GET, POST`** (a contract revision: P1's `405 / allow: POST` becomes this line). `next`
   and `Location` only ever accept a same-site relative path (starts with `/`, not `//`, no
   backslash, no scheme).
7. **`GET /auth/status` (additive extension)**: keeps `no-store`, cookie-only behaviour and the
   token-mode shape; when authenticated it **appends** `name`, `role`, `disabled`, `totpEnabled`
   (bool, **never the secret**), `mustChangePassword` and `sessionKind`
   (`"full" | "password-change-only"`) to the existing `{authenticated, logoutOrder}`. When
   unauthenticated, when the subject is no longer in `users.yaml`, or when that file cannot be
   read, it returns **only the two existing fields, with an equal key set** (never an extra
   `role:null`; existence must not leak, and a broken users file must not turn a status probe into
   a 500).
   **No new `/auth/me`**: `/auth/status` already carries this at the same privilege level.
8. **Origin / `Sec-Fetch-Site` (fail-closed)**: applies only to the two authenticated
   state-changing POSTs (`/auth/users/password`, `/auth/password`). `Sec-Fetch-Site: same-origin`
   passes; or `Origin` **exactly matches** the outward origin resolved by
   `resolvePublicHost(publicHost, req.headers.host)`. A `publicHost` that carries a scheme is used
   as-is; with a bare `host[:port]` the scheme is inferred from whether the incoming connection is
   itself TLS, so a deployment terminating TLS at a reverse proxy should configure `https://host`
   (otherwise scripts taking the `Origin` path are rejected; browsers, which send
   `Sec-Fetch-Site: same-origin`, are unaffected). **When `publicHost` is unconfigured, `Host`
   must never be compared against `Origin` for a pass**: only `Sec-Fetch-Site: same-origin` counts;
   `Origin: null`, a subdomain and same-site-but-not-same-origin → `403`; both signals missing →
   `403`; **no exemption for scripts** (curl must send `Origin` explicitly).
9. **Audit (structured logs only)**: success is `audit.user.password_reset`; denials and failures
   are `audit.user.password_reset.denied`. The `reason` enum keeps semantics apart: `self`,
   `forbidden`, `bad_origin`, `bad_target`, `not_found`, `bad_reauth`, `policy`, `rate_limited`,
   `io`; an unauthenticated 401 uses `unauthenticated` and is de-noised (scanners would flood it).
   Fields: `ts`/`actor`/`target`/`clientIp`/`ok`/`reason`/`reauth`/`sessionsRevoked`/
   `targetDisabled`; **never** the password, the `code` or a hash. No audit file is created and no
   audit row is appended to `users.yaml`.
10. **Rate limiting**: a new dedicated bucket (key = actor subject + clientIp), never shared with
    the login or self-service buckets; a success clears the **target's** login bucket and
    self-service bucket (regardless of `sessionsRevoked`); failures count into this bucket too.
11. **CLI gains `dsh-auth user enable <name>`** (CLI-only, through `mutateUsersFile`): P1 shipped
    only `user disable`, so a disabled account previously required hand-editing the yaml; this
    closes the loop.

## Context

The P1 release (0.15.0) shipped self-service password change, the password policy (D23), the locked
`users.yaml` change path, the `role` enum and the reserved `must_change_password` field. Role grants
stay CLI-only, so the admin plane is deliberately limited to "list users" and "reset someone's
password"; on 2026-09-24 the owner fixed the scope as list, reset, panel block and forced-change gate
(conditional re-authentication only when the acting admin has TOTP enabled), explicitly excluding a
CSRF double-submit token, revoke retry/alerting, atomic lock claiming and any new HTTP
privilege-escalation surface. Constraints: no database; the plugin runs inside someone else's web
application and **must not 302 users into that application's business pages**; the client half is a
single-file CJS bundle; `lib/` must equal a clean build.

Phasing: the first delivery of this record (PR1) is the **server side only** (both endpoints, the
server-rendered change form and the forced-change gate). The Settings-panel admin block is a
follow-up client PR and is **not** shipped with PR1; until it lands, the admin plane is the two HTTP
endpoints plus the CLI (which is also what the README documents).

The genuinely hard part is "force a password change" itself: the plugin cannot enumerate the host
application's surface. Any "full session plus a 302 on every gated path" design has to exhaust host
routes, static assets, WebSockets and `/api`, and one missed path means the gate does not exist. The
restricted session turns that negative into something provable: it is only ever allowed under the
`/auth` prefix, while the host UI is closed at the authorization layer.

The other thread is CSRF depth: an admin reset is a high-value state change that alters **someone
else's** secret, so it needs fail-closed origin checking; but a false positive locks the admin plane,
so the judgment must stay conservative, reading only signals browsers send deliberately
(`Sec-Fetch-Site`) or, when `publicHost` is explicitly configured, an exact origin match, and never
letting request headers certify each other.

## Alternatives Considered

- **Full session plus a "must change" flag enforced by 302 on every gated path** - rejected: one
  missed path (static assets, WebSocket, host APIs) would let the flagged session use the product,
  and the plugin cannot enumerate the host's surface.
- **A new `GET /auth/me` endpoint for the client's identity signal** - rejected: a new route and a
  new authentication surface for data `/auth/status` already returns at the same privilege level
  (the review reversed its earlier position in favour of not adding it).
- **A separate `/auth/password-change` page route** - rejected: one more exact route and one more
  page concept, while `GET /auth/password` can render the same form.
- **Using an `Accept` substring to detect "browser navigation"** - rejected: panel fetch requests
  send varied `Accept` values, producing both false green and wrong 302/401 splits; `Sec-Fetch-Mode`
  / `Sec-Fetch-Dest` replace it.
- **Extending the Origin check to `/auth/login`** - rejected: unauthenticated and lockout-prone; one
  false positive locks every user out (recorded as a residual).
- **Rejecting resets for disabled accounts (409)** - rejected: would block the operational rescue
  case admin reset exists for (disable governs "may they use it", a password governs "what is the
  secret"); the reset is allowed and audited as `targetDisabled:true`.
- **Granting scripts an Origin exemption (no Origin means pass)** - rejected: a cross-site browser
  fetch can set custom headers too, so the exemption would inevitably become the bypass; curl sends
  `Origin` explicitly and the docs pin the example.
- **Accepting `target` from the query as well** - rejected: the query leaks into logs, history and
  Referer, and body/query conflicts have no clean semantics; body only.
- **Extending the API key/metrics surface, writing an audit file or audit rows into `users.yaml`** -
  rejected: a second write surface for a plugin whose write discipline is one locked file.
- **Skipping the `must_change_password` gate and merely telling users to change their password** -
  rejected: after resetting a possibly compromised account nothing forces the user to act, which
  makes the point of an admin reset vanish.

## Why

The restricted session is the only shape in which the gate can prove the negative ("this cookie can
reach nothing but the password form"): all of the plugin's own paths live under `/auth`, which the
gate already whitelists, so the restricted session needs **no** new host-path whitelist and the host
UI simply stays closed; `GET /auth/password` rides the existing path, so the route model grows by the
two admin endpoints only. The reset flow keeps the P1 ordering invariant (credentials first, write
second, revoke third) and adds the two actions the review demanded: the write marks the target for a
forced change (without touching that target's TOTP), and a failed revoke is reported as
`sessionsRevoked:false` instead of being hidden. Field-whitelisted lists and additive status fields
keep secrets out of both directions; authorization re-reads `users.yaml` on every request so the
CLI's `role`/`disable` take effect immediately for a signed-in admin; and structured audit events
carry the actor/target/IP facts without inventing a second durable store.

## Consequences and trade-offs

- **The Origin check does not cover `/auth/login`** (unauthenticated; a false positive would lock
  everyone out): the login path keeps `SameSite=Lax` as its only defence, recorded as a residual.
- **A failed revoke still answers `200`** (with `sessionsRevoked:false`, `logger.error`, the same
  audit field and an explicit UI warning): no retry, no alert (item ⑥ is out of scope). The write
  already succeeded, and reporting a failure would make the caller believe the password did not
  change.
- **CLI `user passwd` does not set `must_change_password`**: the operator channel means "replace the
  secret directly"; the HTTP reset is the "account may have been compromised" path.
- **Resetting an account that is still `disabled` does not let it sign in** (the login path rejects
  disabled users unconditionally); `dsh-auth user enable` must run first, and `user enable` is the
  gap this phase fills.
- **Same-site subdomain CSRF is not closed** (item ⑤, no double-submit token): the Origin check is
  depth, not an equivalent replacement.
- **The zero-byte window in lock claiming is unfixed** (item ⑦, no atomic claim).
- A restricted session can read `/auth/status` (including its own role): required by the design and
  free of other users' data; the target username appears in audit logs (necessary, not sensitive).
- **An admin without TOTP gets a single-factor admin plane**: conditional re-authentication only
  covers an actor who has TOTP enabled, and the gap is carried by auditing plus operator discipline;
  production deployments should enable TOTP for administrators.
