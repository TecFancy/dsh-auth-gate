# Security invariants

[中文](security_zh.md)

The rules this plugin must never break. Each one is a negative guarantee: it says
what must not happen, because the failure is silent and the damage is not
recoverable. Code and tests enforce them; this page is where a reader finds out
which ones exist and why.

Read this before changing the guard, the gate, session handling, the login page,
or anything that decides whether a request is admitted.

## 1. The gate fails closed

When credentials cannot be confirmed, the answer is **deny**, never allow.

- A missing credentials service yields a permanent deny, not a skipped guard.
- A failed token or credential resolution is treated as "no credential".
- The guard stays mounted regardless of whether the services it needs are ready.
- Failures are loud in the logs and silent in the response: the caller learns
  nothing about why.

The asymmetry is the reason. A false lock can be fixed by an operator; a false
unlock cannot be recalled.

Rationale: [the fail-closed note](../.agents/notes/implemented/architecture/2026-08-30-fail-closed-auth-gate.md).

## 2. The guard wraps the host, it does not fork it

The plugin wraps `webServer`'s four entry kinds (exact routes, prefix routes,
upgrade routes, the fallback handler) and self-checks at startup. It never
patches the dsh web host.

- Wrapping is idempotent: a second wrap returns the first unwrap.
- Unwrap rolls back per entry, never by restoring a whole-table snapshot over
  routes other plugins own.
- The startup self-check turns "the gate silently did not mount" into "the
  process fails loudly at boot".

Rationale: [the wrap-seam note](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.md),
[the per-entry unwrap note](../.agents/notes/implemented/architecture/2026-10-11-guard-unwrap-per-entry.md).

## 3. Every entry is guarded, including the ones added later

The guard covers routes registered before it and routes registered after it.
A route registered through the wrapped `register` is guarded even if the plugin
that registers it applies later.

The `/auth/*` paths are the one deliberate exception: the gate always allows
them, because they are how a caller authenticates in the first place.

Rationale: [the wrap-seam note](../.agents/notes/implemented/architecture/2026-08-30-guard-wrap-seam.md).

## 4. Cross-site top-level navigation gets a same-origin bounce

A cross-site top-level navigation that the gate **allows** is answered with a
same-origin bounce page, after the gate allows and before the post-admit
rebridge (§9). Without it, dsh's `SameSite=Strict` session cookie is not sent on
the first navigation and the user is denied a page they are entitled to.

The bounce is not an authentication bypass: it re-enters the same gate from a
same-origin context, and a denied request never reaches it.

The trade-off is deliberate: for top-level `GET` document navigations the bounce
lowers dsh's inner `SameSite=Strict` cookie to `SameSite=Lax` strength, because a
cross-site link now reaches dsh with both cookies after one extra same-origin
hop. The outer `dsh_auth` cookie already arrives on exactly these requests, and
dsh's state-changing surface is not reachable through a top-level `GET`.
Non-`GET` methods, iframes and subresource requests keep the full `Strict`
behaviour.

Rationale: [the bounce note](../.agents/notes/implemented/architecture/2026-10-13-cross-site-navigation-bounce.md).

## 5. Client identity for rate limiting comes from a trusted proxy header only

`clientIpHeader` is honoured only when the request arrives from a
`trustedProxyCidrs` address. An untrusted peer cannot choose its own identity by
setting a header.

The default trust list is loopback. A deployment behind a reverse proxy must set
both options together; setting only `clientIpHeader` leaves the limiter keyed on
an attacker-controlled value.

Rationale: [the trusted-proxy note](../.agents/notes/implemented/architecture/2026-09-22-trusted-proxy-client-ip.md).

## 6. Sessions are revoked, not expired, on a credential change

A password change through the web surface (self-service or an administrator's
reset) revokes every session for that user, including the one that performed the
change; those paths also record `password_changed_at` as a restart backstop.

`dsh-auth user passwd` runs as a separate process with no session-store access:
it records the same timestamp, and the plugin's session sweeper revokes every
session created before it on the next pass — at most `revokeSweepMs` (default
5 s) later, and also after a plugin restart. A disabled user's sessions stop
working within the same sweep interval. A user deleted from `users.yaml` loses
every session on that same sweep (bootstrap sessions and the internal `token`
subject are exempt), and `dsh-auth user add` enforces the same password policy as
the web write paths, so the CLI cannot create a weak initial password.

Rationale: [the self-service change note](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.md),
[the password policy note](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.md).

## 7. A passkey is a complete sign-in, and passkey-only closes the password path

A passkey sign-in satisfies both the password factor and the TOTP policy;
`totp` constrains password sign-in only. Enrolling a credential, and removing the
last one, require the current password (plus a TOTP code when the account has a
secret), so a hijacked session cannot add or drop a backdoor credential.

`passkey: "required"` closes the password path for the whole instance: both the
password branch and the TOTP-challenge branch are refused before `users.yaml` is
read, so a challenge cookie obtained before the switch cannot be traded for a
session afterwards. A WebAuthn configuration that cannot be used does **not**
reopen password sign-in; the instance stays closed and the login page shows the
fixed reason. The policy is instance-level, matches this gate's model (users are
not isolated from each other), and has exactly one recovery path: set `passkey`
back to `"optional"` in the config file and restart.

Rationale: [the passkey note](../.agents/notes/implemented/feature/2026-11-11-passkey-login.md),
[the passkey-only note](../.agents/notes/implemented/feature/2026-11-16-passkey-only-login.md).

## 8. The launch token opens a first-run window, not a second key

