# Layered src with barrel-only cross-slice imports (2026-08-30)

## Decision

The flat `src/` root (21 entry modules, 52 files) was restructured into
layers: `gate/` and `session/` as core mechanism layers, `features/{token,
password,proxy}/` as feature slices, `shared/` as the leaf utility layer,
`client/` unchanged. Cross-slice imports may only land on the target slice's
`index.ts` barrel; feature slices never import each other; `client/` and the
host half are isolated. The verify chain gained `slice:check`,
`bundle:check`, `lint:no-emdash` and `build` (ported from
dsh-plugin-framework), and the restructure stayed behavior-neutral
(230 tests green, `git diff -M` shows renames only).

## Context

`src/` grew past the point where the system is readable at a glance, and M4
(TOTP) is next. dsh-plugin-framework - the reference framework, whose
conventions have held up across the dsh codebase - prescribes the
features/shared layering; its gate scripts exist to keep such layout honest.

## Alternatives Considered

- **Full FSD (entities/pages/widgets/ui trees)** — rejected: auth-gate is a
  server-side plugin with a 3-file client; framework-style client/ui trees
  are over-engineering here (see the "reference, don't copy" principle).
- **Keep the flat root, just add folders later** — rejected: doing it before
  M4 costs less than migrating TOTP out of a flat root afterwards.
- **session as a feature slice** — rejected during execution: the boundary
  check caught token/password -> session edges; session is consumed by both
  auth surfaces, so it was demoted to a core mechanism layer next to `gate/`.
- **Lightweight ADR process (single-language, no gate script)** — rejected:
  the official process (20k-commit lineage) shows a mechanical constraint is
  needed most before habits form.

## Why

Layers must match the dependency graph: shared is a leaf, session sits under
both auth surfaces, features stay independent of each other. Machine checks
(slice boundaries, bundle contract, no-emdash) prevent silent drift, and the
extended verify chain moves the lib-drift gate from "CI catches it later" to
"local verify blocks it". The `login-page` module is shared by both modes and
therefore lives in `shared/`, not in either feature.
