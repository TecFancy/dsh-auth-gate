# D12. Host-requirement declaration and storage-domain as a peer

## Decision

Two changes land together: a top-level `engines.dsh` in `package.json` declaring
the host corridor `^0.1.0-rc.6 || ^0.1.5-rc.2`, and
`@deepseek-ai/dsh-storage-domain` moving from `dependencies` to
`peerDependencies` (same range), with a `^0.1.0-rc.6` entry kept in
`devDependencies` for this repo's build and tests. The plugin no longer ships
its own copy of that package.

## Context

The store (dshmarket) derives its "host requirement" badge from exactly three
places: top-level `engines.dsh`, `dsh.engines.dsh`, and `@deepseek-ai/dsh-*`
peer declarations that are part of the host inventory. This plugin had none of
them, so the badge read "host requirement undeclared".

The more consequential problem was the dependency field:
`@deepseek-ai/dsh-storage-domain` is a host-shared package (the host's
`@deepseek-ai/dsh-base` depends on it). Declared as an ordinary dependency, pnpm
installed a nested `0.1.0-rc.8` copy inside the plugin while the host tree
carried `0.1.5-rc.2` — two versions of the same domain contract in one process,
and the nested copy never follows a host upgrade. The root cause is semver's
prerelease rule: `^0.1.0-rc.6` can never match `0.1.5-rc.2` under strict
semantics (only comparators on the same prerelease tuple are allowed through),
while the market's discovery path evaluates with `includePrerelease` — hence
"compatible on screen, an old-line copy on disk".

Official position (dsh main decision note
`2026-09-10-public-package-manifest`): the host requirement belongs in
**top-level** `engines.dsh`; peers cannot identify the running dsh process on
their own, and neither installers nor loaders enforce the declaration.

## Alternatives Considered

- **Add `engines.dsh` only, keep storage-domain in `dependencies`** — a badge
  appears, but the nested old-line copy stays: two domain contracts keep
  coexisting and the copy ignores every host upgrade.
- **Declare the verified line only (`^0.1.5-rc.2`)** — hosts on 0.1.2-alpha or
  0.1.5-rc.1 would be flagged as below the floor, although neither the
  `webServer` service contract nor the storage-domain API the plugin uses
  (identical export set to 0.1.0-rc.8) changed on that line — a false alarm.
- **Use the old single range `^0.1.0-rc.6`** — it does not match the running
  host `0.1.5-rc.2` under strict semantics, so the market's profile summary
  prints a "peer range … does not match resolved …" warning that is not real.
- **Declare under `dsh.engines.dsh` instead of the top level** — the top level
  is the official position, and when both are present the market reads only the
  top level, so a second copy would be drift surface for nothing.

## Why

The `||` form `^0.1.0-rc.6 || ^0.1.5-rc.2` satisfies both corridors under
**strict** semver (`0.1.0-rc.x` through the first alternative, `0.1.5-rc.x`
through the second): it covers this repo's dev corridor (currently resolved to
`0.1.0-rc.8`) and the production host `0.1.5-rc.2`, and it matches the
`^0.1.1-rc.2 || ^0.1.2-alpha.1` style dsh-plugin-subscriptions already uses.
Using the same string for `engines` and the peer keeps the market's
`displayRequirement` deduplicated to a single badge. Handing storage-domain to
the host stops pnpm installing a second copy and lets the plugin follow host
upgrades; the package is a `dsh-base` dependency, so any dsh install provides
it.
