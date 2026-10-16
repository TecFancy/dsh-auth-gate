# Tech Debt

## `host:check` carries a copy of the dsh shell's module table

- **Where:** `scripts/check-host.mjs`, `HOST_MODULES`.
- **What:** The list of modules the dsh web shell seeds into its module table is copied by hand
  from dsh `packages/client/web/src/platform.ts` (`PLATFORM_MODULES`). It was checked against dsh
  commit `b2e3b2a` on 2026-10-16, and `dsh-lingualab` keeps a third copy in its own
  `scripts/check-host.mjs` and `tsdown.config.ts`.
- **Why it is debt:** When the host adds or removes a seeded module, nothing here notices. A module
  the host drops would still pass `host:check` and fail in the browser at runtime.
- **Way out:** Read the list from an installed dsh package, or from a contract file the host
  publishes, once one of them ships it. Then delete the copy in this script and in `dsh-lingualab`.
