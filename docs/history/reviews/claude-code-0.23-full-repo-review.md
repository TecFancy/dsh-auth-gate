# Claude Code Review — dsh-auth-gate 0.23 full-repo review

- **Date**: 2026-11-22
- **Reviewer**: Claude Code (`claude-agent-sdk`, read-only), four parallel agents with disjoint
  scopes: the guard core and wiring, the host authentication flows, the React client half, and the
  engineering system (docs, gates, CI, release, packaging)
- **Scope**: the whole repository at `development` `494df74` (`0.23.0`); `main` at `5ebedbd`
  (`0.23.1`)
- **Verdict**: request-changes — eleven P1 findings, no P0; the fail-closed core and the credential
  paths are sound, the gaps are in the invariants around them
- **Standards**: repo `AGENTS.md`, `docs/security.md`, `docs/conventions.md`,
  `.agents/skills/dsh-auth-code-review`

## Summary

The gate suite was green at the reviewed commit (22 gates plus 12 gate self-tests, exit 0), so none
of the findings below is something a routine check would have caught. They cluster into three
themes.

1. **Rate-limit and lockout invariants hold only for a serial client.** The limiter's check, the
   password verification and the failure record are separated by awaits with nothing reserving a
   slot; the lockout backoff exponent is always zero; the TOTP stage shares its bucket with the
   password stage and has that bucket cleared by a correct password; token mode has no limiter at
   all. Each is individually small and jointly they mean the five-failure lock is close to
   decorative on a concurrent attacker.
2. **Fail-closed guarantees hold only at startup.** Route registration has no partial-failure
   rollback, so a duplicate path from another plugin leaves guarded routes pointing at a handler
   whose plugin is gone; `unwrap` restores `server.register*` unconditionally, so a foreign wrapper
   layered on top is silently discarded.
3. **The documentation describes a smaller system than the one shipped.** `docs/architecture.md`
   and `docs/security.md` mention passkey zero times, and `security.md` §4 states the cross-site
   bounce runs before the gate decides when the code runs it after the gate allows. In a repository
   where the docs are the contract, that is a defect rather than a wording preference.

The engineering half adds two release-path gaps: the publish job runs no verification at all, and
the committed-`lib/` parity check cannot see untracked build output.

## Method and limits

Four Claude Code subagents ran in parallel, each with a disjoint read scope and all read-only. The
sandbox denied Bash to three of them (non-interactive `dontAsk` mode), so those reports rest on
reading code only; the engineering agent had `grep`, `ls` and `wc` but no `node` or `npm`. No
reviewer ran a gate, a test, a type-check or `npm pack`.

The coordinating session then re-read the source for every P1 and most P2 claims, and rejected one
finding outright (see "Rejected and corrected findings"). The **Status** column below records that
work:

- **verified** — the lead confirmed the mechanism in the cited code at `494df74`;
- **reviewer-only** — plausible and specific, but not re-checked; treat it as a lead, not a fact.

The reviewers' own coverage gaps are listed at the end. Nothing in the repository was modified.

## Gate baseline

`npm run verify` at `494df74`: **OK, 22 gates and 12 gate self-tests, exit 0** (2026-11-22 02:12).
Coverage came from the same run. This baseline is the reason the findings are framed as "the gates
do not catch this" rather than "CI will tell you".

## Findings

Severity uses the reviewers' P1/P2 scale: P1 is "should fix before the next feature work", P2 is
"nice to have, schedule it", S is a suggestion. IDs are by area: `G` guard and wiring, `L` login and
credential flows, `C` client, `E` engineering.

### P1 — should fix before the next feature work

