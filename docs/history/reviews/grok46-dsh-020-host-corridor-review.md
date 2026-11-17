# Grok 4.6 Review — dsh 0.2 host corridor (peer/engines + dev cohort + evidence docs)

- **Date**: 2026-09-29
- **Reviewer**: grok-4.6 (xAI subscription, `high` effort), two parallel agents — one correctness
  reviewer, one adversarial verifier, both with tool access (read-only repo + read-only probes of the
  isolated instance)
- **Scope**: `fix/dsh-0.2-host-corridor` working tree against `origin/development` (`4402caa`)
- **Verdict**: approve-with-notes (correctness agent) / "do not ship this _artifact_ as `0.15.0`"
  (adversarial agent) — the corridor change itself was not refuted
- **Standards**: repo `AGENTS.md`, D12 (host-requirement declaration), D26 (this change),
  `scripts/check-live-entries.mjs`

## Summary

Both agents confirmed the core claim: dsh `0.2.0-rc.2`'s plugin gate reads only `@deepseek-ai/dsh*`
peers (with `includePrerelease: true`), so appending `^0.2.0-rc.1` to the storage-domain peer clears
it, while the `^0.1.x` alternatives keep the production line supported. They also verified the
mechanism against the host's own `evaluatePluginCompatibility` and probed the isolated instance
directly.

The review's value was in what it refused to take on trust: two documentation statements
contradicted each other, the entry-coverage probe never actually asserted the browser-navigation
branch it claimed to cover, the corridor test was a substring check rather than a semver check, and
the isolation evidence comes from the workspace build (which carries unreleased P2 work under an
unchanged `0.15.0` version string) rather than from the npm-published `0.15.0`. All of these were
fixed in the branch; the version-string point is a release-process constraint, recorded below.

## Findings

| ID  | Severity | Title                                                                 |
| --- | -------- | --------------------------------------------------------------------- |
| F1  | major    | README and D26 disagreed about the production host version            |
| F2  | minor    | `docs/specs/development` still pinned storage-domain at `^0.1.0-rc.6` |
| F3  | minor    | Upgrade checklist still pointed at the 0.1.5 entry-coverage record    |
| F4  | minor    | Corridor test used string containment, not `semver.satisfies`         |
| F5  | nit      | `docs/README.md` still said "D1–D25"                                  |
| F6  | nit      | README overstated the gate ("0.2.0 refuses", "peers" plural)          |
| F7  | nit      | Entry-coverage record claimed a 302 the probe never produced          |
| F8  | minor    | 67/67 judged by "non-2xx means PASS"; a 500 or a stripped gate passes |
| F9  | minor    | Public endpoints answer 200 while the record said "no 2xx"            |
| F10 | major\*  | Version string `0.15.0` does not identify the reviewed artifact       |

\* F10 is a release-process finding, not a code defect; disposition below.

### F1 — major — production version contradiction

**Location**: `README.md` / `README.zh.md` (Requirements) vs
`docs/decisions/implemented/2026-09-29-dsh-020-host-corridor.{en,zh}.md` and `docs/decisions.md` D26.

**Problem**: the README said production is `0.1.5-rc.2`; D26 said `0.1.7-rc.2`. Both were touched in
this change, so one of them was wrong: production was upgraded to `0.1.7-rc.2` on 2026-09-25
(`notes/tech/dsh-ops/27-upgrade-runbook-017rc2.md`), and the README line predated that upgrade.

**Fix**: README now reads "`0.1.5-rc.2` and `0.1.7-rc.2` (production, in that order), plus
`0.1.7-alpha.1` and `0.2.0-rc.2` (isolated instances)". D26 keeps `0.1.7-rc.2`.

### F2 — minor — dependency discipline stale

**Location**: `docs/specs/development.md:247`, `docs/specs/development_zh.md:222`.

**Problem**: the live engineering doc still instructed pinning `@deepseek-ai/dsh-storage-domain` at
`^0.1.0-rc.6`, contradicting the peer/dev ranges this change introduces.

**Fix**: both languages now state the current rule — peer carries the same corridor string as
`engines.dsh`, dev/test host cohort follows the corridor floor (`^0.2.0-rc.1`) — and note that the
`impl-m1` §3 pin is frozen history, not policy.

### F3 — minor — upgrade checklist pointed at the old record

**Location**: `docs/deployed/deployment.md` §5 step 3, `docs/deployed/deployment_zh.md` (same step),
`docs/README.md` reading path.

**Problem**: the "latest verified run" line only referenced the `0.1.5-rc.2` record, and the reading
path still sent operators to its §5 only.

**Fix**: both now list the `0.1.5-rc.2` and `0.2.0-rc.2` runs and spell out the `Sec-Fetch-Mode`
requirement of the navigation probe.

### F4 — minor — corridor test too weak

**Location**: `src/shared/host-corridor.test.ts`.

**Problem**: `toContain("^0.2.0-rc.1")` would also accept `^0.2.0-rc.10`, and nothing asserted the
actual gate semantics (`includePrerelease` satisfaction).

