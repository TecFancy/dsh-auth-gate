# Kimi K3.1 Pro Review — passkey (WebAuthn) sign-in feasibility plan

- **Date**: 2026-11-11
- **Reviewer**: Kimi K3.1 Pro (Kimi Code API, `k3.1-pro`, reasoning effort low, ~42k-character prompt; not via a DSH
  subagent route, see the last section)
- **Scope**: `docs/plans/passkey-login-plan(_zh).md` and D35 `docs/decisions/proposed/2026-11-11-passkey-login(_zh).md`
  (worktree `feat/passkey-login`, uncommitted)
- **Verdict**: **request-changes (on the spec, not on code)** — the direction is sound, but three things must change
  before implementation starts: the TOTP downgrade, the enrolment transaction, and the BE consistency check at sign-in
- **Standards**: repo `AGENTS.md`, the threat model in `docs/specs/dsh-auth-plan.md`, WebAuthn L3 / RFC 8152

## Summary

Feasible. Dropping passkey-only, attestation and conditional UI from v1 is correct. Two items must be fixed before
coding starts: **`totp: "required"` being silently bypassed after a warning** (it makes an administrator believe the
policy still applies), and **credential uniqueness / per-user cap not being checked inside the write transaction**
(concurrent enrolment can bypass them). In addition, a hand-written verifier is not automatically more secure, and
the test strategy as written cannot prove the browser-side glue is correct: malformed fixtures and differential tests
are mandatory.

## Findings

| ID  | Severity | Title                                                                                                    |
| --- | -------- | -------------------------------------------------------------------------------------------------------- |
| F1  | critical | `totp: "required"` + passkey: warn and continue downgrades the policy                                    |
| F2  | critical | Enrolment uniqueness/cap/userHandle creation are not stated to run inside one write transaction (TOCTOU) |
| F3  | major    | Sign-in finish lacks the "current BE equals the recorded value" check                                    |
| F4  | major    | "Best-effort counter" contradicts the claimed reliable clone detection                                   |
| F5  | major    | The anonymous ceremony map allows evicting other users' entries (availability); no rate limit defined    |
| F6  | major    | The research input wrote COSE `crv` as label 3 (it is -1), exposing a hand-written-parser test gap       |
| F7  | minor    | "Hand-written = safer" does not hold; the 6–8 person-day estimate is optimistic                          |
| F8  | minor    | Conditional UI treated as a stable "~40 lines" change                                                    |

### F1 — critical — TOTP requirement downgraded

**Location**: `docs/plans/passkey-login-plan.md` §5.8 (pre-revision): "logs a warning at startup … README says turn
passkeys off for strict TOTP".

**Problem**: warning and then letting passkeys bypass `totp: "required"` leaves the operator believing mandatory TOTP
still applies. Synced passkeys (BE=1) copy the private key to the cloud and cannot unconditionally replace the
independent second factor the deployment policy claims.

**Fix**: no warn-and-degrade. `totp: "required"` together with `passkey !== "off"` is a configuration contradiction:
either refuse at startup, or explicitly treat passkeys as off (password + TOTP stay enforced); using passkeys requires
lowering `totp` to `off`/`optional` explicitly. If v1 is to support "TOTP after the passkey", first lift the TOTP
second stage out of the password slice into a shared step.

