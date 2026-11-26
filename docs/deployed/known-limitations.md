# Known limitations, and the mechanisms behind them

English | [中文](known-limitations_zh.md)

The README keeps the short list. This page is the full one: every known limitation of the
plugin, with the mechanism behind it and the decision record that fixed it.

- **No isolation between signed-in users.** On a host with route authentication, a
  request to a host `required` route that carries a valid **full** session is admitted
  with one shared `{ principal: { kind: "owner" } }` peer
  (`src/host-auth-wiring.ts`); the peer is replaced if the host aborts it, and the
  replacement is still owner. Bootstrap and `password-change-only` sessions get no
  peer, and the plugin's own `/auth/*` routes are `anonymous` rather than admitted
  through it. In password mode, `PasswordGate.decide()` allows any non-bootstrap,
  non-restricted session without reading `users.yaml`
  (`src/host/features/password/model/password-gate.ts`). So the plugin hands every
  complete session the same owner principal and adds no per-user separation of its own;
  what the host then serves an owner peer is host behaviour. `subject` is used for
  audit, revocation and to load the caller's own record, never to give two users
  different principals. `role: "admin"` is not a data-isolation boundary: its
  server-side checks are the user-management endpoints and the passkey settings
  endpoints. See
  [the no-isolation note](../../.agents/notes/implemented/architecture/2026-11-15-no-user-isolation.md).
- Disabling a user stops **new** logins, and the plugin's periodic sweep revokes the
  sessions already issued within `revokeSweepMs` (default 5 s); with `0` they stay valid
  until they expire.
