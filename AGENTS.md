# Agent Instructions

Repo-specific rules for any agent (Codex, Claude Code, DeepSeek Harness, ...)
working _on_ this repo. This file is the map: where each kind of fact lives,
and the rules that hold every session.

## What this repo is

`dsh-auth` - an application-layer authentication plugin for the dsh web surface
(a Cordis host-plane plugin row wrapping the `webServer` route tables). It ships
to npm as `dsh-auth-gate`, MIT-licensed.

## Where each kind of fact lives

| Fact kind                                     | Home                                                         | Not there                      |
| --------------------------------------------- | ------------------------------------------------------------ | ------------------------------ |
| Decision rationale (why X, what was given up) | `.agents/notes/implemented/{class}/`                         | `docs/` prose (link the note)  |
| Unbuilt work - the decision                   | `.agents/notes/proposed/{class}/`                            | a planning tree under `docs/`  |
| Unbuilt work - the work order                 | not stored in git                                            | notes (obsolete once it ships) |
| Current state (what is)                       | `docs/architecture.md`, `docs/security.md`, `docs/deployed/` | notes (notes are decisions)    |
| How-to procedure                              | `docs/conventions.md`, `docs/deployed/`                      | notes                          |
| Standing rules                                | `docs/conventions.md`                                        | `CLAUDE.md` (pointer only)     |
| External review evidence                      | `docs/history/reviews/`                                      | notes (evidence, not decision) |
| Frozen historical specs                       | `docs/history/`                                              | `docs/` current pages          |

No `INDEX.md` anywhere: the filesystem tree plus the `README.md` link graph is
the index. Adding a doc means linking it from `docs/README.md`.

## Read these first

- `docs/architecture.md` - the source tree and its layering rules.
- `docs/security.md` - the negative guarantees the plugin must never break.
- `docs/conventions.md` - commands, hooks, gates, style, CI, releases.
- `.agents/notes/README.md` - the note system and when a change owes one.

## Branch model (user preference, 2026-08-14)

- Development happens on `development`; `main` only receives merges from it.
  CI runs on both (push + PR).
- PRs merge into `main` with **squash** (`gh pr merge <n> --squash`): one
  conventional commit per PR, so release-please emits one CHANGELOG entry.
- Never commit or push to `main` directly unless the user says otherwise.
- Promotion PRs (head = `development`): **never** pass `--delete-branch` - it
  deletes the remote `development` branch. See `docs/conventions.md`.

## Commits

- `type: subject` enforced by commitlint; type is one of `feat / fix / docs /
style / refactor / perf / test / build / ci / chore / revert`.
- `.husky/pre-commit` runs Prettier + `eslint --fix` on staged files, then the
  pre-commit gate set. Don't hand-format.
- Never commit or push unless the user asks. Stage explicit paths, not
  `git add -A`; `lib/` must be re-staged alongside `src/` edits.

## Verifying a change

1. **`npm run verify`** - the gate runner over every registered gate plus the
   gate self-tests. Must pass before committing.
2. **`src/` edits require rebuilding `lib/`** (`npm run build`) and committing
   the artifact in the same change. CI fails on drift.
3. **Dependency changes** - always
   `npm install --registry=https://registry.npmjs.org/`; `npm run lock:check`
   fails on any non-public host in the lockfile.
4. Throwaway scripts and fixtures go to a temp dir, not into the repo.

## Code quality

See `docs/conventions.md` "Conventions": strictest TS preset, no `console.*` in
`src/` (log via `ctx.logger`), complexity ≤ 15 / file ≤ 250 / function ≤ 80
lines, explicit comparators for `.sort()`, relative imports end in `.js`, LF
line endings, explicit vitest imports. Don't duplicate those rules here.

## Releases

release-please owns versioning (`.github/workflows/release.yml`):
`feat:`/`fix:` on `main` opens a release PR; merging it tags and publishes.
Never hand-edit `version`, `CHANGELOG.md`, or `.release-please-manifest.json`.
`docs:`/`chore:`/`ci:`/`test:` do not release.

## Repo shape

Feature-Sliced Design (D30, now
`.agents/notes/implemented/architecture/2026-10-12-fsd-host-and-client.md`). The
host half is `src/host/` with the lower three layers; the client half is
`src/client/` with `shared`, `entities`, `features`, `widgets` (no `app`).
Entry points and wiring sit at the `src/` root. Cross-slice imports go through
`index.ts`; features never import each other; the halves never import each
other (`slice:check`). The `/auth/*` paths both halves share live only in
`src/protocol/` (D31); never write a route literal anywhere else. The tree is
in `docs/architecture.md`.

## Agent skills

`.agents/skills/` is the single source of truth; `.claude/skills/` is a
generated, gitignored mirror (`npm run skills:sync`, also run by `npm install`).
`dsh-auth-code-review` (review checklist), `dsh-auth-pre-push` (smallest
evidence before a push), `dsh-auth-doc-sync` (which docs a change owes),
`dsh-auth-gate-config` (shipped config reference, user-invoked only).
