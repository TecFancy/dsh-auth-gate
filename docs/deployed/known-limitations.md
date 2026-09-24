# Known limitations, and the mechanisms behind them

The README keeps the short list. This page is the full one: every known limitation of the
plugin, with the mechanism behind it and the decision record that fixed it.

- Disabling a user only stops **new** logins; already-signed-in sessions stay
  valid until they expire.
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
- The plugin only protects dsh's web surface. It is not a replacement for
  server-level security: keep the server OS user locked down and the config
  files private (`.credentials.yaml` and `auth/users.yaml` are created with
  `0600` permissions).
