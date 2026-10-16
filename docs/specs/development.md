# Development conventions

Engineering baseline adapted from the `rsp/com` project: strictest TypeScript
preset, flat ESLint with type-checked rules, Prettier, Husky/lint-staged/
commitlint gates, and Vitest with an 80% coverage red line. Everything runs
through one command.

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
| Full gate      | `npm run verify` (format:check + lint + lint:no-emdash + slice:check + lint:fsd + lock:check + decisions:check + docs:check + readme:parity + type-check + test:coverage + build + bundle:check + host:check; full set - CI, not every local run)                          |
| Host contract  | `npm run host:check` (self-test, then: package name = Loader row = client registration id = host `name`; manifest targets exist; client `require`s are seeded host modules; no route literal outside `src/protocol/`, every protocol path registered, README routes exist) |
| Docs gate      | `npm run docs:check` (bilingual pairing + 50 KiB size red line + duplicate H2-H4 headings, root READMEs included; part of `verify` and of CI `hygiene` - see `docs/README.md` "文档规范")                                                                                  |

Run a single test file: `npm run test -- src/host/shared/guard/guard.test.ts`
Run tests by name: `npm run test -- -t "guard"`

## Git hooks

- `pre-commit`: lint-staged (Prettier + `eslint --fix` on staged files).
- `commit-msg`: commitlint — Conventional Commits, pinned type set
  (`feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert`).
- `pre-push`: `npm run gates -- --base @{u}` — picks the minimal evidence set
  for the change surface (unpushed commits + uncommitted changes); full
  coverage is CI's job.

## Structure

Feature-Sliced Design layout (D30, see [`docs/decisions.md`](./decisions.md)). The host half
uses the lower three of FSD's six layers under `src/host/`; the entry points and wiring sit
at the `src/` root, beside the analysed tree. The client half uses the layers it needs of the
five under `src/client/` (no `app`: a plugin owns no application shell), with `index.tsx` at
the root of its tree.

```
src/
├── index.ts               # plugin entry + auth service wiring (mode picks the password or token flow)
├── cli.ts                 # dsh-auth user-management CLI (bin entry)
├── proxy-cli.ts           # dsh-auth-proxy (bin entry)
├── admin-wiring.ts        # root-side assembly of the admin routes (P2)
├── token-resolver.ts      # shared-token credential resolver (token mode)
├── launch-token-bridge.ts # 0.1.2-alpha launch-token compatibility layer (M2)
├── cli-skill.ts           # `dsh-auth skill install`
├── *.test.ts              # root tests: entry points, CLI, manifest checks (host-corridor, manifest-*)
├── protocol/              # cross-half contract (D31): /auth paths, login URL builders (index.ts) and
│                          # request/response/error payload types (payloads.ts); imports nothing
├── host/                  # host half: three FSD layers, analysed by Steiger (`npm run lint:fsd`)
│   ├── shared/            #   layer without slices: segments only, each with its own index.ts
│   │   ├── guard/         #     Gate vocabulary, webServer wrapping and deny pipeline, startup self-check
│   │   ├── http/          #     cookie / form body (+ typed `formField`) / Origin / Host / client IP / `next` / login redirect,
│   │   │                  #     plus the session-independent authCatchAll, queryOf, methodNotAllowed
│   │   ├── login-page/    #     self-contained login page (token, password and TOTP challenge variants)
│   │   ├── protocol/      #     bridge to src/protocol: the host half's only way in
│   │   ├── rate-limit/    #     two-bucket login rate limiter
│   │   ├── skill/         #     `dsh-auth skill install`
│   │   └── lib/           #     leaf helpers (`dshHomeDir`)
│   ├── entities/
│   │   ├── session/       #     model/ session-store; api/ logout and /auth/status (AuthHttpDeps)
│   │   └── user/          #     model/ users-file (users.yaml), password-policy;
│   │                      #     @x/session.ts exposes only `UsersLoadResult` to the session entity
│   └── features/          #     slices never import each other; cross-slice goes through index.ts
│       ├── token/         #       api/ /auth endpoints; model/ TokenGate
│       ├── password/      #       api/ endpoints + password change; model/ gate, login, session issue,
│       │                  #       restricted session, challenge cookie, disabled-user sweeper, login notice;
│       │                  #       lib/ scrypt; ui/ server-rendered failure and password-change pages
│       ├── totp/          #       lib/ RFC 6238; model/ replay guard; cli/ enable and disable subcommands
│       ├── admin/         #       api/ endpoints and responses; model/ audit, reset steps, user list, deps
│       └── proxy/         #       model/ local reverse proxy and header filtering
└── client/                # client half: five FSD layers, analysed by Steiger, never imports the host half
    ├── index.tsx                 # bundle entry (tsdown) and host slot wiring; root of the analysed tree
    ├── shared/                   # segments only, each with its own index.ts
    │   ├── api/                  # `AuthContext` (local mirror of the host slot context, types only),
    │   │                         # `protocol.ts` (the client half's bridge to src/protocol) and
    │   │                         # `encodeForm` (form body from a contract-typed request object)
    │   ├── i18n/                 # account copy: keys, zh/en dictionaries, translate helpers
    │   └── ui/                   # shared inline styles and the account icon paths
    ├── entities/
    │   └── account/              # api/ `useAccountStatus` and the `AccountStatusView` it parses into
    ├── features/                 # slices never import each other; cross-slice goes through index.ts
    │   ├── change-password/      # ui/ form and fields; model/ validation and submit; lib/ redirect
    │   ├── admin-users/          # api/ list and reset requests; model/ form and result types;
    │   │                         # lib/ copy and failure mapping; ui/ form
    │   ├── logout/               # ui/ logout settings action
    │   └── nav-icon/             # ui/ settings-nav icon shim (DOM)
    └── widgets/
        └── account-section/      # ui/ the "Account security" section; composes password change and user management
```