**User decision (2026-11-11, this finding not adopted)**: follow GitHub's sign-in model —
[GitHub Docs: About passkeys](https://docs.github.com/en/authentication/authenticating-with-a-passkey/about-passkeys)
states passkeys satisfy both the password and 2FA requirements, so an account with TOTP enabled still signs in with a
passkey in one step. The plan therefore keeps passkey sign-in as a complete authentication and scopes `totp` to the
password path; the synced-passkey residual risk is documented, and environments needing an independent second factor
set `passkey: "off"`. The "no silent warn-and-degrade" part of the finding still holds (we document the semantics
instead of downgrading).

### F2 — critical — enrolment write transaction

**Location**: §5.4 "limits/global uniqueness" and §5.6 registration step 6 (pre-revision).

**Problem**: the plan states global uniqueness, ≤ 10 per user and first-time userHandle creation, but does not state
that they are re-checked inside the same `mutateUsersFile` mutator; a lock-free pre-check followed by a locked write
lets concurrent enrolments bypass the cap or overwrite a record.

**Fix**: move all three checks into the same `mutateUsersFile` call (lock + CAS), re-check first, then write; add a
concurrent-enrolment case to the negative tests.

### F3 — major — missing BE consistency check at sign-in

**Location**: §5.6 sign-in finish step 3 (pre-revision).

**Problem**: the research brief requires the current BE to equal the value recorded at registration (§7.2); the plan
omitted it. The illegal `BE=0 && BS=1` combination was only rejected at registration.

**Fix**: at sign-in require `credential.be === recorded.be`, reject on mismatch; `BS` is diagnostic only; record BE at
registration.

### F4 — major — counter semantics

**Location**: §5.4 and §5.6 step 5 (pre-revision): "best-effort write + `passkeyEnforceCounter`".

**Problem**: if a write failure is only logged, the cross-restart clone-detection basis is already gone; concurrent
use of the same credential also produces counter regressions, so `enforce=true` can lock users out. The plan cannot
claim reliable clone detection while admitting the write is unreliable.

**Fix**: keep counters in process memory, persist `lastUsedAt` on a throttle, and label `passkeyEnforceCounter` as
**best effort**, rejecting only for device-bound credentials (`be=false && bs=false`); the docs must not promise
clone protection.

### F5 — major — ceremony eviction attack

**Location**: §5.5 (pre-revision).

**Problem**: the 1024-entry cap prevents memory leaks but not an anonymous caller creating entries until other users'
ceremonies are evicted; the plan defined no rate limit for options.

**Fix**: rate-limit `/auth/passkey/options` per client IP plus a global bucket (an independent `LoginRateLimiter`
instance) and registration options additionally per user; use the same TTL for cookie, entry and browser timeout;
document the single-process assumption (multi-replica requires sticky sessions, unsupported in v1).

### F6 — major — COSE label error

**Location**: research input `data/tmp/passkey-research/webauthn-brief.md` (not committed) §1.3.

**Problem**: the brief wrote `crv = coseKey.get(3)`, exactly the kind of gap a hand-written parser hides; the review's
own correction ("crv is label 2") is also inaccurate.

**Fix**: pin per RFC 8152: `kty=1`, `alg=3`, `crv=-1`, `x=-2`, `y=-3`, and cover label shifts plus unusual COSE shapes
(duplicate keys, truncation, trailing bytes) in unit tests.

### F7 — minor — "hand-written = safer" and the estimate

**Location**: §6 (pre-revision).

**Problem**: "21 transitive packages / 870 KiB" is a maintenance cost, not evidence of vulnerabilities; the 250–400
line and 6–8 person-day estimates are optimistic.

**Fix**: justify option A by "no attestation chain needed + dependency budget + differential testing is possible";
raise the estimate to 8–10 person-days and require malformed/truncated/trailing-data/non-canonical-integer fixture
tables plus differential tests; if maintenance proves too costly, the minimal fallback is replacing only CBOR with
`@levischuck/tiny-cbor`.

**User decision (2026-11-11, adopted and taken further)**: stop hand-writing the verifier; server-side verification
now uses `@simplewebauthn/server@14.1.0` (pinned exactly; 21 transitive packages, ~870 KiB unpacked, host side only)
with hand-written `get`/`create` browser glue. Estimate: 6–7 person-days including the conditional-UI settings
toggle.

### F8 — minor — conditional UI estimate

**Location**: §9 item 6 (pre-revision).

**Problem**: conditional UI involves `AbortController`, races with the button ceremony and cancelling mediation when
the password form is submitted; it is not a stable 40-line change.

**Fix**: replace "~40 lines" with "not a stable small estimate"; keep it out of v1.

## Review-point responses

| Decision                        | Review verdict                             | Disposition                                                                                                                             |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Hand-written vs library       | Conditional agree on hand-written          | **Changed**: user chose `@simplewebauthn/server` for server-side verification with hand-written browser glue; no hand-written CBOR/COSE |
| 2 Passkey skipping TOTP         | Disagrees with "required still skips"      | **Not adopted**: user decision follows GitHub's official model (passkeys satisfy password + 2FA); `totp` scopes the password path       |
| 3 Re-auth on credential removal | Conditional agree on session-only          | Accepted: full session + Origin + separate rate limit + audit; re-auth for the last credential or `--all`                               |
| 4 CLI one-time enrolment link   | Agree v2                                   | Kept in v2                                                                                                                              |
| 5 Default off                   | Agree                                      | Kept off                                                                                                                                |
| 6 Conditional UI out of v1      | Agree, but rejects the "40 lines" estimate | **Changed**: v1 ships conditional UI (off by default, admin toggle in Settings, +1 day); wording kept per the review                    |

## Suggested landing order (before implementation)

1. Document the TOTP/passkey relationship per the GitHub model, including the synced-passkey residual risk (F1 not adopted).
2. Fix the storage transaction and counter sections (F2 / F4).
3. Fix verification and ceremony acceptance: library parameters (expected*/UV/algorithm allow-list), BE
   consistency, Origin coverage, anonymous rate limiting, malformed fixtures (F3 / F5 / F6).
4. Only then start PR1; do not start PR2/PR3 from the pre-revision draft.

## Out of scope (explicitly not findings)

- Attestation policy / MDS / related origin requests / passkey-only: explicitly out of v1, and the reviewer agrees.
- Browser-side glue e2e (Playwright/CDP): the repo has no browser test layer; v1 uses a manual device matrix instead,
  which the reviewer did not object to.
- DSH subagent routing: this review called the Kimi Code API directly (`KIMI_CODE_API_KEY`) because the current
  session's subagent model routes do not include Kimi; wiring Kimi into the review slot is a separate open item
  (`memory/open-items.md`).