| ID  | Area   | Finding                                                                    | Status   |
| --- | ------ | -------------------------------------------------------------------------- | -------- |
| G1  | guard  | Partial route registration leaks routes when a later `register` throws     | verified |
| L1  | flows  | TOTP attempt cap is reset by re-submitting the correct password            | verified |
| L2  | flows  | Lockout backoff never escalates, and `maxDelaySeconds` is dead             | verified |
| L3  | flows  | Rate-limit check, verify and record are not atomic                         | verified |
| L4  | flows  | Token mode has no rate limiting and no entropy floor                       | verified |
| L5  | flows  | CLI `user passwd` does not revoke sessions, contradicting `security.md` §6 | verified |
| C1  | client | Expired session and `bad_origin` are shown as "current password is wrong"  | verified |
| C2  | client | The logout-order probe can leak a mounted settings item                    | verified |
| C3  | client | A failed list reload is a no-op and leaves a stale list beside "success"   | reviewer |
| E1  | eng    | The publish job ships without verification and is not tied to CI           | verified |
| E2  | eng    | The `lib/` parity check cannot see untracked build output                  | verified |

#### G1 — Partial route registration leaks routes and blocks a re-apply

- **Where**: `src/bootstrap-wiring.ts:133-142`, and the same inline shape in the token, password,
  passkey and admin endpoint collectors.
- **What**: `const disposers = [register(a), register(b), register(c)]` builds the array in one
  expression. If the second `register` throws, the first route is already in the host's table but
  its disposer was never stored.
- **Impact**: `apply` aborts, yet the earlier routes stay registered and guarded, pointing at
  handlers whose plugin has unmounted. A retry then trips "duplicate route" on the leftovers and the
  process has to restart. This is the per-entry rollback discipline `security.md` §2 requires for
  `wrapServer`, not applied to the endpoint collectors.
- **Fix**: one shared `mountRoutes()` that pushes each disposer as it is obtained and runs the
  collected ones in reverse on failure, so the five copies cannot drift.
- **Status**: verified at `bootstrap-wiring.ts`; the four collectors share the shape.

#### L1 — The TOTP attempt cap does not exist in practice

- **Where**: `src/host/features/password/model/password-login.ts:178-184`;
  `src/host/features/password/model/password-login.totp.ts:28,38,48,57`.
- **What**: Before issuing the challenge cookie, stage one calls
  `limiter.recordSuccess(ip, accountKey)`, which deletes both the IP and the account bucket. The TOTP
  stage then checks and records failures against the **same** `(ip, username)` keys.
- **Impact**: An attacker who already holds the password gets four wrong codes, re-posts the correct
  password to reset the counter, and repeats indefinitely. Against a six-digit code inside a ±1-step
  window this is a practical brute force, and it defeats exactly the credential-stuffing case the
  second factor exists for.
- **Fix**: give TOTP its own bucket, or clear the bucket only on a completed login.
- **Note**: the `totp: required` branch a few lines above deliberately refuses to `recordSuccess`
  with the comment "a correct password must not reset the account's or IP's failure history". The
  `needsTotp` branch does not follow its own rule.
- **Status**: verified.

#### L2 — The lockout backoff never escalates

- **Where**: `src/host/shared/rate-limit/rate-limit.ts:83-95` (`checkBucket`), `:97-107`
  (`recordBucket`).
- **What**: `recordBucket` computes `exponent = failures - maxFailures`, but `checkBucket` zeroes
  `failures` as soon as a lock has expired, and a locked endpoint short-circuits with 429 without
  ever recording a failure. `failures` is therefore always exactly `maxFailures` when a lock is set,
  the exponent is always zero, and the delay is always `baseDelayMs`.
- **Impact**: The class doc promises escalating backoff and `maxDelaySeconds` promises a ceiling;
  neither exists. The real rate is five attempts per 30 seconds per account and per IP,
  approximately 14k guesses a day and account, forever.
- **Fix**: keep a `strikes` counter that survives lock expiry and decays only through
  `windowSeconds`.
- **Status**: verified.

#### L3 — The limiter's check and record are not atomic

- **Where**: `src/host/features/password/model/password-login.ts:154-182`;
  `passkey-login-finish.ts:105-121`; the TOTP stage.
- **What**: `check` is synchronous and side-effect free on the allowed path, then the handler awaits
  the users-file load and an scrypt verify, and only afterwards calls `recordFailure`. Nothing
  reserves a slot in between.
