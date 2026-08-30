# Dedicated TOTP slice, capabilities injected from the root assembly

## Decision

The TOTP implementation lives in a new slice `src/features/totp/` (`totp.ts` algorithm /
`replay-guard.ts` replay protection / `cli.ts` commands / barrel), parallel to token, password
and proxy; the password endpoints **do not import** the totp slice (features same-layer
prohibition), and `index.ts` (root assembly) injects `verifyTotp` / `replayCheck` / the clock
into `PasswordLoginDeps` as dependencies.

## Context

The layered convention (D5) forbids features from importing each other, even through barrels.
Yet TOTP two-stage login is naturally an extension of the password flow — the challenge cookie
is issued in `password-login.ts` and the code submission lives in the same endpoint. The
two-stage flow must be woven into the password flow without breaking the same-layer boundary.

## Alternatives Considered

- **Put TOTP in the `shared/` leaf layer** — password reaches TOTP through the shared barrel.
  Rejected: TOTP is an authentication-surface capability, not a stateless utility (shared holds
  next validation / cookie / form-body helpers); future HOTP or other features would bloat shared.
- **password imports `features/totp` directly** — rejected by the machinery (D5's slice:check).
- **Write the whole two-stage inside the password slice** — algorithm, replay guard and CLI all
  inside password: blows the line budgets (P24) and mixes responsibilities.

## Why

A dedicated slice keeps the dependency-graph clarity of "one feature, one plot of land",
guarded automatically by slice:check; dependency injection reuses the M3 injection pattern
(`verify: verifyPassword` is already injected by index.ts) rather than inventing a new
mechanism. The password endpoints only see three function signatures
(verifyTotp/replayCheck/now), which also improves testability — tests inject fakes, decoupled
from the production `verifyTotpCode`.
