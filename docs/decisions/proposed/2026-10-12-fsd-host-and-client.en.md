# D29. The host half moves into `src/host/` with the lower three FSD layers; the client half uses five FSD layers

## Decision

Both halves of `src/` switch to Feature-Sliced Design layering guarded by Steiger, with a structure
aligned to dsh-lingualab (its v0.9.0 host refactor and the earlier client refactor):

- **The host half moves into `src/host/` and uses only these three layers**: `shared`, `entities`,
  `features`. There is no `widgets`, `pages` or `app`: the host composes no UI, and the plugin owns
  no shell of its own. Today's `gate/`, `session/`, `http/`, `features/*` and `shared/` are re-homed
  according to the table below.
- **The client half uses five layers inside `src/client/`**: whichever of `shared`, `entities`,
  `features`, `widgets`, `pages` are needed, with no `app` layer; `index.tsx` stays at the root of
  the analyzed tree.
- **Entry points and assembly stay at the `src/` root, outside the analyzed tree**: `index.ts`,
  `cli.ts`, `proxy-cli.ts` (the `main` and `bin` fields of `package.json` point at their build
  output, so their location does not move), plus `admin-wiring.ts`, `token-resolver.ts`,
  `launch-token-bridge.ts` and `cli-skill.ts`. The rule from D9, that the TOTP capability is
  injected into password through the root assembly, keeps happening here.
- **Integration tests and their helpers move out of `src/`** into `test/integration/`.

Once this record lands it supersedes the directory part of D5 (src layering with cross-slice
imports only through barrels) and of D11 (the http layer). The three disciplines "cross-slice only
through `index.ts`", "no imports between feature slices at the same level" and "client and host
never import each other" stay, and are now enforced by Steiger and the slimmed-down `slice:check`.

### Host placement