- **Impact**: N concurrent requests for one account all observe "not locked" before any failure is
  recorded, so a burst is limited by server concurrency rather than by the five-failure policy.
- **Fix**: reserve an in-flight slot when `check` passes and release it on success or failure.
- **Status**: verified.

#### L4 — Token mode has no rate limiting

- **Where**: `src/endpoints-wiring.ts:93-114` (token branch); `src/host/features/token/api/auth-endpoints.ts`.
- **What**: The token branch passes no `limiter` into `registerAuthEndpoints`; `validateToken` only
  does `safeEqual`. Password, passkey and password-change each get a limiter, and `security.md` §5
  states client-IP rate limiting as a general invariant.
- **Impact**: Unlimited online guessing of the shared token, which is acceptable only if the token is
  always generated at high entropy. Nothing validates that: no minimum length, no entropy check, no
  generation guidance in the README.
- **Fix**: wire the shared login limiter, or enforce a token entropy floor at startup.
- **Status**: verified.

#### L5 — The CLI password reset leaves every session alive

- **Where**: `src/cli.ts:195-219` (`passwdUser`); `docs/security.md:77-83`.
- **What**: The security page says a password change revokes every session for that user, including
  the one that performed it. The self-service path (`makeSessionRevoker`) and admin reset both do
  it; the CLI rewrites the hash and prints nothing but a TOTP warning.
- **Impact**: The operator-run reset is the standard response to a suspected compromise, and the path
  that matters most is the one that leaves stolen cookies and Bearer sessions valid until TTL.
- **Fix**: either give the CLI access to the session domain (`src/host/entities/session/`), or narrow
  §6 to the web paths and print a loud warning — but not the current silent gap.
- **Status**: verified on both sides.

#### C1 — An expired session reads as "current password is wrong"

- **Where**: `src/client/features/change-password/model/account-submit.ts:60-67`;
  `src/protocol/payloads.ts` (`PasswordChangeErrorBody`).
- **What**: `describeFailure` maps every 401 that is not `invalid_totp` to `invalidCredentials` on
  the `current` field. The contract also allows 401 `unauthorized` (session expired or revoked) and
  403 `bad_origin`; both fall into the generic message, and `account-redirect.ts` is only used on
  success.
- **Impact**: A user whose session expired while the form was open is told the password is wrong and
  has focus moved to the password field. They can retry with a correct password indefinitely and
  never learn they must sign in again.
- **Fix**: distinguish `unauthorized` (offer a re-login link) from `invalidCredentials`; the admin and
  passkey mappers already do this.
- **Status**: verified.

#### C2 — The logout-order probe can leak a registration

- **Where**: `src/client/index.tsx:99-122`.
- **What**: `dispose` is reassigned inside the `.then` after `mount(order)`, with no `AbortController`
  and no disposed flag, and `res.ok` is not checked before `res.json()`.
- **Impact**: If the plugin disposes before the fetch resolves, `() => dispose?.()` has already run on
  the default registration and the late `.then` mounts a second one that nothing will dispose. On hot
  reload or plugin disable in a slow window, a duplicate logout item persists.
- **Fix**: capture a disposed flag, abort the fetch on dispose, check `res.ok`, and validate the body
  instead of casting it.
- **Status**: verified.

#### C3 — A failed list reload is a no-op

- **Where**: `src/client/widgets/account-section/ui/admin-block.tsx:57`;
  `src/client/features/passkey/model/use-passkey-list.ts:25`.
- **What**: Both hooks gate the loading, error and empty transitions on `attempt === 0`, so a reload
  after a successful mutation that fails does not reach the first-load error path.
- **Impact**: After an add, remove or reset, a failed refresh leaves the old list on screen next to the
  "success" status, and the retry button bumps `attempt` without changing anything visible.
- **Fix**: treat a refresh failure as an error state the UI renders, not as "keep the previous data".
- **Status**: reviewer-only; worth a test that makes the second fetch fail.

#### E1 — The publish job ships without verification

