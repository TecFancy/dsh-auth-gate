# dsh-auth-gate src directory refactor plan (following the framework layering convention)

> Status: **implemented (2026-08-30)** — `verify` self-check fully green, cross-validation with the framework passed; pending review, then commit / open PR
> Branch: `development`
> Nature: **pure structural refactor** — file moves only + mechanical import updates, zero behavior change
> Reference: the `features/ + shared/ + client/` layering convention of `dsh-plugin-framework` / `dsh-collab`

## 1. Background and motivation

| Item                | Current state                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/` file count   | 52 (26 source + 26 tests), 8202 lines in total                                                                                                                                                                                                                               |
| Directory structure | Besides `client/`, **all 17 service modules lie flat in the root directory**                                                                                                                                                                                                 |
| Module list         | gate / guard / cookie / token-gate / auth-endpoints / password / password-gate / password-endpoints / password-login / session-store / users-file / login-page / rate-limit / form-body / auth-common / self-check / skill-install / proxy / proxy-headers / cli / proxy-cli |

With 21 entry-level file names lined up side by side in the root directory, the point past which a single glance no longer reveals what the system looks like has been crossed; M4 TOTP has not started yet, so now is the **cheapest** moment to refactor (v0.10.0 is already released, PR #53 is parked, not merged).

## 2. Principles: reference, don't copy verbatim

The framework's four-layer tree (`entities/ + features/ + shared/ + client/{features,shared}`) is a teaching template designed for **UI-bearing feature plugins**. auth-gate is a **server-side authentication plugin**; its client half has only 3 files, so copying it verbatim would be over-engineering. Adaptation principles:

1. **Group by authentication surface**: token / password / session each become a feature; the guard is the cross-mode core mechanism and gets its own layer; common utilities go into `shared/`
2. **cli entry points stay at the root**: `package.json` bin points to `lib/cli.js` / `lib/proxy-cli.js`; moving them would widen the change surface, not worth it
3. **Move-only**: `git mv` preserves history, import paths are updated mechanically, **no logic touched along the way**
4. **One PR, one thing**: the refactor PR is strictly separated from the follow-up TOTP / theme / i18n work

## 3. Target directory tree

```
src/
├── index.ts                    # plugin facade: apply / Config / AuthService (untouched)
├── cli.ts                      # bin: dsh-auth (stays at root)
├── proxy-cli.ts                # bin: dsh-auth-proxy (stays at root)
├── client/                     # unchanged: context.ts / index.tsx / logout-action.tsx
│
├── gate/                       # guard core mechanism (cross-mode)
│   ├── index.ts                #   barrel (only cross-slice entry)
│   ├── gate.ts                 #   Gate interface
│   ├── guard.ts                #   webServer wrapper
│   └── self-check.ts           #   startup self-check (depends only on guard)
│
├── session/                    # session layer (core mechanism layer, peers with gate)
│   ├── index.ts                #   barrel
│   └── session-store.ts        #   consumed by both token/password authentication surfaces
│
├── features/                   # authentication surfaces (same-layer slices never import each other)
│   ├── token/
│   │   ├── index.ts            #   barrel (only cross-slice entry)
│   │   ├── token-gate.ts
│   │   └── auth-endpoints.ts
│   ├── password/
│   │   ├── index.ts
│   │   ├── password.ts
│   │   ├── password-gate.ts
│   │   ├── password-endpoints.ts
│   │   └── password-login.ts
│   └── proxy/
│       ├── index.ts
│       ├── proxy.ts
│       └── proxy-headers.ts
│
└── shared/                     # common utilities (leaf layer)
    ├── index.ts                #   barrel
    ├── auth-common.ts          #   validateNext (used in 3 places)
    ├── cookie.ts               #   cookie parsing (used in 4 places)
    ├── form-body.ts
    ├── login-page.ts           #   shared by both modes (token mode renders loginPageHtml too)
    ├── rate-limit.ts
    ├── skill-install.ts        #   cli support (cli only)
    └── users-file.ts           #   users.yaml repo + dshHomeDir resolution, shared by three
