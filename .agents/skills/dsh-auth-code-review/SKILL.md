---
name: dsh-auth-code-review
description: Use when reviewing a pull request or change in the dsh-auth repo. Orients the reviewer to this repo's standards (AGENTS.md, development.md, impl-m1.md) and to the checks that matter for a security-gate plugin: enforcement paths, disposal, real-entry-path tests, and fail-closed posture.
---

# Reviewing a dsh-auth change

Guidance, not a checklist. Establish the live diff (verified base and head), read the owning
docs, then review semantically. Prioritize correctness, lifecycle, security, and broken
required behavior over style; one substantiated blocker beats a list of nits.

## Sources of truth

- `AGENTS.md`, `docs/specs/development.md` (gates and conventions), `docs/specs/dsh-auth-plan.md` (threat
  model and design), `docs/implemented/impl-m1.md` (M1 frozen decisions and verified contracts).
- Only harness facts recorded in `docs/implemented/impl-m1.md` §2 are authoritative for the diff. Flag any
  change that depends on harness internals beyond that section — unexplored internals are the
  #1 hallucination source in this repo.

## Blocking requirements

1. **Prose contract coverage.** Public JSDoc documents caller-visible return distinctions,
   throws/rejections, side effects, ownership, timing, cancellation, and durability
   (development.md "Prose"). Flag change narration, control-flow narration, and citations of
   uncommitted drafts as leakage.
2. **Docs match the code.** Config, defaults, error messages, redirect/deny behavior, and wire
   formats update README/development.md/JSDoc in the same diff.
3. **Registrations clean up.** Every wrap, domain open, route, and `ctx.provide` pairs with a
   disposer registered on the owning fiber; disposal tests exist and unwrap restores the exact
   pre-wrap state (guard tables, fallback, register methods).
4. **Real entry path.** Integration tests mount the real cordis/webserver/storage stack
   (`src/integration.*.test.ts`). Hand-mounted fakes cannot catch a silent mount-point failure —
   and silent failure means an unguarded deployment (plan §7).
5. **Enforcement.** Follow every denial path to the operation that enforces it: 302 vs 401
   selection, upgrade rejection before ws negotiation, no-store headers. Exercise alternate
   callers that bypass facades (routes registered after the plugin applies, raw sockets).
6. **Security invariants.** No secrets in logs or snapshots; session tokens 256-bit and stored
   only as sha256 digests; cookie flags exactly `Path=/; HttpOnly; Secure; SameSite=Lax`;
   failure of the auth row must be loud, never silent (fail-closed posture).

## Manual checks

- **Intent and interface contracts:** trace both sides of every changed interface (guard ↔
  gate, index ↔ session-store, `ctx.auth` consumers).
- **Lifecycle and concurrency:** async domain open vs. fiber disposal, races before listen,
  dispose-to-quiescence, no listeners left on denied sockets.
- **Bounds:** token/TTL/cookie edges, oversized inputs, multibyte and encoded paths in `next`.
- **Test strength:** assertions fail on the intended regression and observe external state
  (HTTP status, socket behavior, persisted file), not implementation restatement. Coverage is
  not evidence of correctness.
- **Scope:** each abstraction maps to a current consumer or a frozen M2–M4 roadmap item;
  challenge speculative generality and dependency additions.

## Reporting findings

State defect, location, impact, and evidence. Localized defects inline on the tightest diff
range; cross-cutting concerns at PR level. Separate blockers from suggestions; omit issues
already enforced by a green gate (`npm run verify`). When receiving review, verify each claim
and fix or rebut it on technical grounds.