- **Where**: `.github/workflows/release.yml:32-79`; `.github/workflows/ci.yml`.
- **What**: The `publish` job is checkout, `setup-node`, a version-versus-tag check (dispatch path
  only), `npm ci`, `npm publish`. There is no gate, test or diff step and no `needs` on CI. `prepack`
  rebuilds `lib/`, which means the published artifact is built rather than verified. release-please
  opens its pull request with `secrets.GITHUB_TOKEN`, and such pushes normally do not trigger other
  workflows.
- **Impact**: The artifact that reaches npm may never have been tested at that commit, and because
  publishing uses Trusted Publishing, a bad publish cannot be quietly replaced.
- **Fix**: add `needs: ci` (or run `npm run verify` in the publish job) and a
  `git diff --exit-code -- lib` step after the build.
- **Status**: verified from the step list; the "no CI on release PRs" point is reasoned, not observed.

#### E2 — The `lib/` parity check cannot see untracked files

- **Where**: `.github/workflows/ci.yml:105` (`git diff --exit-code -- lib`).
- **What**: `git diff` compares the working tree with the index, so a build output the developer never
  `git add`ed is invisible.
- **Impact**: A new source file whose compiled output was never committed passes CI, and the committed
  `lib/` drifts from the tarball, which is built fresh at publish. That undermines the reason `lib/`
  is committed at all (`security.md` §10).
- **Fix**: follow the diff with `git status --porcelain -- lib` (or `git add -N lib`), and fail on
  untracked output.
- **Status**: verified.

### P2 — nice to have