**Fix**: the test now pins the exact corridor string, runs `semver.satisfies` with the gate's
options over the claimed host lines (`0.1.5-rc.2`, `0.1.7-alpha.1`, `0.1.7-rc.2`, `0.2.0-rc.2`,
`0.2.0`, `0.2.1`), asserts non-membership for `0.1.0-rc.5`, `0.3.0`, `0.3.0-rc.1`, and asserts there
is exactly one `@deepseek-ai/dsh*` peer. `semver` + `@types/semver` are devDependencies so the test
measures the predicate the host actually uses.

### F5/F6/F7/F9 — nits — wording and record accuracy

**Fix**: `docs/README.md` now says D1–D26; the README describes the gate as "`0.2.0-rc.2` (already on
the `next` line) refuses to install, and at boot silently skips … that check reads peers only —
`engines.dsh` is not consulted — and a plugin declaring no such peer is not checked at all"; the
entry-coverage record now says "no **guarded** entry answered 2xx" and lists the public group
(`/auth/login`, `/auth/status` 200 by design, `/manifest.webmanifest` per D13) separately.

### F8 — minor — probe judgement could pass a broken gate

**Problem**: the generic rule was "any non-2xx is a pass", so a 500 or an SPA that answers 200 on a
non-navigation probe would pass; the browser-navigation row sent `Accept: text/html` only, got 401
under the fail-closed `Sec-Fetch-*` predicate, and was judged PASS by that same generic rule — the
302 branch was documented but never asserted.

**Fix**: `scripts/check-live-entries.mjs` gained an `extraHeaders` parameter and a `navigation` kind:
the row now sends `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Dest: document` and is judged on the exact
outcome `302 -> /auth/login`. Re-run against the isolated `0.2.0-rc.2` instance:
`67/67 PASS, 0 FAIL` with the row reading `302 → /auth/login?next=%2F`. The "500 counts as PASS"
half of the finding is **accepted as-is**: the tool's contract is "not reachable without
credentials", and treating 5xx as a failure would conflate a broken host with an unguarded entry;
the run prints the status code for every row so a 5xx is visible to the operator.

### F10 — major — version string does not identify the artifact

**Problem**: the workspace tree, the packed tarball and the isolated install all say `0.15.0`, but
they carry the unreleased P2 work; npm's `dsh-auth-gate@0.15.0` (gitHead `4f362a7`) is a different
artifact with an unwidened peer range.

**Disposition (accepted, with rules)**: versioning is owned by release-please (repo `AGENTS.md`), so
this branch must not hand-edit `version`. Consequences, recorded here and in D26:

1. The isolation evidence is labelled as "workspace build of this branch", never as "0.15.0 verified
   on 0.2.0";
2. The release that ships this corridor must carry a fresh version (release-please will assign it);
3. **Plugin first, then host**: production must not move to dsh `0.2.x` before a published plugin
   release carries the widened peer, otherwise the gate skips the bundle and the login gate
   disappears (fail-open).

## Round 2 - verification of the fixes

A second grok-4.6 agent re-reviewed the branch with the F1-F10 list and tool access, and was
explicitly asked to falsify the fixes rather than trust them. Verdict at that point:
**NEEDS-WORK** - the corridor change itself held up (semver matrix re-derived, the gate's own
`evaluatePluginCompatibility` re-run, live probe re-run), but four documentation defects remained,
three of them introduced while fixing round 1. All four were fixed in this branch:

| Item | Finding                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | F10's three release constraints were recorded only in this review, not in D26, although the disposition claimed "recorded here and in D26"                        | D26 (en + zh) now ends `Why` with the three binding constraints: isolation evidence describes a workspace build; the corridor ships as a new release; **plugin first, host second**. `docs/deployed/deployment.md` §5 and its Chinese pair gained the matching "plugin first, host second" step |
| R2   | Test counts disagreed inside D26 (964 in the evidence list, 962 in `Why` and in `docs/decisions.md`), and the CI trade-off paragraph existed only in Chinese      | Counts unified to 111 files / 968 tests (the state `npm run verify` reports); the trade-off paragraph was added to the English record                                                                                                                                                           |
| R3   | The 0.2.0 coverage record claimed `/manifest.webmanifest` was part of the public probe group, but the tool's `SUPPLEMENTS` and its verbatim table had no such row | The path is back in `SUPPLEMENTS` as `group: "public"` (expected 200, D13 rationale), the probe was re-run, and both language records were regenerated: public group 5 rows, `/manifest.webmanifest` 200 PASS, guarded rows still 67/67                                                         |
| R4   | `deployment.md` §5 still said the probe fails on "any entry answering 2xx", which the public endpoints contradict                                                 | Both languages now say "any **guarded** entry"; the public group is called out as judged separately                                                                                                                                                                                             |

Round 2 also produced the mutation evidence for F4: with the corridor test in place, all three
mutations of `package.json` fail it (peer only -> `^0.2.0-rc.10`, engines only, and both ->
`^0.2.0-rc.10`, where `semver.satisfies("0.2.0-rc.2", ...)` is false while the old substring check
would have passed), and the unmutated baseline is 6/6 green.
