# Grok 4.6 Review — token-mode login failure renders the login card (D21)

- **Date**: 2026-09-23
- **Reviewer**: grok-4.6 (SuperGrok subscription, high effort, script channel — no tools; reviewed a
  self-contained package of diff + new ADR + new tests + post-change `auth-endpoints.ts`)
- **Scope**: uncommitted change on `fix/token-failure-html-card` (based on `development` `6c49546`)
- **Verdict**: **approve** (no security or contract blocker; two documentation defects to fix in the
  same PR)
- **Standards**: repo `AGENTS.md` + `.agents/skills/dsh-auth-code-review/SKILL.md` + issue #85

## Summary

The browser dead end (a wrong token rendering a blank `text/plain` page) is fixed in the same shape
D20 used for passwords, and every M2 invariant that has security meaning survives: the `401` status,
one constant, no reflection of request text, no secret or username in logs, the no-JavaScript submit
path and `no-store`. The review's own material could not see the ZH ADR (the review package only
carried the EN file), so its "dead link" finding is a false alarm — the file exists in the tree. Two
real documentation defects were found and fixed before the PR: the ADR justified skipping
`SUBMIT_SCRIPT` with a wrong statement about what F5 replays, and it called `413` unreachable from the
browser form.

## Findings

| ID  | Severity | Title                                                                                  |
| --- | -------- | -------------------------------------------------------------------------------------- |
| F1  | major    | D21 ADR/index: "F5 re-validates an empty field" is factually wrong                     |
| F2  | minor    | D21 ADR: `413` is reachable from the token form (a >16 KB paste); wording overstated   |
| F3  | nit      | `impl-m3` P11 "byte-for-byte" is misleading once the M2 401 body is amended            |
| —   | false    | "`decisions.md` links a ZH ADR that the change does not add" — the file is in the tree |

### F1 — major — "F5 re-validates an empty field" is factually wrong

**Location**: `docs/decisions/implemented/2026-09-23-token-failure-html-card.en.md` (Decision,
"Deliberately not added"), `.zh.md` equivalent, `docs/decisions.md` D21 entry.

**Problem**: A reload replays the **original POST with the original token**, not the empty field of
the rendered card. The empty field only applies to a fresh submit from the failure page. As written,
the record's justification for not injecting `SUBMIT_SCRIPT` rested on a wrong mechanism — and it hid
the actual reason a `history.replaceState` would be useful (keeping the secret out of a replayable
history entry).

**Fix**: restored the correct mechanism and re-based the decision on the two reasons that hold: there
is no failure budget to spend (token mode has no rate limiter, so neither a double submit nor a
reload can lock anyone out) and injecting the script would require a new option on the shared page
API. The `history.replaceState` hygiene value is recorded as a deferred follow-up instead of being
papered over.

### F2 — minor — `413` reachable by pasting an oversized body

**Location**: same ADR, Decision, "Deliberately unchanged".

**Problem**: `415` really is unreachable from the form (the form always posts
`application/x-www-form-urlencoded`), but `413` is reachable by pasting a body over the 16 KB form
limit. The record claimed neither was reachable, which is an unfounded assertion about the user's
own input.

**Fix**: the record now separates the two cases: `415` browser-unreachable, `413` reachable but
self-inflicted and non-actionable, kept `text/plain` because the M19 `connection: close` shape is
frozen and a card would need new copy. It is labelled a **known residual**, and
`auth-endpoints.login.test.ts` now locks `413` + `connection: close` + `text/plain` so a future
"while we are here" change cannot silently widen the blast radius.

### F3 — nit — `impl-m3` P11 "byte-for-byte"

**Location**: `docs/implemented/impl-m3.md` P11 (`impl-m3_zh.md` equivalent).

**Problem**: P11 says token mode behaves byte-for-byte identically to M2; after D21 that reads as if
the token 401 were still `text/plain`.

**Fix**: added a half-sentence scoping the clause to the gate and the credentials wiring (both still
untouched) and pointing at D21 for the browser representation.

## Review-point responses

1. **401 as a card, status preserved** — accept. Status / one constant / no reflection / log
   discipline / no-JS submit all hold; only clients that match the exact old body or content-type are
   affected, which is a deliberate contract revision recorded in the ADR.
2. **413/415/503 stay `text/plain`** — accept, with F2's wording correction. The boundary is
   "user-fixable auth failure → HTML; protocol/operator failure → plain", isomorphic to D20. Do not
   widen it to swallow the 503.
3. **`SUBMIT_SCRIPT` not added** — accept after F1. Not adding it is safe; the stated reason had to
   be corrected, and the `replaceState` hygiene point is now recorded as a deferred follow-up.
4. **TOTP copy as its own constant** — accept. Reusing `INVALID_CREDENTIALS` would misattribute the
   failure; splitting "expired" from "wrong" would be an oracle. The reviewer noted "expired" is
   slightly over-promising for the "account no longer has a secret" state, and suggested a neutral
   `Invalid code.`; kept as-is because the sentence must cover three states without distinguishing
   them, and it is a copy preference rather than a security property.
5. **Secret exposure** — accept. The token never enters the HTML (no `value`), never enters the logs
   (`login rejected` is a literal), and every failure carries `no-store`.
6. **Documentation consistency** — accept with the corrections above. The independent sweep asked for
   (see the reviewer's list) was run over the repo, `lib/` and the bundled skill; the only remaining
   `invalid token` / `text/plain 401` strings are historical records (M2's original text with its
   amendment, the D20 ADR with its supersede note, the D21 ADR, and the unexecuted PR #53 plan).
7. **Test strength** — accept. Unit + integration both fail if the body regresses to `text/plain`;
   the reviewer's suggested additions were adopted (integration asserts the constant, `no-store` and
   non-reflection; `413` locks `text/plain`).

## Suggested landing order (before merge)

1. F1 + F2 wording fixes in the ADR pair and the `docs/decisions.md` entry (done).
2. F3 half-sentence in `impl-m3` P11 (done).
3. Add the integration assertions and the 413 lock (done).
4. `npm run verify` green, `lib/` rebuilt in the same commit (done).

## Out of scope (explicitly not findings)

- `SUBMIT_SCRIPT` / `history.replaceState` on the token page (deferred, recorded in D21).
- Rendering a card for `413`/`415`/`503` (deliberate boundary; `413` recorded as a known residual).
- The unexecuted `docs/plans/pr53-login-page-fix-plan*.md`, whose "failure is still `401
text/plain`" premise is historical and belongs to a plan that was never run.
- Making the TOTP copy neutral (`Invalid code.`) — copy preference, not a defect.
