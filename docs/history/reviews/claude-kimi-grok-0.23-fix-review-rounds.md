# Claude, Kimi and Grok Review Rounds — the 0.23 review follow-ups

- **Date**: 2026-11-22
- **Reviewers**: Claude Code (`claude-agent-sdk`), Kimi K3.1 Pro (`kimi-coding/k3.1-pro`, via
  `litellm`) and Grok 4.7 (xAI), each a separate read-only agent with no test execution
- **Scope**: branch `fix/0.23-review-followups` against `origin/development`; base `846057c`, fixes
  `049e221`, `5d14698`, `92e0567`, `a6ec5ca`
- **Result**: every round returned request-changes; every blocking finding was fixed; the final
  delta check confirmed the last three P1 closures and the one remaining P0 was a lead edit
  mistake, repaired before the branch was pushed
- **Companion**: [the four-agent review](claude-code-0.23-full-repo-review.md) that produced the
  findings these rounds verify

## What this record is

Evidence of the external review rounds that followed the archived four-agent review. It records each
round's verdict and the resolution of every blocking finding, so a later reader can tell which
claims were checked, by whom, and in which commit. It is not authority: the commits and the code
are.

## Method

For each round the reviewer received the base commit, a diff, and the previous findings, and was
asked for a verdict plus P0/P1/P2 findings with `file:line`. Reviewers read the code statically;
none of them ran the gate suite, a test, a type-check or a build (the lead did). Findings were fixed
in the commits listed below, and the next round was asked to re-check only the delta.

## Round 1 — the three reviewers against `049e221`

| Reviewer | Verdict | Blocking findings |
| --- | --- | --- |
| Claude | request-changes | admission gated on `failures + inflight`, so a lock that expired stayed blocked until the decay window and the documented backoff never ran on the login paths |
| Kimi | request-changes | the same P1, plus: a session issued by a login that straddled the password change survived every sweep because revocation compared `createdAt` |
| Grok | request-changes | the same admission P1; secondary notes on second-wrap ownership and the `<` versus `<=` revocation cutoff |

Non-blocking findings across the three: `password-change` and admin reset still used check-then-record;
`mountRoutes` teardown stopped at the first throwing disposer; verify and publish resolved the ref
independently; unknown 401s still read as "wrong password"; a failed list reload erased the success
message; the CLI warning ignored `revokeSweepMs: 0`; timestamps were not unique per millisecond; the
passkey account bucket was not enforced at admission; `token` collided with a legal username; a
malformed 200 status body collapsed to "signed out"; the limiter evicted active lockouts; the
ceremony store evicted by insertion order; the stale-lock compare-then-rm still raced.

## Resolution 1 — `5d14698`

- The limiter admits on in-flight reservations only; expiry is expressed by `lockUntil`, strikes
  survive expiry, and decay/eviction never touch an active lock.
- Sessions record the credential version observed at sign-in, and the sweep revokes stale versions
  instead of comparing issuance time; `revokeBySubjectBefore` is gone.
- `password-change` and admin reset reserve and settle; admin failures settle outside the audit
  context (a `WeakMap`) so the event shape is unchanged.
- A second `wrapServer` returns a no-op disposer; route teardown releases every route before
  rethrowing the first failure; release verify and publish share one resolved SHA.
- Client: unknown or bodyless 401 is a session-expired view, a failed reload keeps the last good
  list plus a banner, and a malformed 200 status body is a probe failure.

## Round 2 — the three reviewers against `5d14698`

| Reviewer | Verdict | Blocking findings |
| --- | --- | --- |
| Claude | request-changes | the `resolve` job fed a raw commit SHA to `git ls-remote` (the automatic release path would fail); the first-run setup session was issued without the credential version and would be sweep-revoked; the passkey account reservation leaked on the concurrent-counter branch and on a throwing verifier |
| Kimi | request-changes | the passkey reservation leak and the per-failure double count; the same release-resolution failure |
| Grok | request-changes | the same two P1s (release resolve, passkey reservation) |

Non-blocking findings: `combineAdmissions` passed the late username to the primary handle and
double-counted account failures; `admitAccount` settle was not idempotent; up to five probes were
admitted after one lock expired; versions could collide within a millisecond; a future-dated stamp
was ignored rather than compared; the orphan sweep exempted `token`; an empty passkey list hid a
failed refresh; admin success did not clear its scope's IP bucket; several comments still described
the old `createdAt` rule.

## Resolution 2 — `92e0567`

- Release resolution uses `GITHUB_SHA` for the automatic path, peels annotated tags, and accepts
  only an existing tag for a manual re-publish (a dispatch cannot publish an unmerged commit).
- `createAdmin` returns the version it wrote; the setup endpoint hands it to the session issuer, so
  the wizard session survives the first sweep; a wiring-level test covers the hand-off.
- The passkey attempt settles through the combined handle on every exit, including a throwing
  verifier; the account settle is idempotent; the combined handle does not double-count; after a
  lock expires only one probe is admitted.
- Credential versions are strictly monotonic per user; a future stamp is compared like any other;
  the orphan sweep no longer exempts `token`.
- Admin success clears its scope's IP bucket; an empty passkey list still shows the refresh failure.

## Round 3 — Claude against `92e0567`

The three P1s were confirmed closed. One P0 was introduced by the lead's own edit: the
`bootstrap-wiring.ts` feature import had been turned into `import type`, which does not compile, so
the build and `tsc` gates would fail. One P2 remained: a manual dispatch could still name a raw SHA
or a branch.

## Resolution 3 — `a6ec5ca`

The value import is restored; the manual re-publish path accepts a tag only; the wizard session
version gained its wiring-level test. `npm run verify` runs green at this commit.

## Final state

- `npm run verify` at `a6ec5ca`: exit 0, 22 gates and 12 gate self-tests, including the full vitest
  suite, both TypeScript projects, the build, and the committed-`lib/` parity check.
- Deferred by decision: the `zh-prose` baseline ratchet (S1); the ceremony-store eviction order and
  IPv6 /64 keying (the L10 edges); the stale-lock compare-then-rm window; the TOTP challenge cookie
  does not carry the credential version; legacy users named `bootstrap` or `token` remain
  maintainable.
- The three reviewers were read-only and ran nothing; concurrency, CI/OIDC execution and live host
  socket behaviour are reasoned about, not observed.
