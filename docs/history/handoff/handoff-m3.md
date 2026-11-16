# dsh-auth M3 handoff document (session handoff)

> Readers: the coding agent executing `docs/implemented/impl-m4.md` in a **new session**. This file carries
> environment facts and procedural knowledge unique to this session — things not in the repo, that
> are expensive to re-derive, or that will trip you up.
> **Reading order: `AGENTS.md` → `docs/implemented/impl-m3.md` → this document**; the environment facts in
> `docs/handoff/handoff-m2.md` §3/§4 (sandbox networking, server access, pkill tricks, lint pitfalls) are
> still valid and are not repeated here.

---

## 1. One-line status

M3 (password mode: users.yaml + scrypt + rate limiting + `dsh-auth user` CLI) is delivered: `npm run verify`
is fully green (174 tests), lib is in the same commit, and **all real-server end-to-end smoke tests pass**
(login/session/Bearer session token/WS/429 rate limiting/disabled user/whitelist). `mode: "token"` (M2) behavior
is unchanged with zero regressions, all green.

## 2. Repo and remote status snapshot (2026-08-15 afternoon, after push)

- Branch: `development` is in sync with `origin/development` (all 9 commits pushed,
  `git log --oneline origin/development..HEAD` is empty):
  - M2: `c184dbc` (spec finalized) → `bbe39bd` (handoff snapshot) → `aee37b4` (feat implementation) →
    `6a5064e` (lazy credentials docs);
  - M3: `1fac9fe` (spec) → `db21eac` (feat implementation) → `e030e75` (docs contract/handoff) →
    `5f049c2` (handoff snapshot refresh + plan roadmap ✅) → `04037a9` (deployment deliverable).
- **PR #2 is open** (`development` → `main`, titled "M2 shared token gate + M3 password login
  flow..."): pending merge. After merge, the `feat:` commits on `main` will trigger release-please to
  automatically open a **release PR** (version bump + CHANGELOG, see `docs/specs/development.md` Releases) —
  that is an automated flow and needs no manual handling; do not hand-edit the `package.json` version
  before the release PR is merged.
- Commit discipline during M3 implementation unchanged: `lib/` and `src/` in the same commit; `docs:`/`feat:`
  split by type.

## 3. M3 implementation pitfall list (new session should avoid directly)

1. **`deps.verify` argument order** (must-read; only integration tests expose it): `PasswordLoginDeps.verify` must
   have the **same signature `(password, storedHash)` as `verifyPassword`**. TS structural compatibility does not
   check parameter names — if you swap them, unit tests (fake verify) are all green while the **real path is
   always 401** (verifyPassword fails to parse the segment count, treating the hash string as a password).
   This session actually hit this; it is annotated in `impl-m3.md` §4.7.
2. **Effect callbacks must not wrap the function in another layer** (must-read; the root cause of all integration
   tests returning 404): inside `ctx.effect(() => mountAuthEndpoints(...))`, mountAuthEndpoints must **register
   immediately and return a merged disposer**; if it returns `() => registerX(...)`, cordis stores that function as
   the disposer — the registration never happens, all `/auth/*` routes are always 404, and **unit tests (fake ctx
   synchronous effect) and integration tests behave differently**, which sent debugging the long way around.
   This is written into the `mountAuthEndpoints` JSDoc.
3. **CLI readLine race** (only exposed by server smoke): `createInterface`'s `once("line")`/`once("close")` — when
   "piped data arrives before createInterface and then EOF", close may fire before line → readLine returns empty
   string → CLI reports `empty password` (**also reproduces on a local pipe**; `node -e` unit tests cannot
   reproduce it because there is no preceding await).
   Fix: use readline's **async iterator** (`for await (const line of lines) return line`).
   `cli.test.ts`'s fake io does not cover the real readLine — the real pipeline path is covered by server smoke.
4. **scrypt maxmem must be explicit**: N=2¹⁵ already exceeds the default 32 MiB maxmem and throws RangeError
   (reproduced locally); N=2¹⁶/r=8 needs explicit `maxmem: 128 MiB`. A single derivation takes ~150 ms.
5. **`$` is capture-group syntax in `String.replace` replacements**: the `$1` in `"$16384$"` gets replaced with an
   empty string — when changing a hash parameter segment in tests, use `split("$")`/`join("$")` or build a new
   string; do not use replace.
6. **scrypt's N participates in derivation**: changing the N segment of a stored string without re-deriving →
   verification must fail. The "replace the N segment" wording of spec §5 test item 6 is wrong and was corrected
   to "construct a hash with old parameters" (noted in `impl-m3.md`).
7. **Lint line-count pitfall reconfirmed**: `max-lines` 250 counts with skipBlankLines+skipComments; after copying
   the test-file helpers (MemTable/makeRes/harness etc., ~150 lines) into every file, large suites **must be split
   by describe across files** (the `password-endpoints` series was therefore split into 5 and integration into 2).
   `max-lines-per-function` counts the whole describe callback as a function (80 lines) — **if the total number of
   non-empty cases in a single describe exceeds 80, it fails**.
