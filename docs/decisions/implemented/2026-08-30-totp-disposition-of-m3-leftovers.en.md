# M3 leftover evaluations: keep not implementing

## Decision

M4 re-evaluated the three TODO items left by M3; all are **kept not implemented** (each carries
a `TODO(auth-m5):` marker): (a) `revokeBySubject` (instant revocation of issued sessions for
disabled users); (b) a login CSRF token; (c) persisting rate-limit and replay-guard state.

## Context

M3 froze "disabled users only block new logins; issued sessions stay valid within their TTL" and
"no login CSRF token" (P15/P21), with a re-evaluation note for M4. With the TOTP two-stage
added, M4 must confirm the new challenge path does not change those conclusions and give each
item a final disposition instead of leaving it pending indefinitely.

## Alternatives Considered

- **(a) Read the users file inside the gate path to check disabled state per request** —
  instant revocation requires file IO on every request, contradicting the frozen gate semantics
  (P12: zero file IO, zero KDF per decision); caching would introduce consistency problems.
  Status quo stands: in the single-gate model the blast radius of "disable only blocks new
  logins" is clearly bounded and the limitation is documented in the README.
- **(b) Add a CSRF token for login/challenge** — TOTP does not change the P21 analysis: the
  single-gate model has no inter-user isolation, so a login CSRF's only effect is a potentially
  polluted audit subject, with no permission-boundary loss; a CSRF challenge submission would
  need the attacker to know the victim's current code, which is the whole point of the code
  being a secret. `SameSite=Lax` plus modern-browser third-party Set-Cookie restrictions keep
  narrowing the residual risk.
- **(c) Persist rate-limit/replay state to disk** — for low-frequency logins the restart-reset
  window is negligible (an attacker would also need to restart to reset; the reset cost applies
  to both sides); persistence adds IO and race complexity.

## Why

All three items show diminishing returns in the "do vs. don't" comparison: meaningful
implementation cost, marginal benefit under the single-gate model, and each has a documented
status quo and limitation. The TOTP two-stage changes none of their premises. "Evaluated and
explicitly declined" is itself the closure M3's contract asked for — pending items become frozen
decisions, and any of them can be revisited later if the model changes.