| ID  | Finding                                                                                          | Where                                                              | Status   |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------- |
| G2  | `unwrap` restores `server.register*` unconditionally and can drop a later foreign wrapper         | `src/host/shared/guard/guard.ts:317-326`                           | verified |
| G3  | Idempotent wrap has no owner or reference count, so a second disposer disarms the first           | `guard.ts` (`if (existing !== undefined) return existing`)          | reviewer |
| G4  | `guardUpgrade` does not catch a throwing gate, and `denyUpgrade` writes then destroys the socket  | `guard.ts` (`guardUpgrade`, `denyUpgrade`)                          | reviewer |
| G5  | `apply` returns silently when `webServer` is missing, disarming the guard with no log             | `src/index.ts:170-172`                                             | verified |
| G6  | Session-domain mount: a late `.then` can publish after disposal; a failed open denies forever      | `src/index.ts` (`mountSessionDomain`)                               | reviewer |
| G7  | Proxy-marker deny matches the raw path; percent-encoded and doubled-slash variants are untested    | `src/host/shared/guard/http.ts` (`isProxyDeniedRequest`)            | reviewer |
| G8  | A missing `remoteAddress` is treated as a local, trusted transport                                | `src/host/shared/http/client-ip.ts`                                 | reviewer |
| G9  | `security.md` §4 says the bounce runs before the gate decides; the code runs it after allow        | `docs/security.md:54-61` vs `guard.ts:123-133`                      | verified |
| G10 | A comment cites a `docs/decisions/...` path that does not exist                                   | `src/passkey-wiring.ts:38`                                          | verified |
| G11 | `denyBootstrap`, the `/auth/*` allow rule and `routeTarget` are duplicated across the two gates   | `token-gate.ts`, `password-gate.ts`, `guard/self-check.ts`          | reviewer |
| G12 | Session-kind checks are deny-lists, and the bootstrap subject is a legal username                 | admin endpoints, `password-change.ts:194`, `bootstrap-endpoint.ts`   | reviewer |
| G13 | The 413 path in `parseFormBody` may reset the socket, and its test feeds a synchronous generator   | `src/host/shared/http/form-body.ts`, `form-body.test.ts`             | reviewer |
| L6  | TOTP replay guard prunes at `counter - 1` and is in-memory only                                   | `src/host/features/totp/model/replay-guard.ts:28-32`                | reviewer |
| L7  | `users.yaml` writes never fsync, the temp name is fixed, and the lock can be stolen after 10s      | `src/host/entities/user/model/users-file.ts:132-152,263-270`         | verified |
| L8  | `user add` skips the password policy, and `setDisabledUser` skips `USERNAME_RE`                    | `src/cli.ts:170-192,283`                                            | reviewer |
| L9  | The session store prunes on every `create` and deletes while iterating                             | `src/host/entities/session/model/session-store.ts:87-88`             | reviewer |
| L10 | Limiter and ceremony maps evict by insertion order, so a rotating attacker can push out a victim  | `rate-limit.ts:109-127`, `ceremony-store.ts`                        | reviewer |
| L11 | Any successful login clears the shared IP bucket, not just the account bucket                      | `rate-limit.ts:65-70`                                               | verified |
| L12 | The disabled-user sweeper warns once per process; a deleted user keeps live sessions               | `disabled-sweeper.ts:30-31`                                         | reviewer |
| L13 | The passkey counter is read, then advanced after an await, so two assertions can both pass         | `passkey-login-finish.ts:155-161,197`                               | reviewer |
| C4  | Admin reset loses focus on failure and renders its live region with the content                    | `admin-reset-hooks.ts`, `admin-fields.tsx:100`                      | reviewer |
| C5  | Admin reset `setValue` writes from a stale closure instead of a functional update                  | `admin-reset-hooks.ts`                                              | reviewer |
| C6  | Passkey UI: no `tabIndex` on the status node, a form inside `<th>`, no IME guard, one shared lock  | `passkey-fields.tsx:91`, `passkey-table.tsx:96-103`                 | reviewer |
| C7  | `formatPasskeyDate` can throw and there is no error boundary                                       | passkey table rows                                                  | reviewer |
| C8  | Server data is `as`-cast rather than validated in `toCreationOptions` and the status probe          | `passkey-codec.ts`, `account-status.ts:83`, `index.tsx:104`         | reviewer |
| C9  | A transient status failure collapses to "login required", and `/auth/status` is fetched up to 3×   | `account-status.ts:83`, `logout-action.tsx:74`                      | reviewer |
| C10 | `PasskeyAdminErrorBody` omits `invalid_totp`, so the client compares a string literal              | `passkey-form.ts:111-114,167`, `payloads.ts`                        | reviewer |
| C11 | Duplicated field, status and lock plumbing, and dead exports in three client features              | `account-header.tsx:119`, `passkey-fields.tsx:31`, `admin-form.tsx` | reviewer |
| C12 | Password policy copy hard-codes 14 and 256 instead of reading the contract                          | `shared/i18n/account-copy.ts`                                       | reviewer |
| C13 | `aria-expanded={false}` is a constant, and the nav icon runs a `MutationObserver` over the host DOM | `admin-block.tsx:263`, `passkey-block.tsx:189`, `account-nav-icon.ts` | reviewer |
| E3  | Gate routing skips build and tests for `*.config.ts`, `tsconfig*` and `vitest.config.ts` changes   | `scripts/run-gates.mjs` (`RULES`)                                   | reviewer |
| E4  | The `no-emdash` self-test is vacuous: the script has no `--self-test` branch                       | `scripts/check-no-emdash.mjs`, `gate-registry.mjs`                  | verified |
| E5  | Dead references: `skills:updates`, `notes:seal`, a "decisions" gate, a missing README heading     | `package.json`, `.agents/notes/README.md`, `docs/README.md`         | verified |
| E6  | `architecture.md` and `security.md` never mention passkey, bootstrap or the launch token           | `docs/architecture.md`, `docs/security.md`                          | verified |
| E7  | The tarball ships contributor skills and 301 source maps whose targets are not shipped             | `package.json` (`files`), `tsconfig.build.json`                     | reviewer |
| E8  | Workflows lack `permissions`, `concurrency` and `timeout-minutes`; actions are pinned to tags      | `.github/workflows/*.yml`                                           | reviewer |
| E9  | The README puts install around line 147, and the upgrade example is still 0.11.0→0.11.1            | `README.md`, `docs/deployed/deployment.md`                          | reviewer |
| E10 | `require-decision-record` patterns miss release and packaging files                                | `.github/workflows/require-decision-record.yml`                     | reviewer |
| E11 | Coverage has a global 80% floor only, so one security file can drop and stay hidden                | `vitest.config.ts`                                                  | reviewer |
| E12 | release-please has no `bump-minor-pre-major`, so a breaking change on 0.x goes to 1.0.0            | `release-please-config.json`                                        | verified |

