# D28. Corridor tail becomes a floor: declare `>=0.2.0-rc.1` in engines and in the storage-domain peer

## Decision

The tail of the declared host corridor stops being another alternative and becomes a floor —
top-level `engines.dsh` **and** the `@deepseek-ai/dsh-storage-domain` peer both read
`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || >=0.2.0-rc.1`. The three caret alternatives
stay as the record of the verified 0.1.x host lines; the trailing floor accepts **every**
host version from the current `next` line onwards. The guard test
(`src/shared/host-corridor.test.ts`) moves with it: expected string, covered set and
not-covered set. **No source change**, and the dev/test host cohort is untouched.

## Context

The dsh `0.2.0-rc.2` compatibility gate (`evaluatePluginCompatibility` in `dsh-app-boot`)
evaluates only `@deepseek-ai/dsh` and `@deepseek-ai/dsh-*` entries under `peerDependencies`,
with `semver.satisfies(runtime, range, { includePrerelease: true })`; the pre-install check in
`dsh plugin add` calls the same function (`operations.ts` in `dsh-plugin-manager`). With
`includePrerelease`, a floor means "everything from here on is accepted", future prereleases
included:

| Host version | D26 corridor | This decision's floor |
| ------------ | ------------ | --------------------- |
| `0.1.5-rc.2` | covered      | covered               |
| `0.1.7-rc.2` | covered      | covered               |
| `0.2.0-rc.2` | covered      | covered               |
| `0.2.5-rc.1` | covered      | covered               |
| `0.3.0-rc.1` | not covered  | covered               |
| `0.3.0`      | not covered  | covered               |
| `1.0.0`      | not covered  | covered               |

That gap is the whole reason for the change. A gate verdict of "incompatible" is not an error
report: the bundle is **skipped silently**, the instance keeps serving, and only the login
gate is gone. D26 already records that failure shape as fail-open. Appending an alternative is
a manual act, manual acts lag host releases, and the lag is exactly the fail-open window.

Evidence collected before the change (2026-10-07):

- the semver matrix was recomputed with this repo's own `semver` and the gate's own options,
  read from `dsh-app-boot` (`semver.satisfies(runtimeVersion, requirement, {
includePrerelease: true })` in `lib/index.js`); the running host is `0.2.0-rc.2`;
- **a wider range does not make pnpm install a second `dsh-storage-domain`.** In the live `web`
  profile lock, `dsh-deeptutor@0.1.9` declares the peer `^0.1.0-rc.6`, which covers the
  `0.2.0-rc.2` host under neither interpretation (the caret expands to `<0.2.0-0`), yet pnpm
  still handed it the graph's `0.2.0-rc.2` copy and the lock holds no second `dsh-tools`
  version. Peer deduplication uses the copy already in the dependency graph;
  `auto-install-peers` only fills peers the graph lacks entirely. The duplicate copy D12
  started from came from `dependencies`, not from a peer;
- under `includePrerelease`, `^0.1.0-rc.6` alone already covers `0.1.5-rc.2` and `0.1.7-rc.2`.
  The three 0.1.x entries were always one line written three times; they stay only to keep the
  verified hosts readable in the declaration and the market badge.

## Alternatives Considered

- **Keep the D26 enumeration and append one alternative per new host line** — the gate never
  over-admits, but the login gate disappears silently on the day dsh changes line, and holding
  it depends on someone remembering to edit the declaration.
- **Leave a single `>=0.1.0-rc.6`** — shortest, and it covers every host running today, but it
  drops the record of which 0.1.x hosts were verified. Keeping the enumeration costs nothing,
  so there is no reason to drop it.
- **Write `>` instead of `>=`** — the floor version itself is excluded, so a host running
  exactly at the floor is judged incompatible by our own declaration, which removes the login
  gate by construction.
- **Append one entry per host version** — unnecessary: under the gate's options a caret already
  covers its whole line, unpublished prereleases included; the only real gap is a line change.
- **Wait for a stable dsh release** — the gate is already live on the rc line users install
  from `next`, and the wait is precisely the window that needs covering.
- **Put an upper bound on the floor (for example `<1.0.0-0`)** — this narrows "everything
  later" back to one major line, but a breaking change can land on any line, so the bound only
  moves the same problem to the next line boundary.

## Why

The two failure directions are not symmetric. A too-narrow declaration makes the host judge the
plugin incompatible, the bundle is skipped silently, the login gate is gone and the instance
keeps serving. A too-wide declaration lets the plugin load, and a real breaking change then
surfaces as a startup or runtime error, which is a loud failure. For a login plugin the first
direction is unacceptable, so the corridor stays wide at the tail. The enumeration survives so
that the declaration, the badge and the docs still state which hosts were verified.

The cost is recorded as-is: if a future host breaks a seam this plugin uses (the `webServer`
route tables, the storage domain, the client slots), the gate will no longer stop it and the
plugin will load anyway. A declaration can only express intent; the durable backstop is a
runtime self-check that probes an unauthenticated request after boot and confirms it lands on
the login page.

One **release constraint** follows: the corridor must ship in a new version. The wide floor
only applies to plugin versions that carry it, so until such a version is installed, a dsh
move to the `0.3.x` line still meets the old declaration and is still skipped silently.

Numbering note: this record was written as D27 on 2026-10-07; merging 0.17.1 on 2026-10-11
found that number taken by the guard-unwrap record, so it is renumbered D28.