```

> 📌 Execution-time corrections (two differences from the first draft, adjusted according to dependency direction):
>
> 1. **`features/session/` → `session/` (demoted to a core mechanism layer)**: the boundary rule "same-layer slices in features never import each other" caught the real dependency token/password → session — session is session infrastructure consumed by both authentication surfaces, not a peer sibling feature; the demotion makes the "layers" match the dependency graph (the plan already drew this edge in §5)
> 2. **`features/login/` → `shared/login-page.ts`**: login-page is shared by both the token and password slices; placing it inside any feature would create cross-slice references; it is itself a dependency-free leaf module, so `shared` fits it best (likewise avoiding same-layer cross-imports within features)
> 3. Every slice/layer directory gets an `index.ts` barrel (the first version uses `export *` to keep the API surface unchanged; it can be tightened to an explicit list later)

## 4. Move manifest (including test files)

| Target               | Source moved in (+ co-located tests)                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gate/`              | gate.ts (+test), guard.ts (+test), self-check.ts (+test)                                                                                                         |
| `session/`           | session-store.ts (+test) (core mechanism layer, not a feature)                                                                                                   |
| `features/token/`    | token-gate.ts (+test), auth-endpoints.ts (+ 4 tests for login/methods/status)                                                                                    |
| `features/password/` | password.ts (+test), password-gate.ts (+test), password-endpoints.ts (+ 6 tests in total: own + login/login-rate/login-reject/methods/status), password-login.ts |
| `features/proxy/`    | proxy.ts (+test), proxy-headers.ts (+test)                                                                                                                       |
| `shared/`            | auth-common.ts, cookie.ts (+test), form-body.ts (+test), login-page.ts, rate-limit.ts (+test), skill-install.ts (+test), users-file.ts (+test)                   |
| **Left at the root** | index.ts (+test, +password.test), cli.ts (+test), proxy-cli.ts (+test), `integration.*.test.ts` ×5, `guard-proxy-deny.test.ts`, `client/`                        |

> The integration tests span multiple modules and, like the index tests, stay at the root (they exercise the whole-plugin assembly); don't force them into any one feature.

## 5. Dependency-direction check (based on existing import edges)

```
root (index/cli/proxy-cli) --> gate / session / features/* / shared (always via barrel)
features/token --> gate / session / shared (always via barrel)
features/password --> gate / session / shared (always via barrel)
session and features/proxy --> leaves; shared may reference itself internally (skill-install → users-file, same layer, fine)
```

- **No circular dependencies** ✓
- **token and password do not depend on each other** ✓ (with login-page in shared, there are no cross-feature references)
- **Same-layer slices in features never import each other** (boundary rule, see §10.2; session was demoted because it is consumed by both authentication surfaces)
- All imports are relative paths, no aliases — plain mechanical replacement, no bundler configuration changes

## 6. Execution steps

1. **Baseline**: `git status` clean (leave the pr53 plan document untouched for now), `npm run verify` green
2. **Batch `git mv`** (source + tests moved together, history preserved) — ✅ done (60 files)
3. **Mechanical import path updates** (file-by-file replacement per the edge tables in §4/§5) — ✅ done (44 files + suffix fixes in 39 files)
4. **Rebuild lib with `npm run build`** (tsc rootDir=src → lib, directory structure maps automatically) — ✅ done (including the `bundledSkillDir()` depth fix: after modules moved from the src root into src/shared, the bundle root goes up two levels)
5. **Commit the lib changes** — CI has a `git diff --exit-code -- lib` gate; **to be executed at commit time**
6. **`npm run verify` fully green** (format / lint / type-check / coverage 80% / lock) — ✅ done (all 9 checks of the extended chain green)
7. **Open the PR to development**; for review use `git diff -M` (rename detection) to verify "pure move", and run through the repo's `.agents/skills/dsh-auth-code-review` checklist (enforcement / lifecycle / disposal / real-path test coverage) — **to be executed after the owner confirms**

## 7. Risks and mitigations