### Suggestions

| ID  | Suggestion                                                                                        |
| --- | ------------------------------------------------------------------------------------------------- |
| S1  | `zh-prose` is report-only with 319 findings; add a baseline ratchet instead of waiting for a mass rewrite |
| S2  | The 20 gate scripts are neither type-checked nor typed-linted (`allowJs`/`checkJs` absent)          |
| S3  | Order the README for a self-hoster first, and document what to back up (`users.yaml`, its `.bak`)  |
| S4  | State the token entropy requirement in the README and in the config schema                         |

### Rejected and corrected findings

- **Rejected — "admin re-authentication ignores `totpMode`"** (host-flows reviewer). `reauthAccepted`
  requires a TOTP code whenever the actor has a TOTP secret
  (`src/host/features/admin/model/reset-steps.ts:129-137`). Under `totp: "required"` a user without a
  secret cannot sign in at all, so the actor always has one. Not a defect; no action.
- **Corrected — "the cross-site bounce is an authentication bypass".** The host-flows reviewer
  described it as a hole; the guard reviewer read the same code and the note
  (`2026-10-13-cross-site-navigation-bounce`) correctly. The bounce runs only after `decide` returns
  `allow`, so it is not a bypass. What is wrong is `security.md` §4's wording (G9).
- **Corrected — "the TOTP challenge cookie is too long-lived".** The cookie is HMAC-signed with an
  expiry in the MAC'd payload and a five-minute TTL; the real problem is the attempt counter (L1), not
  the cookie.

### What is in good shape

- **Fail-closed core**: a missing session service, a throwing token resolver and a malformed URL all
  end in deny or 400, and `guardResource` propagates errors instead of admitting.
- **Session invariants**: 256-bit `randomBytes` tokens, storage keyed by sha256 digest, one
  `buildCookie` template with fixed `Path=/; HttpOnly; Secure; SameSite=Lax` flags.
- **Per-entry rollback** in `wrapServer`, with a test that foreign routes survive.
- **Credential path**: scrypt parameters stored beside the hash, `DUMMY_HASH` for unknown users,
  constant-time compare, one uniform failure response for unknown, wrong and disabled.
- **`mutateUsersFile`**: lock plus stale detection, mtime/size compare-and-swap, `.bak`, atomic
  rename, last-admin invariant, passkey-store validation before write.
- **Gate registry**: one registry drives verify, pre-commit, CI and the self-test chain, and the runner
  refuses to start when the registry, the scripts on disk, the npm scripts or the hooks disagree.
- **Dependency surface**: four runtime dependencies, `sideEffects: false`, an explicit exports map,
  a 181 KB client bundle.

### Coverage gaps

- Not reviewed: `passkey/api/*management*`, `passkey/cli`, `features/proxy/`, `shared/telemetry/`,
  `shared/skill/`, `shared/login-page/`, `src/cli-usage.ts`, `src/cli-skill.ts`, `src/proxy-cli.ts`,
  the password `ui/` pages, and the deeper integration tests (`host-corridor`, `guard.resource*`,
  `guard.cross-site`) beyond their shape.
- No reviewer executed a test, a type-check or a pack; every "impact" statement about runtime
  behaviour is reasoned from the code.
- The `lib/` and tarball numbers (301 maps, 1.6 MB) come from directory listings, not from
  `npm pack --dry-run`.

### What this review does not decide

No code was changed by this review. The P1 list is a work order, not a release verdict: each item
needs its own change with a regression test, and the two documentation items (G9, E6) need a decision
about whether the contract or the code is wrong. The release sync-back (`development` at `0.23.0`,
`main` at `0.23.1`) is an operational follow-up, not a finding.

This document is evidence, not authority. Where it and the code disagree, the code wins.