8. **Test files must not import each other**: vitest executes an imported `.test.ts` as a test (describe gets
   registered twice); copy the helpers into each file (M2 precedent), and do not create helper files inside `src/`
   (they would be compiled into `lib/` by tsc and counted in coverage).
9. **`vi.mock` is file-level**: in a file that mocks `registerPasswordEndpoints`, you cannot assert real endpoint
   registration — put the "endpoint registration" assertion in integration tests (`index.password.test.ts` only
   asserts the gate type + usersPath deps).
10. **Fake ctx effect semantics** (M1 lesson repeated): the callback runs synchronously **and returns a disposer**,
    and the disposer is only collected, not executed — executing the disposer immediately unwraps the guard, and
    self-check fails loud.
11. **fetch integration test body**: POST login cases must provide a body (`makeReq`'s asyncIterator only yields when
    a body is defined), otherwise username is empty → goes down the DUMMY_HASH path with 401 (looks like a product bug).

## 4. Server smoke workflow (M3 version, actually exercised end to end)

On top of handoff-m2 §3.2:

1. Sync + build: `rsync -az --exclude node_modules --exclude .git .../dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
   → on the server `cd /tmp/dsh-auth-test && npm install --registry=https://registry.npmjs.org/ && npm run build`.
2. Create a user (**real CLI**, 0600 verified this run):
   ```bash
   ssh ubuntu 'printf "%s\n" "<pw>" | node /tmp/dsh-auth-test/lib/cli.js user add admin --password-stdin --file ~/dsh-smoke/auth/users.yaml'
   ssh ubuntu 'node /tmp/dsh-auth-test/lib/cli.js user list --file ~/dsh-smoke/auth/users.yaml'
   ssh ubuntu 'stat -c "%a" ~/dsh-smoke/auth/users.yaml'   # 600
   ```
3. overlay `~/dsh-smoke/cordis.patch.yml`: the `dsh-auth` line
   `config: { mode: "password", cookieSecure: false }` (probe line already removed).
4. Restart: kill (`pkill -f "[d]sh --profile web --port 3081"`) and start are two separate ssh calls;
   **the ssh call that starts may hang and time out after 2 minutes** (the nohup child process fds make ssh
   wait) — **the timeout is normal; the nohup process is actually up**. Open another ssh and check `pgrep` +
   the `dsh web:` line in `boot.log`.
5. Verification sequence (all actually exercised and passing this session; TOK extraction uses
   `grep dsh_auth jar | awk "{print \$7}"` — in nested quotes `$6=="..."` gets broken by ssh):
   - `GET /auth/login` → 200 containing `name="username"`;
   - wrong password → 401; correct → 302 + `set-cookie` (cookieSecure=false has no `; Secure`);
   - with cookie `/__auth_probe` → 200; without cookie JSON → 401 / HTML → 302;
   - `Authorization: Bearer <session token>` → 200; wrong → 401;
   - `/auth/status` → `{"authenticated":true}`; disabled user → 401;
   - `/auth/whatever` → 404; `DELETE /auth/login` → 405;
   - logout → 302 + `Max-Age=0`; original cookie → 401;
   - WS: no credentials first line 401, cookie 101, Bearer 101;
   - 429: **note the IP bucket accumulates the failures from the earlier steps** (disabled login also counts as a
     failure) — lockout appears earlier than "6 rapid sends", which is correct behavior (locked after 5 failures,
     `retry-after: 30`, correct password is also 429 during the lock period, login page still 200).
6. The instance is stopped (final `pkill` at the end of this session); run `pgrep` first next time.

## 5. Starting hints left for M4

- The user record already contains the `totpSecret` field (zod-parsed, unused); M4's two-stage TOTP login can add
  the challenge stage directly in `password-login.ts` / `password-endpoints.ts`.
- Evaluated-but-not-done items (`impl-m3.md` §9): immediate revocation of sessions for disabled users (`SessionStore`
  adds `revokeBySubject` or checks user status inside the gate — note the performance/caching tradeoff of file IO
  inside the gate), CSRF token, rate-limit persistence, token+password dual-mode coexistence.
- Bearer=session token semantics verified in smoke: `GET /auth/status` only accepts the cookie (frozen in M5, unchanged).
- The CLI's readLine has been fixed with the async iterator — if M4 adds interactive input (e.g. TOTP secret
  generation), reuse the same pattern.

## 6. Open questions / pending

- The deployment-side deliverable is complete and tested: `deploy/cordis.patch.yml` (production overlay template) +
  `docs/deployed/deployment.md` (deployment and acceptance checklist) — exercised end to end on the server following the
  documented flow (`npm pack` → `dsh plugin --profile web add` → package-name-referenced overlay → acceptance
  sequence A–H all green, including the `; Secure` cookie with `cookieSecure: true`).
- No blockers. Possible follow-ups: M4 spec (TOTP), GUI logout button (client half).
