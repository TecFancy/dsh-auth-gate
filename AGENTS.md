# Agent Instructions

Repo-specific rules for any agent (Codex, Claude Code, DeepSeek Harness, ...)
working _on_ this repo. Auto-discovered by agents that read `AGENTS.md` from
the project root.

## What this repo is

`dsh-auth` — an application-layer authentication plugin for the dsh web
surface (a Cordis host-plane plugin row wrapping the `webServer` route
tables).

- **Architecture & roadmap**: `docs/specs/dsh-auth-plan.md` (threat model, guard
  seam design, phased plan M0–M4). Read it before touching `src/`.
- **M1 executable spec**: `docs/implemented/impl-m1.md` (frozen decisions D1–D16, verified
  mount-point contracts, file blueprints, test matrix, DoD). It is the sole
  authority for M1 implementation; where plan and spec conflict, the spec
  wins. Cite only harness internals that appear in its §2 — never explore
  further.
- **M2 executable spec**: `docs/implemented/impl-m2.md` (frozen decisions M1–M22 for the
  shared-token gate). **M2 execution starts by reading `docs/handoff/handoff-m2.md`**
  (environment facts, server verification workflow, M1 pitfalls) — a new
  session has no prior context.
- **M3 executable spec**: `docs/implemented/impl-m3.md` (frozen decisions P1–P26 for the
  password flow: users.yaml + scrypt + rate limiting + `dsh-auth user` CLI).
  **M3 execution starts by reading `docs/handoff/handoff-m2.md`** (environment facts
  still valid) and finishes by writing `docs/handoff/handoff-m3.md` for M4.
- **Agent skills** (`.agents/skills/`, auto-discovered by dsh):
  - `dsh-auth-code-review` — review checklist for changes here: enforcement,
    lifecycle, disposal, real-entry-path tests, prose contracts.
  - `dsh-auth-pre-push` — smallest relevant evidence before a push;
    force-with-lease discipline.
- **Engineering conventions**: `docs/specs/development.md` (commands, hooks, gates,
  release flow). Authoritative for the rules summarized below — update it
  there, not here.

## Branch model (user preference, 2026-08-14)

- Development happens on `development`; `main` only receives merges from
  `development`. CI runs on both branches (push + PR).
- PRs merge into `main` with **squash** (`gh pr merge <n> --squash`): one
  conventional commit (the PR title) per PR, so release-please emits one
  CHANGELOG entry per change. Merge commits double-count (see
  `docs/specs/development.md` "Releases").
- Never commit or push to `main` directly unless the user says otherwise —
  always work on `development`.
- Merging promotion PRs (head = `development`): **never** pass
  `--delete-branch` — it deletes the remote `development` branch (recreate it
  immediately with `git push origin development` if it happens anyway). See
  `docs/specs/development.md` "Branch hygiene".

## Commit conventions

- `type: subject` enforced by commitlint (`.husky/commit-msg`); type is one
  of `feat / fix / docs / style / refactor / perf / test / build / ci / chore
/ revert`.
- `.husky/pre-commit` runs Prettier + `eslint --fix` on staged files — don't
  hand-format, don't fight the reformatted diff. `.husky/pre-push` runs the
  full type-check.
- Never commit unless the user asks. Never push unless the user asks.
- Stage explicit paths rather than `git add -A`; check `git status` first —
  `lib/` must be re-staged alongside `src/` edits (see below).

## Verifying a change actually works

1. **`npm run verify`** — format check + lint + type-check + coverage tests
   (80% red line) + `lock:check`. Must pass before committing.
2. **`src/` edits require rebuilding `lib/`** (`npm run build`) and committing
   the regenerated artifact in the same change. `lib/` is generated, never
   hand-edited, and CI fails on drift (`git diff --exit-code -- lib`).
3. **Dependency changes** — always
   `npm install --registry=https://registry.npmjs.org/` (the machine's
   `NPM_CONFIG_REGISTRY` points at an internal mirror GitHub runners cannot
   reach; `npm run lock:check` fails on any non-public host in the lockfile).
4. Write throwaway scripts/fixtures to a temp dir, not into the repo.

## Code quality

See `docs/specs/development.md` "Conventions" — strictest TS preset, no `console.*`
in `src/` (log via `ctx.logger`), complexity ≤ 15 / file ≤ 250 / function ≤
80 lines, explicit comparators for `.sort()`/`.toSorted()`, relative imports
end in `.js`, LF line endings, explicit vitest imports (no ambient globals).
Don't duplicate those rules here.

## Releases

Versioning is owned by release-please (`.github/workflows/release.yml`):

- `feat:`/`fix:` commits on `main` trigger a release PR (version bump +
  `CHANGELOG.md`); merging it creates the tag + GitHub Release.
- Never hand-edit `version`, `CHANGELOG.md`, or
  `.release-please-manifest.json`. `docs:`/`chore:`/`ci:`/`test:` commits do
  not release.

## Repo shape

See `README.md`. Docs live under `docs/` (plan + development conventions);
build output under `lib/`; CI parity checks under `.github/workflows/`.
