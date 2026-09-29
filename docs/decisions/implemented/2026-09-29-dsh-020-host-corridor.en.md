# D26. dsh 0.2 host corridor: declare `^0.2.0-rc.1` in engines and in the storage-domain peer

## Decision

The declared host corridor grows by one alternative — top-level
`engines.dsh` **and** the `@deepseek-ai/dsh-storage-domain` peer both become
`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || ^0.2.0-rc.1` — and the
dev/test host cohort (`dsh-host-webserver`, `dsh-storage`, `dsh-storage-domain`,
`dsh-storage-json`) moves to `^0.2.0-rc.1`, resolving `0.2.0-rc.2`. No source
change: the seams this plugin uses (the `webServer` route tables, the storage
domain, the client slots) behave identically on both lines.

## Context

dsh `0.2.0-rc.2` (published 2026-09-29, npm `next`) adds a **plugin
compatibility gate** in `dsh-app-boot` (`evaluatePluginCompatibility`). It
evaluates only `peerDependencies` entries named `@deepseek-ai/dsh` or starting
with `@deepseek-ai/dsh-`, with `semver.satisfies(runtime, range, { includePrerelease: true })`;
top-level `engines.dsh` does **not** participate in the decision. Leaving 0.2.x
undeclared therefore has two effects, and the second is the dangerous one:

- `dsh plugin add` refuses the install outright
  (`Plugin dsh-auth-gate@0.15.0 is incompatible with dsh 0.2.0-rc.2: peerDependencies {...}`);
- at boot, an incompatible **bundle** is skipped with a single stderr line
  (`dsh: skipping profile bundle "dsh-auth-gate": ...`) while the instance keeps
  serving — the login gate disappears silently instead of failing loud. A gate
  that vanishes is a fail-open regression, not a missing feature.

The gate compares the **running** `dsh-app-boot` version against each declared
`@deepseek-ai/dsh*` peer range, so a `@deepseek-ai/dsh-storage-domain` peer is in
practice a statement of which host versions this plugin accepts. That is why the
corridor string has to stay identical to `engines.dsh` (D12), and why widening
`engines.dsh` alone can never clear the gate.

Evidence collected before extending the corridor (2026-09-29, isolated dsh
`0.2.0-rc.2`, production untouched):

- the repository's own suite on the `0.2.0-rc.2` host cohort: 111 files / 968 tests pass, including the integration tests that mount a real `webServer` from
  `@deepseek-ai/dsh-host-webserver`;
- the **npm-published** `0.15.0`, under an exact-version exemption, running on
  `0.2.0-rc.2`: login gate (`302` to `/auth/login`, API `401`), password login,
  TOTP two-stage challenge, password change with session eviction, the "Account
  security" settings section, the launch-token bridge, the client bundle served,
  zero console errors - the released plugin **code** needs no change;
- the **workspace build of this branch** (version string still `0.15.0`, and it already
  carries the unreleased P2 work), installed on `0.2.0-rc.2` with **no exemption at
  all**: boot log free of `skipping profile bundle`, the same gate assertions, and the
  live entry-coverage probe (`scripts/check-live-entries.mjs`) at 67/67 - recorded in
  `docs/deployed/entry-coverage-0.2.0-rc.2.md`. Only this build carries the widened
  peer, so only this build proves the metadata change clears the gate; the exemption
  run above proves the code itself needs no change;
- the exported declaration set of `@deepseek-ai/dsh-storage-domain` is identical
  between `0.1.7-rc.2` and `0.2.0-rc.2` (diffed over the packed `lib/**/*.d.ts`
  exports).

Trade-off accepted along with the dev-cohort move: CI now exercises the suite against the
`0.2.0-rc.2` host packages only, so a regression that appears on the `0.1.x` host packages
alone is no longer caught by CI. The `0.1.x` line stays supported by declaration, and
production stays on it until a plugin release carries this corridor.

## Alternatives Considered

- **`engines.dsh` only** — the gate never reads `engines`, so installs stay
  rejected and the bundle keeps being skipped: no effect on the actual blocker.
- **Peer only, `engines.dsh` left at 0.1.x** — clears the gate, but the market
  badge (D12) and npm's own engine check would still read the old corridor, and
  the two statements would be free to drift.
- **Declare `^0.2.0-rc.1` alone (drop 0.1.x)** — production runs `0.1.7-rc.2`
  today; dropping it would flag the running host as unsupported and close the
  rollback path.
- **Keep the dev cohort on 0.1.x** — the suite would keep its integration tests
  on a line the plugin no longer targets first, and the 0.2.0 gate is exactly
  the kind of host-plane change that needs coverage.
- **Wait for a stable `0.2.0`** — the gate already ships in the rc line users
  install from `next`; waiting means shipping a known silent-unguarded state.
- **Pin the dev host packages exactly (`0.2.0-rc.2`)** — the repo's existing
  style is a caret on the corridor floor, and the lockfile already pins the
  resolved build; an exact pin would just add churn at every rc.

## Why

The gate reads peers, so the peer string is the operative declaration; keeping
`engines.dsh` byte-identical to it preserves D12's single-badge property and
makes drift impossible. Appending an alternative instead of replacing the range
keeps both hosts declared at once: production `0.1.7-rc.2` (rollback included)
and the `0.2.x` line that npm `next` installs. Moving the dev cohort to the new line puts the 968-test suite — integration tests included — on the host the
plugin is being prepared for, and the live entry-coverage probe covers what unit
tests cannot: that every guarded entry the 0.2.0 route table exposes is still denied
without credentials.

Three release constraints follow from this decision and are binding for whoever ships it:

1. **The isolation evidence describes a workspace build, not the published package.** The
   version string is owned by release-please; this branch must not hand-edit `version`, and
   no record may claim that `dsh-auth-gate@0.15.0` (npm) was verified on `0.2.0-rc.2`.
2. **The corridor ships as a new release.** Until a published plugin version carries the
   widened peer, the gate keeps rejecting/skipping every published version on `0.2.x`.
3. **Plugin first, host second.** Do not move production to dsh `0.2.x` before that release
   is installed: an incompatible bundle is skipped silently, which removes the login gate
   (fail-open) instead of failing loudly.