- **A CLI password change evicts sessions with a delay.** `dsh-auth user passwd` runs as a
  separate process with no session-store access: it records `password_changed_at` and the
  plugin's session sweeper revokes that user's earlier sessions within `revokeSweepMs`
  (default 5 s), or on the next plugin restart. The web surfaces (Settings self-service
  change, an administrator's reset) revoke immediately.
- **Passkey deployment prerequisites**: the RP ID is derived from `publicHost` and must be a domain (no IP,
  no port), and browsers only expose WebAuthn over HTTPS (or `http://localhost`). Plain-http intranet
  addresses, a direct `http://127.0.0.1:3080`, and the `dsh-auth-proxy` local proxy (`http://127.0.0.1:8443`)
  therefore cannot use passkeys; an unusable configuration logs an error and behaves as `passkey: "off"`
  without affecting password sign-in.
- **A passkey is not device-bound**: iCloud Keychain, Google Password Manager, 1Password and friends sync the
  private key to the cloud (`BE=1`), so a compromised cloud account plus local unlock is enough; it is not
  equivalent to a hardware security key. Following GitHub's model, a synced passkey still counts as satisfying
  2FA; environments that need an independent second factor set `passkey: "off"`.
- **Passkey counters are best-effort detection**: `signCount` lives in process memory by default and is not
  written on every sign-in, so it falls back to the `users.yaml` snapshot after a restart; synced passkeys stay
  at 0 and concurrent use of one credential also produces regressions. `passkeyEnforceCounter: true` rejects
  only for device-bound credentials (`be=false && bs=false`) and is not a clone-protection guarantee.
- **The passkey ceremony is single-process state**: the begin challenge lives in an in-process map (120 s TTL,
  1024-entry cap), so a restart or plugin reload drops in-flight ceremonies (the user retries once).
  Multi-replica deployments need sticky sessions or shared storage and are unsupported in v1.
- **Passkey begin has its own quota**: 20 per IP per minute and 120 globally per minute (in-process sliding
  window, reset on restart). It is an availability guard against anonymous callers evicting other users'
  ceremonies, not an authentication boundary.
- **Passkeys do not validate attestation**: `attestation: "none"` means no certificate chain and no MDS
  allow-list, so the deployment cannot tell which vendor made a credential or whether an authenticator model
  was tampered with. Attestation policy is out of scope for v1.
- **Passkeys have no recovery codes**: if every device is lost, sign in with the password and enrol again; if
  the password is also forgotten, an administrator must run `dsh-auth user passwd`.
- **Passkey-only (`passkey: "required"`) is instance-level and has no in-app escape hatch**: the policy lives in
  the config file, so turning it on or off is a file edit plus a restart, performed by whoever holds server
  access. There is no per-account variant, because this gate protects the whole instance and does not isolate
  users from each other. Consequences worth knowing before enabling it:
  - **Enrol and verify a passkey first.** Turning it on with no usable credential locks everyone out. The
    plugin logs an error at startup when it can see the problem, but it cannot know whether a credential still
    works on the user's device.
  - **A broken WebAuthn configuration does not restore password sign-in.** If `publicHost`, the RP ID or the
    origins become unusable, the instance stays closed and the login page shows the fixed reason
    (`public-host-missing`, `rp-id-invalid`, `origin-invalid`, …). Fix the configuration, or set `passkey` back
    to `"optional"` and restart.
  - **Removing the last credential is refused** over HTTP (`400` with `reason: "last-credential"`) and by the
    CLI unless `--force` is passed. The CLI cannot read the plugin configuration, so it asks for `--force`
    unconditionally rather than guessing.
  - **An administrator resetting a password does not restore access.** The reset still sets
    `must_change_password`, but that restricted session can only be reached by signing in, which the policy
    blocks. Recovery is the config edit above, not the admin panel.
  - **Existing sessions keep working.** The policy blocks new sessions only, exactly like disabling a user; a
    session issued before the switch stays valid until it expires.
  - **The password hash is kept** and still authenticates credential changes (enrolment, self-service password
    change, admin reset). It just cannot create a session.
- **Enrolment and removal require re-authentication**: enrolment needs the current password (plus a TOTP code
  when enabled); removing the last credential or using `--all` does too. A normal single removal only needs a
  full session plus the same-origin check.
- **Conditional UI (autofill) is off by default**: when enabled, the login page offers passkeys in the password
  field's autofill list; it needs Chrome 108 / Firefox 119 / Safari 16+, and unsupported browsers or a
  cancelled prompt fall back silently to the button and the password form. The switch is the one passkey
  field declared `.volatile()`, so an administrator can flip it in Settings > Account security and the host
  settings service writes it back to the profile patch. `passkey` itself is deployment-level and is
  deliberately not volatile: it needs `publicHost` and HTTPS to be usable, so it stays config-file only.
- **iOS third-party browsers may not work**: most are WKWebView builds without the WebAuthn experimental
  feature; the login page feature-detects and shows only the password form when unavailable.
- Login rate limiting resets when the server restarts; so does the TOTP
  replay guard (a used code in the same 30s window becomes acceptable again
  after a restart — restart and code-stealing in the same window are both
  needed to exploit this).
- A TOTP challenge (the "password ok, code pending" state) lasts at most 5
  minutes. The challenge cookie is **HMAC-signed with a process-generated key**
  (ADR D10): it cannot be forged to skip the password stage. Restarting the
  server (or reloading the plugin) invalidates in-flight challenges — users on
  the code page must re-enter their password (window ≤ 5 minutes). The code is
  validated against the user's configured secret at submit time.
- Rate limiting counts by the real client address. Behind a reverse proxy on the
  same host every request arrives from the proxy's address, so all clients would
  share one lockout bucket (five mistyped passwords from anywhere then block
  everyone: issue #74). Set `clientIpHeader` to the header your proxy writes
  (`x-forwarded-for`, or `cf-connecting-ip` behind Cloudflare); it is only read
  when the peer is inside `trustedProxyCidrs` (loopback by default), and the
  rightmost address that is not itself a trusted hop is used. The self-service
  password change (D22) keys its own, separate bucket the same way, so it needs
  the same `clientIpHeader` setup: without a trusted proxy client-IP header,
  every client on that host also shares one password-change bucket (the same
  root cause as the login case, D19).
- Sign out from the GUI: a prominent "Sign out / 退出登录" button sits in the
  Settings panel (Settings → General, bottom) — client half, requires the
  web app's client bundle (dsh 0.1.0-rc.6+); the direct
  `/auth/logout?next=/` URL always works as a fallback.
- Changing a password revokes the user's sessions only **after** the new hash is on
  disk. If that revocation step fails, the change still reports success (the password
  is already in force) and the failure is logged as an error; the old cookie then
  stays valid until the session TTL expires. D25 (the admin-surface phase) keeps this
  shape: an admin reset that cannot revoke answers `200` with `sessionsRevoked:false`,
  and retrying or alerting on the failure is still not implemented.
- The `Origin` check that guards the two authenticated state-changing POSTs
  (`/auth/password` and `/auth/users/password`, D25) does **not** cover
  `POST /auth/login`: the unauthenticated login path keeps `SameSite=Lax` as its only
  cross-site defence, because a false positive there would lock every user out.
- A user forced to change their password (`must_change_password`, D25) gets a
  restricted session that lasts 15 minutes and is never renewed; it can reach only
  `GET`/`POST /auth/password`, `GET /auth/status` and `POST /auth/logout`. Resetting a
  still-disabled account does not let it sign in: run `dsh-auth user enable <name>`
  first.
- The admin reset re-reads the **actor** inside the users lock (a demoted or
  disabled actor gets `403` and no write), but the target-side decisions (the
  "new password differs from the old one" policy above all) are made from a read
  taken before the lock. Two concurrent admin writes can therefore slip a stale
  policy verdict: the second write still stores its new hash and the
  `must_change_password` marker. Both actors are already administrators, so the
  worst case is an admin forcing a redundant password, not a privilege change.
- A denied `/auth/users/password` request that carries **no** session is audited
  at `info` level with the target stripped of control characters and clipped to
  64 characters. An anonymous scan therefore writes one log line per request:
  that line is the only signal the Origin check produces, so it is kept rather
  than dropped, and the payload is bounded instead. Add audit-log dedup or
  retention if that volume matters.
- The admin block lives in the **client half** (Settings → Account security): it needs the host web
  app's client bundle and only appears after the page is reloaded once that bundle is in place. The
  CLI and the HTTP endpoints stay available without it.
- A non-admin, or a restricted session, never sees the admin block, but that is presentation only:
  the server authorizes every admin request by re-reading `role` and `disabled` from `users.yaml`,
  so a direct `GET /auth/users` with a non-admin cookie still answers `403`.
- The panel's user list deliberately omits whether a target currently has live sessions (the
  server's projection is field-minimal), so a successful reset reports whether the revocation
  succeeded (`sessionsRevoked`), not whether that user was signed in anywhere.
- The admin plane cannot reset **your own** password (the server answers `403 forbidden` as a
  backstop and the panel's dropdown excludes you): use the self-service form above the block, and an
  administrator who has forgotten their own password can only reset it offline with
  `dsh-auth user passwd <name>`.
- The panel's reset neither displays nor changes the target's TOTP state: the list projection omits
  it by design (only a `totpEnabled` badge is shown) and a reset never rotates `totpSecret`, so a
  user who lost their authenticator still has to be handled with
  `dsh-auth user totp disable <name>`.
- The post-reset list refresh **fails silently**. After a successful reset the client re-fetches
  `/auth/users` to refresh the `must-change` badges; if that second request fails, the rows keep
  their previous values and the operator has to reload the page. Only the first load degrades
  visibly (`admin.unavailable`).
- Audit events go through the structured logger, and dsh 0.1.5-rc.2 does **not** persist
  `ctx.logger` info/error output to disk, so on that version verification rests on observable
  runtime behaviour plus the in-process full-stack audit tests in this repository (32 cases across
  the two audit unit suites and the three P2 integration suites). That is a logging-visibility
  limitation, not a missing audit trail.
- The first-run wizard (`/auth/setup`, reached from the launch URL through
  `/auth/bootstrap`) exists only while the instance is **unconfigured**: token mode counts
  as unconfigured only when the credential read succeeds and comes back empty, password
  mode when `users.yaml` is missing or holds zero users. A non-empty token, a single user,
  a missing credentials service, a throwing `resolve` or an unreadable file all count as
  "not unconfigured" and keep today's denial. The probe runs on every request, and the
  process also sets a `markedConfigured` flag once the wizard writes, so the window closes
  immediately.
- A bootstrap session lasts at most `min(sessionTtl, 3600)` seconds (one hour with the
  defaults), carries `subject = "bootstrap"`, and reaches `/auth/*` only: any other
  navigation answers `302 /auth/setup`, an API call answers `401` and a WebSocket upgrade
  is refused. Completing the wizard revokes every bootstrap session before it issues the
  full one, so that ticket cannot be replayed.
- The channel assumes a single dsh process. The launch token is minted per process start,
  so behind several replicas without sticky routing `/auth/bootstrap` can land on a
  process that does not know that token; it fails closed to the login page.
- A credentials service that caches resolved values may keep returning the old (empty)
  token after the wizard saves a new one. The result page says a restart is needed, and
  the new token becomes the only credential after dsh restarts; the window itself still
  closes right away.
- dsh versions without `connection.authenticatedUrl` (older than 0.1.2-alpha) expose no
  launch token, so there is no wizard at all: those instances keep the 0.17.4 behavior
  and are configured through the CLI.
- **The host-cookie rebridge is a repair, not a guarantee.** dsh keeps its own browser
  cookie (`dsh-auth-<sha256(authority)>`, `SameSite=Strict`, 30 days) beside the plugin's
  `dsh_auth`, and the gate never inspects it. After admitting a top-level navigation to
  `/`, the guard asks dsh's `connection.requestRejection` and answers `302 /?token=…` when
  dsh does not accept the request. That covers a proxy that starts or stops rewriting
  `Host`, a domain or port change, an expired dsh cookie and cleared site data. It does
  not cover a dsh build without `requestRejection` (the hook stays inactive and the old
  behavior returns), a launch token that no longer matches the running process (several
  replicas without sticky routing), or a browser that refuses the minted cookie. In those
  cases the user still sees dsh's own `401 dsh web authentication required`; the one-shot
  marker cookie guarantees that costs at most one extra hop instead of a redirect loop.
  Only top-level `GET` navigations to `/` are rebridged: API calls, static assets,
  WebSocket upgrades and requests already carrying `?token=` (the host's own cookie-minting
  hop) are left alone, because a redirect cannot fix them.
- The plugin only protects dsh's web surface. It is not a replacement for
  server-level security: keep the server OS user locked down and the config
  files private (`.credentials.yaml` and `auth/users.yaml` are created with
  `0600` permissions).

## On host `0.2.3-alpha.2` and later

That host line moved authentication to the route table (a route without `auth`
requires a session) and reads the launch token only inside its own token plugin.
Consequences for this gateway:

- **The launch-token bridge and the host-cookie rebridge are inactive.** Both were
  built on `connection.authenticatedUrl` and `connection.requestRejection`, which
  that line removed. Sign-in therefore lands on `/` directly instead of the
  `/?token=…` hop, and the host's own 30-day cookie is no longer minted by the
  gateway. The signed-in user is admitted because the plugin registers a
  `connection.authentication` provider for complete sessions, so nothing is lost
  at the browser; a deployment that relied on the rebridge to repair a stale host
  cookie no longer needs it on this line.
- **The first-run wizard cannot verify the launch token.** The token is not
  readable through any public seam, so `/auth/bootstrap?token=…` refuses. Create
  the first user with `dsh-auth user add <name> --password-stdin` (password mode)
  or set `DSH_AUTH_TOKEN` (token mode), then sign in normally. The launch URL
  printed by `dsh web` still works, but it only mints the host's own cookie.
- **A raw shared-token `Authorization: Bearer <token>` is not admitted on host
  routes.** The host decides those before the wrapped handler runs, and the
  provider answers only for session cookies and session Bearer tokens (the shared
  token is not a session, and resolving it is asynchronous). Scripts should sign
  in once through `POST /auth/login` and reuse the session cookie; a request that
  carries `Authorization` is never downgraded to anonymous, so it fails closed.
- Route-level `auth` declarations the plugin registers on `/auth/*` are
  `anonymous` on purpose: the login, wizard and password pages must be reachable
  without a host session, and the plugin's own gate still decides every one of
  them.
- **The host's own Host/Origin fence now runs in front of every route, the login
  page included.** It accepts the authorities listed in the host's
  `trustedHosts` (`--trusted-host` for `dsh web`), and a reverse proxy that
  rewrites `Host` or terminates a different domain gets `403` before either the
  gate or the login form runs. That fence is the host's, not this plugin's:
  configure `--trusted-host` (and the proxy's `header_up Host`) as the site's
  domain, and note that `trustedProxyCidrs` here only feeds the rate limiter.
- **Only the fallback seat is downgraded to `anonymous`.** A host route this
  plugin does not own that is declared (or defaults to) `required` answers `401`
  before the gate, so a browser navigation there sees the host's message rather
  than this plugin's login redirect.
