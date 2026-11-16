# Conventions

[中文](conventions_zh.md)

The standing rules: commands, hooks, gates, code style, commit messages, CI and
releases. Every agent and every contributor works from this file.

For the source tree and its layering rules, read [architecture.md](architecture.md).
For the negative guarantees the plugin must never break, read
[security.md](security.md). For why a decision was made, read the Agent Note it
links to.


## Commands

| Task           | Command                                                                                                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type-check     | `npm run type-check` (`tsc -p tsconfig.json --noEmit`)                                                                                                                                                                                                                     |
| Lint           | `npm run lint` (flat ESLint, type-checked)                                                                                                                                                                                                                                 |
| FSD layering   | `npm run lint:fsd` (Steiger over `src/host` and `src/client`; layer order, same-layer isolation, public API, naming)                                                                                                                                                       |
| Format         | `npm run format` / `npm run format:check`                                                                                                                                                                                                                                  |
| Tests          | `npm run test` (Vitest, `vitest run`)                                                                                                                                                                                                                                      |
| Watch tests    | `npm run test:watch`                                                                                                                                                                                                                                                       |
| Coverage       | `npm run test:coverage` (v8, 80% branches/functions/lines/statements)                                                                                                                                                                                                      |
| Build          | `npm run build` (empties `lib/` first, then tsc emit + client bundle; LF newlines, declarations + source maps)                                                                                                                                                             |
| Scenario gates | `npm run gates` (auto-detects the change surface; pre-push runs this)                                                                                                                                                                                                      |
| Full gate      | `npm run verify` (the gate runner over every registered gate, plus the gate self-tests; the full set is CI, not every local run) |
| Host contract  | `npm run host:check` (self-test, then: package name = Loader row = client registration id = host `name`; manifest targets exist; client `require`s are seeded host modules; no route literal outside `src/protocol/`, every protocol path registered, README routes exist) |
| Docs gate      | `npm run docs:check` (reachability from the entry points, relative links and fragments, size red line, duplicate H2-H4 headings) |
| Market shots   | `npm run screenshots:check` (root `screenshots.json`: 1-8 raster images, relative paths inside the repo, every file present; the market card reads this list, not the README)                                                                                              |
| Doc budgets    | `npm run docs:budgets` (`AGENTS.md` and `docs/conventions.md` stay under the word ceilings in `scripts/doc-budgets.json`) |
| Notes gate     | `npm run notes:check` (the `.agents/notes/` tree shape, `Status:` against the lifecycle folder, the body skeleton) |
| Note links     | `npm run notes:links` (relative links in the note tree resolve, stay in the repo, and match locale) |
| Archive seal   | `npm run archives:check` (every sealed artifact matches its SHA-256; the manifest may only grow, compared against the PR base in CI) |
| Bilingual gate | `npm run bilingual:check` (pairing, sidecar hashes, language switcher, heading parity, structural signature) |
| Chinese prose  | `npm run zh:prose` (full-width punctuation, corner-bracket quotes, mixed-script spacing, the terminology table's forbidden renderings) |
| Skills         | `npm run skills:check` / `skills:frontmatter` / `skills:links` (the generated mirror, the front matter a consumer parses, the links inside a skill) |
| Gate runner    | `npm run gates:check` (every registered gate) / `npm run gates:self-test` (the negative cases those gates exist to reject) |

Run a single test file: `npm run test -- src/host/shared/guard/guard.test.ts`
Run tests by name: `npm run test -- -t "guard"`

## Git hooks

- `pre-commit`: lint-staged (Prettier + `eslint --fix` on staged files).
- `commit-msg`: commitlint — Conventional Commits, pinned type set
  (`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`).
- `pre-push`: `npm run gates -- --base @{u}` — picks the minimal evidence set
  for the change surface (unpushed commits + uncommitted changes); full
  coverage is CI's job.

## Committed build artifact

`lib/` is generated by `npm run build` (`scripts/clean-lib.mjs` empties it, then
`tsc -p tsconfig.build.json`, `tsdown`, `tsc -p tsconfig.client.build.json`) and is
**committed**, never hand-edited, so it is exactly the build output with no orphans:

- consumers installing this package from git (`dsh plugin add <git-url>`) get
  a working package without build tooling on the server;
- `npm pack`/`npm publish` ship exactly the same tree (`prepack` rebuilds
  first);
- CI verifies parity: `git diff --exit-code -- lib` after a fresh build fails
  the job when someone commits a stale artifact.

`tsconfig.build.json` pins `newLine: "lf"` so the emitted artifact is
byte-stable across Windows/Linux builders.

## Conventions

- **TypeScript strictest preset**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, `verbatimModuleSyntax`,
  `noUnusedLocals/Parameters`. NodeNext module resolution: relative imports
  end in `.js`.
- **No ambient globals in tests**: import `describe/it/expect` from `vitest`.
- **No `console.*` in `src/`** (ESLint error). Log through the cordis
  `ctx.logger`; scripts/config files are exempt.
- **Complexity/length caps** (ESLint errors, not baselined):
  complexity ≤ 15, file ≤ 250 lines, function ≤ 80 lines (blank/comment lines
  excluded). Split instead of exceeding.
- **`.sort()`/`.toSorted()` require an explicit comparator** — default
  lexicographic order is unreliable outside plain ASCII.
- **Line endings LF everywhere** (`.editorconfig` + `.gitattributes`), Prettier
  defaults: 100 width, double quotes, trailing commas.
- **Example domains**: the real deployment domain never enters the repo. Docs, deploy
  samples, tests, code defaults and screenshots use the RFC 2606 reserved `example.com`
  (`dsh.example.com`; isolated instances `dsh-test.example.com`) - the published tarball
  ships `lib/`, `docs/demo/` and `.agents/skills/` (D16).
- **Commit style**: `type(scope): subject`, scope is a module name
  (`guard`, `session-store`, `ci`). Conventional commits drive releases
  (see below).
- **Prose**: write enough to preserve the contract, then remove the rest.
  - Public JSDoc documents caller-visible return distinctions,
    throws/rejections, side effects, ownership, timing, cancellation, and
    durability.
  - Comments state non-obvious contracts only (invariants, race ordering,
    security boundaries); no control-flow narration, no code restatement.
  - README carries the consumer contract: configuration, semantics, failure
    modes, limitations, extension points.
  - One explanation has one home; repeat only essential contract facts
    locally and link the rationale.
  - No leaked reasoning transcripts: no citations of uncommitted drafts or
    design-session artifacts (decision numbers, `§N` of a draft), no change
    narration ("used to", "no longer", "this PR"), no reviewer-addressed
    justifications. State the present behavior; deferred work becomes
    `TODO(<tag>):` or an issue reference. A resolvable committed-doc citation
    (`docs/history/specs/dsh-auth-plan.md` §4) is allowed.
- **TODO discipline**: inline TODO/FIXME carry a stable tag naming the smell
  (e.g. `TODO(auth-token-gate):`), say why it is safe to revisit, and name the
  action. No TODOs for speculative complaints.
- **GUI demos**: a change to user-visible web behavior (login page, redirects,
  handshake rejections) must ship with a demonstration recorded from the real
  flow — real server booted from that branch, clean browser state, no fixture
  or mock transport. State what the recording proves next to the embed.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR, on
**both ubuntu-latest and windows-latest** (fail-fast disabled): `npm ci`,
format check, lint, no-emdash, slice boundaries, FSD layering (Steiger), decision records, type-check,
coverage tests, build, bundle check, host contract check, then two parity gates:

1. **Committed artifact parity**: `git diff --exit-code -- lib` after the fresh
   build — the committed `lib/` must equal a clean build.
2. **Consumer install simulation**: fresh clone + `npm install --omit=dev` —
   the guarded `prepare` script (husky is a devDependency) must not fail, the
   same environment `dsh plugin add <git-url>` runs in.

## Releases (release-please)

Versioning is fully automated from conventional commits on `main`
([release-please](https://github.com/googleapis/release-please)):

- Merging a `feat:`/`fix:` commit to `main` makes the Release workflow open a
  **release PR** that bumps `package.json`, updates `CHANGELOG.md`, and records
  the new version in `.release-please-manifest.json`;
- Merging that PR creates the git tag + GitHub Release;
- Never hand-edit `version`, `CHANGELOG.md`, or the manifest — edit them only
  by re-running release-please locally (or let the PR own them);
- When the release PR is merged, the Release workflow (`release.yml`) also
  publishes to npm (`dsh-auth-gate`, MIT-licensed); consumers can additionally
  install from git or a local tarball (`npm pack`).

**npm authentication is Trusted Publishing (OIDC), not a token.** The `publish`
job holds `id-token: write` and no `NPM_TOKEN` secret exists. npm exchanges the
job's GitHub-signed identity for a short-lived publish token, so there is
nothing long-lived to leak or rotate. Three things must stay true or publishing
breaks with a bare `ENEEDAUTH`:

- the trusted publisher on npmjs.com names this repository and the workflow
  filename `release.yml` — renaming the file means updating npm first;
- the job keeps `id-token: write` (the top-level `permissions` block does not
  grant it);
- `actions/setup-node` is **not** given `registry-url`. That input writes
  `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc`; with no
  token it expands to an empty string, npm reads it as "auth already
  configured", skips the OIDC exchange and fails
  ([actions/setup-node#1551](https://github.com/actions/setup-node/issues/1551)).
  The repo `.npmrc` already pins the public registry.

Node 24 is pinned because Trusted Publishing needs npm ≥ 11.5.1, and Node 22
ships npm 10.9.x. `--provenance` is not passed: a trusted publish attests
automatically.

**Merge policy.** Feature/PR workflows merge into `main` with **squash** —
each PR lands as exactly one conventional commit (the PR title):
`gh pr merge <n> --squash`. Squash is required, not optional: release-please
parses the merged branch's commits _and_ (for a merge commit) the merge
commit's linked PR title, so a merge-commit merge records every change twice
in the CHANGELOG — the 0.6.0–0.6.4 notes each show the same `client:`/`fix:`
change under two SHAs (branch commit + merge commit). With squash there is no
merge commit and each PR contributes exactly one changelog entry.

`docs:`/`chore:`/`ci:`/`test:` commits do not trigger a release. 0.x
semantics: `fix:` → 0.0.x, `feat:` → 0.x.0.

**Release notes vs. the changelog.** release-please writes both the CHANGELOG entry and the GitHub
Release body from the **subject line** of each commit on `main`: commit bodies, PR descriptions and
the hidden types (`docs:`/`chore:`/`ci:`/`test:`/`build:`/`refactor:`/`style:`) never appear, which
is why the changelog carries only `Features` and `Bug Fixes` sections. A promotion PR is squashed
into one commit, so a **batch** of changes promoted together yields a single entry: promote one
change per PR when each deserves its own line, or accept the terse entry and curate the release page
once the tag exists (`release-pr`, then `wait-publish`, then):

```bash
gh release edit v<version> --notes-file notes.md
```

Curating the release body is the one sanctioned hand-edit; `CHANGELOG.md` itself stays generated (see
above), so the two surfaces differ by design. Keep the PR number in the squash subject
(`<title> (#<n>)`) so the generated entry still links the discussion.

## Branch hygiene

Two mistakes from 2026-08-30 promotion runs that cost a fix cycle — both are
now documented so nobody re-learns them:

- **`--delete-branch` on a promotion PR deletes remote `development`.** When
  the PR's head branch is `development` (the normal development→main path),
  `gh pr merge <n> --squash --delete-branch` deletes the remote
  `development` branch after merging. Consequences: the next
  `git push origin development` prints `[new branch]`, and any fetch/pull of
  `development` fails with `couldn't find remote ref development`. → Never
  pass `--delete-branch` on promotion PRs; merge with plain
  `gh pr merge <n> --squash`. If it happens anyway, recreate immediately:
  `git push origin development` (local branch history is intact).
- **A commit can land on local `main` by accident** (e.g. you are on `main`
  without noticing). `main` only receives squash merges, so move the commit
  back and reset the local pointer:
  `git checkout development && git cherry-pick <sha> && git branch -f main origin/main`.
  The stale commit stays in the reflog; `origin/main` is untouched until you
  push — never push `main` while it deviates.

## Dependency notes

- **Registry discipline**: `package-lock.json` is generated strictly against
  the public npm registry, and `npm run lock:check` (part of `verify` and CI)
  fails on any other host — GitHub runners cannot reach the internal Nexus
  this machine points `NPM_CONFIG_REGISTRY` at. `.npmrc` sets
  `replace-registry-host=never` so local installs fetch the public URLs
  verbatim (this machine reaches npmjs directly). When adding or updating
  dependencies, always run
  `npm install --registry=https://registry.npmjs.org/`.
- `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `zod` are runtime deps
  (all public on npmjs).
- `@deepseek-ai/dsh-storage-domain` is a **peer** declared with the same corridor string as
  `engines.dsh` (`^0.1.0-rc.6 || ^0.1.5-rc.2 || ^0.1.7-alpha.1 || >=0.2.0-rc.1`, see D28).
  The three caret alternatives record the host lines that were verified; the trailing floor
  keeps every later host version compatible, so a new dsh line never needs a hand-added
  alternative. The gate evaluates peer ranges with `includePrerelease`, and a plugin it
  rejects is skipped silently, which is why the declaration errs wide. The dev/test host
  cohort (`dsh-host-webserver`, `dsh-storage`, `dsh-storage-domain`, `dsh-storage-json`) is
  pinned at `0.2.2-rc.1`, the first line whose routes may be `{ resource }`; that pin is what
  lets the integration suite mount the real `/plugins` resource prefix and the SPA resource
  fallback (`@deepseek-ai/cordis` follows at `4.1.0`). The peer declaration above keeps the
  wide corridor regardless. `docs/history/specs/impl-m1.md` §3 records the original `^0.1.0-rc.6`
  pin as frozen history, not as current policy.
- `lint-staged` stays on `^16.1.0`: 17.x requires Node ≥ 22.22.1, dev machines
  may run earlier 22.x.

## Decision records

A decision that had a real alternative, or that a future reader would otherwise
re-litigate, gets an Agent Note in `.agents/notes/`. The rules live in
[.agents/notes/README.md](../.agents/notes/README.md); the short version:

- `proposed/` for unbuilt work, `implemented/` for what shipped, `rejected/` for
  what was declined, `archived/` for frozen history.
- Each note is a triplet: `foo.md` (English), `foo.zh.md` (Chinese), and
  `foo.i18n.yaml` (the confirmed-consistent blob hashes).
- A note records the decision, not the work order: no whole-file dumps, no
  numbered procedures, no command recipes.
- `npm run notes:check` enforces the tree shape and the in-file format;
  `npm run notes:links` enforces the links; `npm run bilingual:check` keeps the
  pair honest.

The legacy numbered ADRs (D1-D38) were migrated into this tree; each note keeps
its `Legacy ID: D<n>` line so a code comment citing `D31` still resolves.