| Risk                                  | Mitigation                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| lib drift gate                        | lib must be committed after every build; an unexpected diff means the build config is at fault first — stop and investigate |
| bin path changes                      | cli / proxy-cli stay at the root; `package.json` bin and tsdown are both untouched                                          |
| PR #53 drift (based on old tree)      | Known and acceptable: it is not going to be merged anyway; hand-merge later or ask the contributor to rebase                |
| Noisy review                          | `git diff -M` for rename detection; **no logic changes smuggled into the move PR**                                          |
| vitest / eslint directory sensitivity | Verified: include/coverage both use the `src/**` glob, eslint scans the whole tree — independent of directories             |
| Acceptance bar                        | verify green + lib identical + no logic diff in `git diff -M` + coverage not dropping                                       |

## 8. Explicitly not doing (out of scope this time)

- Module renames / merges (e.g., abstracting the two endpoints into a generic endpoint registrar)
- Splitting `index.ts` (245 lines of config assembly; can later follow the framework and split out `shared/config`, in a separate PR)
- Reorganizing `client/` (3 files, not worth it)
- Theme hook, login page i18n, M4 TOTP (each in its own PR)

## 9. Suggested follow-up order

1. ~~The refactor PR itself (pure move)~~ ✅ implemented; pending commit / opening the PR
2. Split out `shared/config` + slim down index.ts
3. Script backstop migration (§10) — ✅ implemented (P1 verify-bundle / P2 slice-boundaries / P3 no-emdash all migrated in and chained into the verify chain)
4. Docs practice hardening (§11): align with the complete official ADR suite (three-state directories + bilingual + verify script + curated backfill of 3–5 records), effective before M4
5. M4 TOTP (lands in `features/totp/`)
6. Login page i18n / theme (separate)

## 10. Script and convention backstop migration (framework alignment assessment)

### 10.1 Migration decision table

| framework script                     | Purpose                                          | auth-gate verdict                                                                                                                                                                                                                                                                                                                                                                                                              | Timing             |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `check-lockfile-registry.mjs`        | lockfile restricted to public npm registry only  | ✅ Equivalent already present, not migrating                                                                                                                                                                                                                                                                                                                                                                                   | —                  |
| `run-gates.mjs`                      | gate orchestration                               | ✅ Equivalent already present, not migrating                                                                                                                                                                                                                                                                                                                                                                                   | —                  |
| `verify-bundle.mjs`                  | verifies the client bundle single-file contract  | ✅ **Migrated** — trimmed the three framework-specific checks Typert / data-plugin-css / patch-name (no corresponding mechanism here); kept the banner/footer/id/single-file/size/style.css contract; verified that lib/client.js satisfies the same contract                                                                                                                                                                  | P1 done            |
| `verify-slice-boundaries.mjs`        | layer boundaries (prevent dependency regression) | ✅ **Migrated (parameterized adaptation)** — removed the entities/alias/css logic; layers = root/gate/session/shared/features/client; rules: across slices only via barrels, same-layer within features mutually forbidden, client isolated from host, unresolvable imports fail (fail-closed). **During execution it was found that session is consumed by both authentication surfaces → demoted to a core mechanism layer** | P2 done            |
| `check-no-emdash.mjs`                | forbids `—` (U+2014) in source                   | ✅ **Migrated** — 22 actual occurrences in the existing code (including comments added during execution) all rewritten to compliant punctuation/hyphens; the framework's original script passes when run as-is                                                                                                                                                                                                                 | P3 done            |
| `generate-typert.mjs`                | Typert remote type generation                    | ❌ Not migrating — no Typert boundary                                                                                                                                                                                                                                                                                                                                                                                          | —                  |
| `verify-decision-records.mjs`        | ADR decision-record validation                   | 🔥 **Migrate** — the institutional core validated by the official repo's ten thousand commits (see §11): when the habit is not yet formed, a mechanical constraint is needed more                                                                                                                                                                                                                                              | docs-process batch |
| `check-aliases.mjs` + `aliases.json` | client path-alias consistency                    | ❌ Not migrating — all relative paths, no aliases                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| `create-slice.mjs`                   | FSD slice scaffolding                            | ❌ Not migrating — simplified layering, low cost to add a new feature                                                                                                                                                                                                                                                                                                                                                          | —                  |
| `install-to-profile.mjs`             | local smoke installation                         | ❌ Not migrating — covered by the `dsh-extension-testing` skill + deployment.md                                                                                                                                                                                                                                                                                                                                                | —                  |

