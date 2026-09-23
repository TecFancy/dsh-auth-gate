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
  stays valid until the session TTL expires. Retrying or alerting on a failed
  revocation is deferred to the admin-surface phase.
- The plugin only protects dsh's web surface. It is not a replacement for
  server-level security: keep the server OS user locked down and the config
  files private (`.credentials.yaml` and `auth/users.yaml` are created with
  `0600` permissions).