Unit tests live next to their source file, inside the same segment.

```
test/               # test code outside src (not compiled into lib, not in coverage)
├── integration/    #   integration.*.test.ts: real cordis/webserver/storage stack
│                   #   + integration-*-helpers.ts (enter src through slice or segment index.ts)
└── *-harness.ts    #   shared unit-test harnesses (not .test.ts, so vitest does not collect them)
lib/                # build output (host under lib/host/) - COMMITTED (see below), never hand-edited
```

Layering is enforced by two gates. `npm run lint:fsd` runs Steiger once per half, over `src/host` and over `src/client` (layer
order, same-layer isolation, public API through `index.ts`, `@x` cross-imports, naming).
`npm run slice:check` keeps only what Steiger cannot see: the client and host halves never
import each other, root files enter `src/host` only through a slice or segment `index.ts`,
`src/protocol/` imports nothing outside itself and is entered only through its `index.ts` by
the two bridges (`src/host/shared/protocol/index.ts`, `src/client/shared/api/protocol.ts`),
unresolvable relative imports fail, and every file under `src/` is a root file, under
`src/protocol/`, under `src/host/{shared,entities,features}/`, `src/client/index.tsx` or `src/client/index.test.tsx`,
or under `src/client/{shared,entities,features,widgets,pages}/`. Adding or removing a slice
means updating this tree.

The wire shapes of the `/auth/*` endpoints (status, user list, password change and admin reset
request, response and error bodies, plus `UserRole`, `SessionKind` and `PasswordRule`) are pure
types in `src/protocol/payloads.ts`, re-exported by `src/protocol/index.ts` and reached through the
same two bridges. Never redeclare one of them in either half: the host types its writers and
`formField<Request>(params, name)` reads with them, the client annotates its request objects for
`encodeForm` and reads response bodies through `Unchecked<T>` (contract keys, `unknown` values,
still validated field by field). `shared` is the lowest layer, so every host or client layer reaches
them without an `@x` import.

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
    (`docs/specs/dsh-auth-plan.md` §4) is allowed.
- **TODO discipline**: inline TODO/FIXME carry a stable tag naming the smell
  (e.g. `TODO(auth-token-gate):`), say why it is safe to revisit, and name the
  action. No TODOs for speculative complaints.
- **GUI demos**: a change to user-visible web behavior (login page, redirects,
  handshake rejections) must ship with a demonstration recorded from the real
  flow — real server booted from that branch, clean browser state, no fixture
  or mock transport. State what the recording proves next to the embed.

## Decision records

重大决策记 ADR（对齐 dsh-plugin-framework 制度，见 [`docs/decisions/README.md`](./decisions/README.md)）：

- **三态目录** `docs/decisions/{proposed,implemented,archived}/`，状态由路径表达，移动文件即改状态。
- **双语成对** `YYYY-MM-DD-slug.{zh|en}.md`，`implemented/`/`archived/` 必须齐全；`proposed/` 允许单语。
- **四段式**：决定了什么（Decision）/ 背景（Context）/ 考虑过的替代方案（Alternatives Considered）/ 为什么这样选（Why）——「为什么层」是记录的核心价值。
- **强制检查** `npm run decisions:check`：文件名、必需章节、双语配对、归档哈希冻结（`.manifest.json` 只追加）；已挂 verify 链与 CI。
- **写与归档的判据**：有被认真考虑过的替代方案、或将来的人会重新踩一遍想清楚的坑 → 写；未来还需不需要靠它做决定 → 决定归档与否；归档 = 冻结，改动走新记录 + 链接。
- 索引页 `docs/decisions.md`（一句话摘要 + 链接）；M1–M3 冻结表仍以 `docs/implemented/impl-mN.md` 为执行权威。

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
  cohort (`dsh-host-webserver`, `dsh-storage`, `dsh-storage-domain`, `dsh-storage-json`)
  follows the corridor floor (`^0.2.0-rc.1`). `docs/implemented/impl-m1.md` §3
  records the original `^0.1.0-rc.6` pin as frozen history, not as current policy.
- `lint-staged` stays on `^16.1.0`: 17.x requires Node ≥ 22.22.1, dev machines
  may run earlier 22.x.