dsh's launch token (the `?token=` dsh prints at startup) is trusted only while
the instance is unconfigured. Once a token or a user exists, `GET /?token=...`
goes to `/auth/bootstrap?token=...`, and that endpoint answers
`302 /auth/login?next=%2F` without setting a cookie or admitting anything, so an
old launch URL is not a permanent credential.

The bootstrap session it can mint is fenced: it lasts at most
`min(sessionTtl, 3600)` seconds, reaches `/auth/*` only, and is revoked when the
wizard at `/auth/setup` completes. Only a successful read that returns nothing counts as
unconfigured; a missing credentials service or a throwing read is treated as
configured and opens no wizard, so a disk fault cannot open the door. After a
successful sign-in the launch-token bridge only turns the normal redirect into a
relative `/?token=` hop so dsh mints its own browser cookie; the bridge
authenticates nothing by itself, and its failure falls back to the plain
redirect.

Rationale: [the bootstrap note](../.agents/notes/implemented/feature/2026-10-26-first-run-launch-bootstrap.md).

## 9. After allowing, the guard rebridges the host cookie at most once

dsh has a second browser cookie (`dsh-auth-<sha256(authority)>`, `SameSite=Strict`)
that this gate never inspects, so an admitted request can still meet dsh's own
`401 dsh web authentication required`. For a top-level `GET` document navigation
to `/` that does not already carry a token query, the guard asks dsh once through
`connection.requestRejection`: only a `401` triggers a `302` to the relative
`/?token=<launchToken>` with a one-shot marker cookie. While the marker is
present no further rebridge happens, so a rebridge that cannot succeed leaves
dsh's `401` in place instead of looping. A `403` is not rebridged, and WebSocket
upgrades are never rebridged.

Rationale: [the rebridge note](../.agents/notes/implemented/bug-fix/2026-11-16-host-cookie-rebridge.md).

## 10. The TOTP challenge cookie is signed

The two-stage TOTP login carries its state in a stateless cookie, and that
cookie is HMAC-signed. An unsigned challenge cookie would let a caller forge the
"password already verified" state.

Rationale: [the signed-challenge note](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.md).

## 11. Passwords are hashed with parameters stored beside the hash

`node:crypto` scrypt, with the parameters recorded in the stored value and
verification re-deriving from those stored parameters. Raising the cost is a
rolling change, not a mass invalidation. Comparison is constant-time.

Rationale: [the scrypt note](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.md).

## 12. The real deployment domain never enters the repository

Docs, deploy samples, tests, code defaults and screenshots use the RFC 2606
reserved `example.com`. The published tarball ships `lib/`, `docs/demo/` and
`.agents/skills/`, so anything written into those leaves the machine.

Rationale: [the example-domain note](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.md).

## 13. The published artifact is exactly the build output

`lib/` is committed and CI fails when a fresh build differs from it
(`git diff --exit-code -- lib`). A consumer installing from git gets a working
package without build tooling, and nobody can hand-edit the shipped code.

## 14. An in-process read carrying a Peer is admitted by its caller

`webServer.readResource(request, peer)` is how one part of the host reads what an
HTTP request for the same URL would receive. The caller has already admitted the
reader, and the `peer` is that admission. The guard must not re-authenticate such
a read: it carries no cookie, so a browser gate can only refuse it with `401`,
and the reader's authority is the `Peer`, not a session. The bypass gives an
in-process caller nothing it did not have - it already runs inside the host
process. LiveShare serves the owner's viewer page through the gate on this path.

Rationale: [the peer-read note](../.agents/notes/implemented/bug-fix/2026-11-19-peer-reads-admitted-by-caller.md).

## 15. What is deliberately not defended

These are known and accepted, not oversights. Each has a note explaining the
trade-off:

- **No login CSRF token.** The single-gate model has no inter-user isolation, so
  the only impact is a polluted session-subject audit value. `SameSite=Lax` plus
  modern third-party `Set-Cookie` restrictions narrow it further.
- **No rate-limit persistence.** A restart clears the buckets.
- **No `revokeBySubject`.** Sessions are revoked per user, not per subject.

Rationale: [the M3 leftovers note](../.agents/notes/implemented/simplification/2026-08-30-totp-disposition-of-m3-leftovers.md).

## Where the enforcement lives

| Invariant | Enforced by |
| --- | --- |
| Fail closed | `src/host/shared/guard/`, `src/host/features/token/model/`, `src/host/features/password/model/` |
| Wrap, not fork | `src/host/shared/guard/guard.ts`, `self-check.ts` |
| Every entry guarded | `src/host/shared/guard/guard.ts`, `test/integration.*.test.ts` |
| Caller-admitted peer reads | `src/host/shared/guard/resource.ts` |
| Cross-site bounce | `src/host/shared/guard/cross-site-bounce.ts` |
| Passkey policy | `src/passkey-wiring.ts`, `src/host/features/passkey/`, `src/host/features/password/model/password-login.ts` |
| Launch token and bootstrap | `src/host/features/bootstrap/`, `src/launch-token-bridge.ts`, `src/bootstrap-wiring.ts` |
| Post-admit rebridge | `src/host/shared/guard/rebridge.ts`, `src/rebridge-wiring.ts` |
| Trusted proxy | `src/host/shared/http/client-ip.ts` |
| Session revocation | `src/host/entities/session/`, `src/host/features/password/model/` |
| Signed challenge cookie | `src/host/features/password/model/challenge-cookie.ts` |
| scrypt | `src/host/features/password/lib/password.ts` |
| Example domain | `npm run lint:no-emdash` is unrelated; the rule is review-enforced plus `docs:check` |
| Build parity | `.github/workflows/ci.yml` |

The real-entry-path coverage evidence for a given release lives under
`docs/history/evidence/entry-coverage-*.md`.