| Layer      | Slice or segment | From                                                                                                                                                                                                                                                                        |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`   | `guard`          | All of `gate/` (`gate.ts`, `guard.ts`, `self-check.ts`); it depends only on `shared`                                                                                                                                                                                        |
|            | `http`           | `cookie`, `form-body`, `origin`, `host`, `client-ip`, `ip-address`, `auth-common`, `login-redirect`, plus the session-independent `authCatchAll`, `queryOf` and `methodNotAllowed` from `http/endpoints.ts`                                                                 |
|            | `login-page`     | `login-page.ts`, `login-page-assets.ts`                                                                                                                                                                                                                                     |
|            | `rate-limit`     | `rate-limit.ts`                                                                                                                                                                                                                                                             |
|            | `skill`          | `skill-install.ts`                                                                                                                                                                                                                                                          |
|            | `lib`            | `dshHomeDir`, taken out of `users-file.ts` (`skill-install` currently depends back on the users file for it)                                                                                                                                                                |
| `entities` | `session`        | `model/` holds `session-store.ts`; `api/` holds `handleLogout` and `handleStatus` from `http/endpoints.ts`                                                                                                                                                                  |
|            | `user`           | `model/` holds `users-file.ts` and `password-policy.ts`; `@x/session.ts` exposes only the `UsersLoadResult` type, for `handleStatus`                                                                                                                                        |
| `features` | `token`          | `api/auth-endpoints.ts`, `model/token-gate.ts`                                                                                                                                                                                                                              |
|            | `password`       | `api/` holds the endpoints and the password-change route, `model/` holds the gate, login, session issuance, restricted session, challenge cookie and disabled-user sweeper, `lib/` holds scrypt, `ui/` holds the server-rendered failure pages and the password-change page |
|            | `totp`           | `lib/totp.ts`, `model/replay-guard.ts`, `cli/` holds the enable/disable subcommands                                                                                                                                                                                         |
|            | `admin`          | `api/` holds the endpoints and responses, `model/` holds audit, reset steps, the user list and deps                                                                                                                                                                         |
|            | `proxy`          | `model/proxy.ts`, `model/proxy-headers.ts`, consumed only by `proxy-cli.ts`                                                                                                                                                                                                 |

A slice's unit tests move with its source. The few tests under `shared/` that check the package
manifest rather than a module (`host-corridor`, `manifest-icon`, `manifest-locale`) move to the
`src/` root, next to the entry-point tests.

### Client placement

| Layer      | Slice                                | From                                                                            |
| ---------- | ------------------------------------ | ------------------------------------------------------------------------------- |
| `shared`   | segments such as `api`, `i18n`, `ui` | `context.ts`, `account-copy.ts`, `account-styles.ts`, `account-icon.ts`         |
| `entities` | `account`                            | `admin-types.ts`, `account-status.ts`                                           |
| `features` | `change-password`                    | `account-form`, `account-fields`, `account-submit`, `account-redirect`          |
|            | `admin-users`                        | `admin-api`, `admin-failure`, `admin-copy`, `admin-form`, `admin-fields`        |
|            | `logout`                             | `logout-action`                                                                 |
|            | `nav-icon`                           | `account-nav-icon`                                                              |
| `widgets`  | `account-section`                    | `account-section`, `admin-block` (composes password change and user management) |

The two existing "sideways" dependencies (`admin-copy` reads `account-copy`, `admin-fields` reads
`account-styles`) both point at files that sink into `shared`, so they are not feature-to-feature
imports. `src/client/index.tsx` stays where it is, so the type path `lib/client/index.d.ts` behind
`exports["./client"]` is unaffected.

## Context

D5 (2026-08-30) layered the flat `src/`, and rejected full FSD at the time on the grounds that the
client had only 3 files. As of 0.17.2, `src/client/` has 19 source files, 17 tests and about 5900
lines, all flat, with the `account-` and `admin-` prefixes standing in for grouping; the `src/` root
holds 35 files, of which 24 are tests and 4 are integration helpers.

The host half's dependency graph is itself clean: zero imports between features, and `slice:check`
guards the barrels. Its problems lie elsewhere:

- **The layer names are home-grown.** `gate/`, `session/` and `http/` are called "core mechanism
  layers", and the rules live in the hand-written `verify-slice-boundaries.mjs`, which only this
  repository understands; dsh-lingualab and dsh-plugin-framework use FSD layer names and Steiger.
- **`shared/` is not all leaves.** `users-file.ts` and `password-policy.ts` are the user business
  entity, and `skill-install.ts` depends on the users file for `dshHomeDir`.
- **Half of `http/` is session.** D11 refused to put things like `methodNotAllowed` into
  `session/`, and that reasoning holds; but `handleLogout` and `handleStatus` are session operations
  to begin with, there just was no layer to put them in at the time.
- **Large slices have no internal structure.** `features/password/` has 9 source files and about 30
  tests, flat in a single folder.

Two further holes get fixed along the way:

- `tsconfig.build.json` excludes only `*.test.ts`, so the 4 `integration-*-helpers.ts` files are
  compiled into `lib/` and shipped in the package.
- The build does not empty `lib/`, so CI's `git diff --exit-code -- lib` catches content drift but
  not leftovers. Orphans already exist, `lib/features/session/` and `lib/skill-install.*`, tracked
  by git; unless that is fixed first, this move would leave another batch behind.

## Alternatives Considered

- **Keep D5 as is and only tidy the tests at the root**: this solves most of the "looks messy"
  problem, but the client's flat layout and the host's home-grown layer names both remain, so this
  repository keeps speaking a different dialect from lingualab and plugin-framework.
- **Convert only the client to FSD and leave the host alone**: this was the recommendation of the
  previous evaluation, which assumed lingualab's host was still flat. lingualab has since moved its
  host into the three layers of `src/host/`, so changing only half would leave the two repositories
  inconsistent on the host side.
- **FSD for the host but without the `src/host/` shell**: one fewer directory level, but entry
  points, assembly, the client and every host layer would share one `src/`, and Steiger could not
  analyze only the host half; lingualab's structure has the shell.
- **Copy the client's five layers to the host as is**: `widgets` and `pages` exist to compose UI,
  and the host has no UI to compose.
- **Use ESLint `no-restricted-paths` zones instead of Steiger**: lingualab considered and rejected
  this. Zones only know the up/down order of layers; same-level imports, barrel bypasses and `@x`
  would each need their own rule set, while Steiger has them built in.
- **Leave `handleLogout` and `handleStatus` in `shared/http` and inject the session as a
  parameter**: this avoids `@x`, but every caller must first assemble the session dependencies
  itself; `@x` is the convention FSD offers for exactly this case, and it records the dependency in
  one file named after its consumer.
- **Keep the integration tests at the `src/` root (lingualab's approach)**: lingualab has only 5
  assembly tests; here there are 14 plus 4 helpers, so leaving them at the root does not solve the
  "mess", and the helpers would still be compiled into `lib/` by tsc.

## Why

- **The same structure as the sibling repositories**: dsh-lingualab and dsh-plugin-framework both
  use FSD layer names, with the lower three layers for the host and five for the client. A rule
  learned in either repository holds here too, and an agent does not need to memorize a separate
  "core mechanism layer" scheme just for this one.
- **Checks move to an existing tool**: Steiger ships with same-level isolation, public API, `@x`
  and naming-consistency rules, so the hand-written script only has to keep what Steiger does not
  cover (client and host never import each other, unresolvable imports fail).
- **Layers realign with the dependency graph**: the users file belongs to an entity, session
  operations belong to the session entity, and `shared` goes back to being truly leaf. These
  dependencies already hold today; the directories just do not express them.
- **Two release holes fixed at once**: helpers no longer ship in the package, and `lib/` stops
  accumulating orphans.

## Order of Work

Following lingualab's three-step method, each step keeps `npm run verify` passing, and `git diff -M`
shows only renames and import lines:

1. **Clean up**: empty `lib/` before `build` (every artifact is produced by the build), and delete
   the tracked orphans; move the integration tests and helpers into `test/integration/`, and add
   that location to the vitest `include`.
2. **Untangle in place** (directories do not move): move `dshHomeDir` out of `users-file.ts`; split
   `http/endpoints.ts` into a pure-HTTP part and a logout/status part.
3. **Move the host**: first verify on a branch that Steiger can resolve NodeNext `.js` imports
   (lingualab uses `.ts` suffixes, so this is a risk unique to this repository; if it does not work,
   fall back to extending the hand-written script, and rewrite this record accordingly). Then
   `git mv` into `src/host/`, write the barrels and `@x`, wire in `lint:fsd`, and shrink
   `slice:check` to a half-isolation check; update the `docs/specs/development.md` structure
   diagram, `AGENTS.md`, the bundled skills and every living document that draws the `src/`
   structure; rebuild `lib/`.
4. **Move the client**: settle it into five layers, and `lint:fsd` runs a second pass over
   `src/client`.

When step 3 is done: this record moves into `implemented/` and is registered in `docs/decisions.md`
as D29; D5 and D11 move into `archived/` and their hashes are registered. Old paths cited by
implemented records, `docs/implemented/` and `docs/handoff/` are left alone: they record the code as
it was when they were written.

## Open Questions

- Steiger's `ambiguous-slice-names` and `inconsistent-naming` may force a name change or two
  (lingualab was forced to rename two); decide during the move and write the outcome back into this
  record.
- Whether to split `features/password` further into `login`, `password-change` and `restricted`
  features: they share session issuance, and splitting would introduce feature-to-feature imports,
  so for now it stays one slice with segments.
