# Known limitations, and the mechanisms behind them

The README keeps the short list. This page is the full one: every known limitation of the
plugin, with the mechanism behind it and the decision record that fixed it.

- Disabling a user only stops **new** logins; already-signed-in sessions stay
  valid until they expire.
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
  the password is also forgotten, an administrator must run `dsh-auth user passwd`. v1 has no passkey-only
  (password-disabled) mode.
- **Enrolment and removal require re-authentication**: enrolment needs the current password (plus a TOTP code
  when enabled); removing the last credential or using `--all` does too. A normal single removal only needs a
  full session plus the same-origin check.
- **Conditional UI (autofill) is off by default**: when enabled, the login page offers passkeys in the password
  field's autofill list; it needs Chrome 108 / Firefox 119 / Safari 16+, and unsupported browsers or a
  cancelled prompt fall back silently to the button and the password form.
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
- The admin reset bucket checks the lock state and records a failure in two
  separate steps, so a burst of concurrent in-flight attempts can exceed the
  failure threshold before the first failure is counted. Exploiting it needs an
  already-signed-in admin (the attacker the bucket protects against is the one
  holding the session), and the bucket key still follows the client-IP rule
  above.
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
- The plugin only protects dsh's web surface. It is not a replacement for
  server-level security: keep the server OS user locked down and the config
  files private (`.credentials.yaml` and `auth/users.yaml` are created with
  `0600` permissions).