### 10.2 verify chain adjustment

```
before:   format:check + lint + type-check + test:coverage + lock:check
now:      format:check + lint + lint:no-emdash + slice:check + lock:check
          + type-check + test:coverage + build + bundle:check
```

With `build + bundle:check` in the verify chain, the lib drift gate moves forward from "CI checks the diff after the fact" to "local verify intercepts it" — double insurance alongside the existing CI `git diff --exit-code -- lib`; the cost is one extra build on each local verify. Compared with the framework's verify chain, the only differences are `aliases:check` (no aliases) and `decisions:check` (migrated in with the ADR batch).

### 10.3 Execution batches (✅ all implemented)

- **P1**: verify-bundle migrated in + build/bundle:check added to the verify chain ✅
- **P2**: slice-boundaries parameterized adaptation + `index.ts` barrel added to slice directories + `slice:check` into verify ✅
- **P3**: existing em-dash cleanup + check-no-emdash migrated in ✅

## 11. ADR decision-record assessment (framework vs auth-gate)

### 11.1 Background correction (important)

The framework's ADR practice was distilled from the **official dsh repository (validated by ten thousand commits)**, not a teaching-template decoration. The key evidence is the framework's own `decision-record-lifecycle` ADR:

- The decision's author initially proposed exactly the "lite version: skip bilingual, skip format scripts", **overturned by a supersede the same day**
- The official conclusion, verbatim: _"before the habit is formed, a mechanical constraint is needed more"_ — **when the habit is not yet formed, a mechanical constraint is needed more**
- The official report's "what not to copy" section also calls out: **defining script rules without real usage samples** encodes wrong rules

Cross-check: auth-gate's existing docs are already in bilingual mode (9 pairs of `.md`/`_zh.md`); commit volume is 131 vs the official tens of thousands. **The three earlier arguments — "bilingual is a maintenance tax", "scripts are a maintenance tax", "the volume is too small to need it" — all collapse**: a small volume is exactly when a mechanical constraint is needed, and bilingual mode continues the existing pattern rather than adding new burden.

### 11.2 Revised conclusion: align with the complete official suite, keeping only pacing control

**Adopted (the full suite):**

1. **Three-state directories** `docs/decisions/{proposed,implemented,archived}/` — status encoded in the path (moving a file changes its status; a path move is harder to bypass than front-matter, per the official argument)
2. **Bilingual pairs** — inside `docs/decisions/`, use the official naming `YYYY-MM-DD-slug.(en|zh).md` (autonomous within the directory; AI-assisted translation keeps the cost manageable)
3. **Four-section format** (Decision/Context/Alternatives Considered/Why) — the "why" layer is exactly what auth-gate lacks (60+ frozen decisions only have a final status)
4. **Migrate `verify-decision-records.mjs` in** and attach it to the verify chain — prevents "the practice decaying before the habit forms", the core value validated by ten thousand commits
5. **A numbered index + template + README for `docs/decisions.md`** — following the framework's D1/D2 numbering style

**Keeping only pacing control (not a simplified practice):**

- **No full backfill of M1–M3** (60+ records; the cost far exceeds the benefit; the official repo does not backfill history either)
- **But curate 3–5 major decisions as backfilled starting samples** (the fail-closed principle, the scrypt choice, the guard wrapping seam, the logoutOrder default …) — this both establishes the habit and avoids the officially called-out pitfall of "defining rules without real samples"
- **From M4 TOTP on, all new decisions go through ADR**; when modifying an already-frozen decision, add a record
- Landed as an **independent docs batch** (not stuffed into the refactor PR), effective before M4 work starts; the convention is written into `docs/specs/development.md`, AGENTS.md only links the index

### 11.3 Remaining details (to decide when starting)

- The script's `FILENAME_RE` requires the `(en|zh).md` suffix, which differs from the `_zh.md` convention of the repo's other docs — either adopt the official naming autonomously within `docs/decisions/` (zero script-change cost, the lowest-option), or parameterize the script to also match `_zh`
