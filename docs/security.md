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

A cross-site top-level navigation is answered with a same-origin bounce page
before the gate decides. Without it, a `SameSite=Strict` session cookie is not
sent on the first navigation and the user is denied a page they are entitled to.

The bounce is not an authentication bypass: it re-enters the same gate from a
same-origin context.

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

A password change revokes every session for that user, including the one that
performed the change. A disabled user's sessions stop working immediately.

Rationale: [the self-service change note](../.agents/notes/implemented/feature/2026-09-23-self-service-password-change.md),
[the password policy note](../.agents/notes/implemented/architecture/2026-09-23-password-policy-and-users-lock.md).

## 7. The TOTP challenge cookie is signed

The two-stage TOTP login carries its state in a stateless cookie, and that
cookie is HMAC-signed. An unsigned challenge cookie would let a caller forge the
"password already verified" state.

Rationale: [the signed-challenge note](../.agents/notes/implemented/architecture/2026-08-30-totp-signed-challenge-cookie.md).

## 8. Passwords are hashed with parameters stored beside the hash

`node:crypto` scrypt, with the parameters recorded in the stored value and
verification re-deriving from those stored parameters. Raising the cost is a
rolling change, not a mass invalidation. Comparison is constant-time.

Rationale: [the scrypt note](../.agents/notes/implemented/architecture/2026-08-30-scrypt-portable-params.md).

## 9. The real deployment domain never enters the repository

Docs, deploy samples, tests, code defaults and screenshots use the RFC 2606
reserved `example.com`. The published tarball ships `lib/`, `docs/demo/` and
`.agents/skills/`, so anything written into those leaves the machine.

Rationale: [the example-domain note](../.agents/notes/implemented/process/2026-09-22-example-domain-in-examples.md).

## 10. The published artifact is exactly the build output

`lib/` is committed and CI fails when a fresh build differs from it
(`git diff --exit-code -- lib`). A consumer installing from git gets a working
package without build tooling, and nobody can hand-edit the shipped code.

## 11. What is deliberately not defended

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
| Cross-site bounce | `src/host/shared/guard/cross-site-bounce.ts` |
| Trusted proxy | `src/host/shared/http/client-ip.ts` |
| Session revocation | `src/host/entities/session/`, `src/host/features/password/model/` |
| Signed challenge cookie | `src/host/features/password/model/challenge-cookie.ts` |
| scrypt | `src/host/features/password/lib/password.ts` |
| Example domain | `npm run lint:no-emdash` is unrelated; the rule is review-enforced plus `docs:check` |
| Build parity | `.github/workflows/ci.yml` |

The real-entry-path coverage evidence for a given release lives under
`docs/history/evidence/entry-coverage-*.md`.
