# TOTP Fix Plan (dsh-auth-gate 0.11.x)

> ## Status: Implemented (2026-08-30, Decision A)
>
> This plan has been fully implemented in the 0.11.1 fix per Decision A (HMAC-signed challenge cookie):
> P0.1 / P0.2 / P0.3-A, P1.1-P1.3, and test gaps 1-10 and 12 landed in PR-fix;
> P2 (frozen-spec revision notes, README, SKILL, ADR D10) landed in PR-docs.
> Issues discovered and handled during implementation: test-file line budgets (splitting describes / separate integration files),
> slice:check allowlist extension (integration-totp-helpers / integration.totp-hardening).

> Audience: developers implementing this plan. It rewrites the verified TOTP review findings as executable steps.
> The authoritative current state is the repo's `development` branch source; `docs/implemented/impl-m4.md` is the **M4 frozen spec** — changing it requires an ADR or a spec revision note; silently rewriting historical decisions is forbidden.
> Architecture constraints (they apply throughout; not repeated per item):
>
> - **Deps injection**: the password slice **must not import** the totp slice (D5 / D9). New capabilities are injected into `PasswordLoginDeps` from `src/index.ts` `apply` / `mountAuthEndpoints`.
> - **Fail-closed**: reject when credentials are uncertain, never allow through (D1).
> - **Line budget**: `max-lines` 250 (blank lines/comments excluded), function ≤ 80, complexity ≤ 15. `password-login.ts` is already 295 lines (incl. comments); if P0/P1 grow it further, the file must be split.
> - **Test harness**: TOTP endpoint tests share `test/password-totp-harness.ts` (outside src; creating new cross-test helpers inside src is forbidden).

---

## 1. Overview

### 1.1 Goal

Close the security gaps in two-stage TOTP login so that disabled users cannot complete the second stage, `totp: "off"` truly ignores TOTP, and rate-limiting / replay-protection semantics align with successful login — and bring the frozen spec, README, ADR, and skill docs back in line with the implementation.

### 1.2 Scope

**Will change**

| Layer                              | Files                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login flow                         | `src/features/password/password-login.ts`, `password-endpoints.ts`; add `src/features/password/challenge-cookie.ts` if needed                                                                                         |
| Assembly                           | `src/index.ts` (add deps fields only; do not change token mode)                                                                                                                                                       |
| TOTP algorithm / replay protection | `src/features/totp/replay-guard.ts`; optionally `src/features/totp/totp.ts` (dummy-HMAC)                                                                                                                              |
| Tests                              | `password-endpoints.totp-stage1.test.ts` / `totp-stage2.test.ts`, `replay-guard.test.ts`, `totp.test.ts`, `integration.totp.test.ts`, `test/password-totp-harness.ts`; if needed `password-endpoints.methods.test.ts` |
| Docs                               | `docs/implemented/impl-m4.md` + `impl-m4_zh.md` (revision note), ADR, `docs/decisions.md`, `README.md` / `README.zh.md`, `.agents/skills/dsh-auth-gate-config/SKILL.md`                                               |

**Will not change**

- The `mode: "token"` path (`src/features/token/`, TokenGate).
- The guard / session store / scrypt / `LoginRateLimiter` algorithms themselves (P10 semantics preserved; only **call timing** is adjusted).
- `revokeBySubject`, the login CSRF token, rate-limit persistence (T13 / D8 stay not done; only add `TODO(auth-m5):` markers).
- Username charset (P5 / `USERNAME_RE`), challenge TTL 300s, cookie name `dsh_auth_challenge`, window ±1.
- No new npm dependencies.

### 1.3 Decision point: sign the challenge cookie or not

M4 ADR D6 explicitly **rejected** signed challenge tokens (`docs/decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md` lines 22–24): the cookie only proves "the password stage was recently passed"; the real gate is the TOTP code; forging a username only changes whose secret gets verified.

Residual risk identified by the review: an **unsigned** cookie lets an attacker **skip the password stage** — after forging `dsh_auth_challenge=<victim>.<future-epoch-ms>`, only the victim's current 6-digit code (shoulder-surfing, malware, code theft within the 90s window) is needed to log in. D6's "attacker has no code" premise does not hold once the code is leaked. `GET /auth/login` also does not read the user file (`password-endpoints.ts` lines 62–71), so any well-formed cookie renders the challenge page.

The repo owner must pick one of the two before implementation starts.

#### Option A — HMAC-signed challenge cookie (recommended)

- Cookie value becomes `<username>.<expiresEpochMs>.<hmac>`, HMAC-SHA256, keyed by a process-level `randomBytes(32)` secret created inside `apply()` (same lifetime as limiter / replayGuard, **no new config option**, honoring T4 "no other new configuration").
- Parsing validates the MAC with `timingSafeEqual`; failure means no challenge (password path / render the password page).
- **Pros**: restores the authentication fact that "the password stage was actually passed"; forged cookies can no longer skip the password; consistent with D1 fail-closed.
- **Cons**: in-flight challenge cookies all become invalid **after a process restart** (even if Max-Age in the user's browser has not expired) — this is a behavior change and must be documented in the README. Multiple instances/processes do not share the key, so a challenge cannot be continued across processes (this plugin is already a single-gate, in-memory rate-limit model; acceptable).
- **Docs**: a new ADR D10 supersedes the "no signing" item in D6 (D6's original text stays as history; do not edit landed text under the archived rules; append a 2-line "partially superseded by D10" pointer at the end of D6). Add revision notes to `impl-m4.md` T5 / §3.3.

#### Option B — document the risk only; do not sign in code

- Zero signature-surface code changes; add a "residual risk" section to the README "Caveats and limitations", SKILL, and D6.
- **Pros**: no compatibility changes; a fresh cookie can still submit a code after restart (the behavior promised at README lines 304–307 is preserved).
- **Cons**: the password stage can be bypassed with a forged cookie; under `totp: "required"`, an attacker can spray TOTP codes at any username (still rate-limited). Inconsistent with the literal "two-stage" guarantee.
- **Docs**: a new ADR or a D6 supplement accepts the unsigned residual risk; the README must state the sentence "the challenge cookie is unsigned; holding the current TOTP code is enough to skip the password".

#### Recommendation

**Choose A.** On a single-gate public deployment, "skipping the password" demotes TOTP from a second factor to the only factor. Process-level HMAC introduces no configuration, never touches storageDomain, and its restart-invalidation window is ≤ 5 minutes — the same model as the in-memory rate limiter / replay guard. Option B only fits an intranet gate that explicitly accepts "a TOTP code equals login".

Before a decision is made: **P0.1 / P0.2 may land first**; P0.3's code path per A goes in a separate commit/PR, so B is not accidentally shipped in 0.11.1.

---

## 2. P0 Fix Items

### 2.1 Disabled users can still complete the TOTP second stage

- **Problem**: `handleTotpSubmit` only rejects "no `totpSecret`" and ignores `user.disabled`. After an admin disables an account within the challenge TTL (300s), someone holding the challenge cookie + current code can still obtain a session. Severity: **critical**.
- **Files and locations to change**:
  - `src/features/password/password-login.ts` function `handleTotpSubmit`, lines 98–146 (user lookup at lines 111–119).
  - For comparison: the password-path `rejectedInvalid` at lines 224–247 — disabled users **still get a real hash verification** before the 401 (`password-endpoints.login-reject.test.ts` "still verifies the real hash for disabled users before rejecting").
  - The password stage already blocks disabled users: `password-endpoints.totp-stage1.test.ts` lines 42–48; **no corresponding test for the second stage**.
- **How to fix**: put the disabled check **after** TOTP verification and **before** issuing a session, so a "skip HMAC" path cannot give disabled accounts a timing side channel (aligned with the P9 password path). Pseudocode (keep deps / the 401 message / logging unchanged):

```ts
const user = loaded.snapshot.users.get(username);
if (user?.totpSecret === undefined) {
  deps.limiter.recordFailure(ip, username);
  reject401(res, deps); // 现有 401 + cache-control + "invalid credentials" + info("login rejected")
  return;
}

const matched = deps.verifyTotp(user.totpSecret, code, deps.now());
const replay = matched !== undefined && deps.replayCheck(username, matched, code);
if (matched === undefined || !replay || user.disabled) {
  deps.limiter.recordFailure(ip, username);
  reject401(res, deps);
  return;
}
```

Extract a small `reject401` function so `handleTotpSubmit` stays under 80 lines. When `user.disabled` is true: if the code already matched, `replayCheck` has already recorded it — the code is burned for the window, fail-closed, acceptable.

Do not call `verifyTotp` in the "no secret" branch for timing purposes (the secret does not exist); no-secret / unknown users keep the current short-path 401 (consistent with §3.4 line 101). dummy-HMAC is an optional P1 item and does not block this one.

- **Impact / risk / compatibility**:
  - Behavior change: a disabled account's in-flight challenge cookie becomes 401 on the next POST code (previously it issued a session). This is a vulnerability fix; no upgrade toggle.
  - Already-issued sessions remain unaffected (T13/P15: disabling only blocks new logins).
  - No change to the cookie format or the 401 response body.
- **Tests** (file `src/features/password/password-endpoints.totp-stage2.test.ts`, using `makeHarness` / `aliceChallengeCookie` / `SECRET_ALICE`):
  1. `disabled user with secret and a valid challenge cookie is rejected at TOTP submit`: `h.users.set("alice", { ...alice, disabled: true })`, `setVerifyImpl` returns a counter, `POST code=123456` + alice challenge cookie → `status === 401`, `body === "invalid credentials"`, `set-cookie` has no `dsh_auth=`.
  2. `disabled user still runs verifyTotp before rejecting`: assert `setVerifyImpl` was called (use a counting closure in the harness) to prevent regression to "skip HMAC when disabled".
  3. Integration: add `disabled user is blocked at the password stage even with a TOTP secret` to `src/integration.totp.test.ts` (required by spec matrix #5; currently missing).

### 2.2 The second stage and challenge page still activate when `totpMode === "off"`

- **Problem**: `handlePasswordLogin` lines 91–94 enter the TOTP path whenever "challenge cookie is valid ∧ body has a code", **without checking `deps.totpMode`**. `GET /auth/login` lines 66–71 likewise only look at the cookie. After the config is changed to `"off"`, an in-flight or forged cookie can still complete the two-stage flow / show the code page. Inconsistent with T4 "off = completely ignore the secret" and the stage1 test "off mode ignores secrets entirely" (`password-endpoints.totp-stage1.test.ts` lines 26–32, which only covers the **password stage**). Severity: **medium**.
- **Files and locations to change**:
  - `src/features/password/password-login.ts` `handlePasswordLogin` lines 71–96 (routing at lines 91–94).
  - `src/features/password/password-endpoints.ts` `handleLogin` GET branch lines 62–72.
  - Assembly already injects `totpMode`: `src/index.ts` line 187 `totpMode: config.totp`.
- **How to fix**:

```ts
// handlePasswordLogin
if (challenge !== undefined && code !== "" && deps.totpMode !== "off") {
  await handleTotpSubmit(deps, res, challenge, code, next, ip);
  return;
}
await handlePasswordSubmit(deps, res, params, next, ip);

// handleLogin GET
const challenge = parseChallengeValue(
  parseCookieHeader(req.headers.cookie, CHALLENGE_COOKIE),
  deps.now(),
);
const showTotp = challenge !== undefined && deps.totpMode !== "off";
res.end(showTotp ? totpChallengePageHtml(next) : passwordLoginPageHtml(next));
```

When `off`, a POST with a code falls through to the password path: no username/password in the harness → same shape as the existing "code without challenge cookie" case, 401. Do not write a separate 401 in the TOTP path for `off`, to avoid diverging from the "ignore TOTP" semantics.

- **Impact / risk / compatibility**:
  - After ops changes `totp: "optional"|"required"` back to `"off"` and restarts: still-live challenge cookies in browsers no longer open the code page or trade for a session. Users must go through password login again (under off, sessions are issued directly). This is a config-semantics fix.
  - If option A is chosen, the restart itself invalidates the cookies, so this item is redundant insurance for "restart-to-change-config" once A lands; it still matters for "hot-change config without restart" (the current `apply` has no hot update — reloading the plugin under cordis equals a restart).
- **Tests**:
  - `password-endpoints.totp-stage2.test.ts`:
    1. `off mode: leftover challenge cookie + code does not issue a session`: `h.setTotpMode("off")`, `setVerifyImpl` returns a counter, `POST code=123456` + `aliceChallengeCookie()` → 401, and `h.replayCalls` is empty (never entered the TOTP path).
    2. `off mode: GET with leftover challenge cookie renders the password page`: `setTotpMode("off")`, GET + alice cookie → body contains `name="username"`, no `name="code"`.
  - Keep the existing stage1 `off mode ignores secrets entirely` as a password-stage regression.

### 2.3 Challenge-cookie signing (Option A vs Option B)

- **Problem**: `buildChallengeValue` / `parseChallengeValue` (`password-login.ts` lines 14–33) use plaintext `<username>.<expiresEpochMs>` with no MAC. D6 did this deliberately. Severity: **medium** (escalates to high under the "code is leaked" premise).
- **Files and locations to change** (**Option A only**):
  - Current code: `buildChallengeValue` lines 14–16, `parseChallengeValue` lines 19–33 (`lastIndexOf(".")`), issuance lines 178–193.
  - GET/POST reads: `password-endpoints.ts` lines 67–70, `handlePasswordLogin` lines 85–88.
  - Cookie tooling: `src/session/session-store.ts` `buildSetCookie` lines 12–19 (reuse; do not change its signature).
  - Assembly: `src/index.ts` `apply` around lines 223–224 (create the key alongside `limiter` / `replayGuard`), injected via `mountAuthEndpoints` lines 176–194.

#### Option A changes

1. **Split the file** (line budget): create `src/features/password/challenge-cookie.ts` (inside the password slice — not totp, not shared; this is authentication-face state, not generic cookie parsing). Move `CHALLENGE_COOKIE`, `CHALLENGE_TTL_SECONDS`, `buildChallengeValue`, `parseChallengeValue` there; update imports in `password-login.ts` / `password-endpoints.ts` / the harness. Re-export the constants from `password/index.ts` so deep test imports do not break.
2. **Deps** gains `challengeMacKey: Uint8Array` (32 bytes). `index.ts`:

```ts
const challengeMacKey = randomBytes(32); // node:crypto，与 totp.ts 同模块风格
// mountAuthEndpoints(...): PasswordLoginDeps 增
challengeMacKey,
```

Test harness: `makeHarness` fixes `Buffer.alloc(32, 7)` (or draws `randomBytes(32)` once) so signing/parsing stay consistent within the same harness.

3. **Format and parsing** (P5 allows `.` in usernames — see `USERNAME_RE` at `src/shared/users-file.ts` line 8; **must keep splitting from the right**, see §4.2):

```
value = `${username}.${expiresEpochMs}.${mac}`
mac   = createHmac("sha256", key).update(`${username}.${expiresEpochMs}`).digest("base64url")
```

`parseChallengeValue(value, nowMs, key)`:

- Use `lastIndexOf(".")` to take the mac; then `lastIndexOf(".")` on the prefix for username / expires.
- If the mac length differs from the locally computed value → return `undefined` directly (`timingSafeEqual` needs equal lengths).
- If `timingSafeEqual(computed, provided)` fails → `undefined`.
- Keep the expires check as at lines 25–29: `Number.isInteger(expires) && expires > nowMs && expires - nowMs <= CHALLENGE_TTL_SECONDS * 1000`.
- **Never** compare the mac with `===`.

4. **Issuance** (`handlePasswordSubmit` lines 178–189) becomes `buildChallengeValue(username, expires, deps.challengeMacKey)`.
5. The password slice keeps getting the key only via deps; it must **not** import `features/totp` for HMAC.

#### Option B changes

Do not change the cookie format or deps. Only the §4 docs. Adding a **documentation-contract** test is optional, but the code side must at least get a regression comment that "a forged cookie can enter the TOTP path", so future maintainers do not "fix" it as a bug without an ADR.

- **Impact / risk / compatibility**:
  - **A**: after upgrading to 0.11.1-with-A and restarting, old plaintext cookies (`alice.<exp>`) fail parsing → users see the password page and must re-enter their password. Someone mid-code-page loses the challenge state (≤ 5 minutes). **Multi-replica processes** cannot share challenges (same limitation as the current in-memory limiter).
  - **B**: no runtime change.
- **Tests** (A lands in `password-endpoints.totp-stage2.test.ts` + the new `src/features/password/challenge-cookie.test.ts`, to avoid stuffing parse details into an 80-line describe):
  1. `tampered mac is treated as no challenge (GET renders password page)`.
  2. `forged unsigned value alice.<exp> is treated as no challenge` (old-format upgrade).
  3. `wrong key (simulating restart) rejects a cookie issued by another key`.
  4. `valid signed cookie still completes TOTP submit` (change `aliceChallengeCookie()`: the harness calls `buildChallengeValue` with the same key).
  5. `dotted username round-trips`: `alice.bob` + a valid exp + mac → parse yields `alice.bob`.
- **B's tests**: lock `forged challenge cookie skips the password stage` into stage2 as **known behavior** (comment referencing D6/D10-B) to prevent undocumented behavior drift.

---

## 3. P1 Fix Items

### 3.1 Premature `recordSuccess` / rate-limit continuity

- **Problem**:
  1. The TOTP success path calls `recordSuccess` at line 132 **before** checking the session store (lines 133–140). When the store 503s, the failure bucket has already been cleared, so an attacker can wash the bucket with "4 wrong codes + 1 correct code hitting 503".
  2. The password path calls `recordSuccess` immediately after `rejectedInvalid` passes at line 165, then `required`-with-no-secret calls `recordFailure` again (lines 169–176). Net effect: a correct password **clears historical failures first**, then records 1 failure — the limiter gets reset by a correct password.
  3. In two-stage mode, the first stage also calls `recordSuccess` before issuing the challenge cookie (165 → 178), so password-stage failures never carry into the TOTP stage. T8 requires "wrong codes back off exponentially just like wrong passwords" — clearing the bucket after stage 1 starts TOTP from 0, effectively granting the second stage 5 extra attempts.
- **Files and locations to change**: `src/features/password/password-login.ts`
  - `handleTotpSubmit` lines 132–145.
  - `handlePasswordSubmit` lines 164–203.
  - The limiter itself is unchanged: `src/shared/rate-limit.ts` `recordSuccess` lines 64–69.
- **How to fix**:

```ts
// handleTotpSubmit：先拿 store，成功签发前再清桶
const store = deps.sessions();
if (store === undefined) {
  // 系统错误：不计失败、也不 recordSuccess（与 loadUsersOr503「不计失败」对称）
  res.setHeader("cache-control", "no-store");
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("session store unavailable");
  deps.logger.error("login failed: session store unavailable");
  return;
}
deps.limiter.recordSuccess(ip, username);
await issueSession(deps, res, store, username, next, [
  buildSetCookie(CHALLENGE_COOKIE, "", 0, deps.cookieSecure),
]);

// handlePasswordSubmit：删掉第 165 行的提前 recordSuccess
if (await rejectedInvalid(...)) return;

if (deps.totpMode === "required" && user?.totpSecret === undefined) {
  deps.limiter.recordFailure(ip, accountKey); // 不再先 success 再 failure
  reject401(...);
  return;
}
if (needsTotp) {
  // 第一段通过：清桶（密码已证明），然后发挑战。T8「同一 limiter」仍成立：
  // TOTP 错码从 0 计；这是有意选择——密码正确不应继承错密次数。
  deps.limiter.recordSuccess(ip, accountKey);
  // 发挑战 cookie + 302（现有 178–193 行）
  return;
}
const store = deps.sessions();
if (store === undefined) { /* 503，未 recordSuccess */ return; }
deps.limiter.recordSuccess(ip, accountKey);
await issueSession(...);
```

On point 3, "should stage 1 clear the bucket?": **keep clearing** (the password passed; prior wrong-password locks must not block a legitimate second stage), but pin that semantics in the planned tests so it is not re-flipped as a "bug" again. What P1 fixes are "failure paths wrongly clearing the bucket" and "503 wrongly clearing the bucket" — not "two stages share one counter without breaks".

- **Impact**: under `required`, hitting a no-secret user with a correct password no longer resets that account/IP's historical failures. Wrong-code counts survive a 503. TOTP still gets 5 attempts after a successful stage 1 (consistent with production).
- **Tests**:
  - `password-endpoints.totp-stage2.test.ts`: `TOTP success with missing session store returns 503 and does not clear the failure bucket`: first 4 wrong codes, `h.setStore(undefined)`, correct code → 503; then restore with `setStore` and a 5th wrong code → 429 (a wrongly-cleared bucket would not 429).
  - Same file or stage1: `required mode: correct password for a no-secret user does not reset prior failures`: first 4 wrong passwords, then `setTotpMode("required")` with bob's correct password → 401; one more failure → 429.
  - The password-path 503 already exists at `password-endpoints.login-rate.test.ts` lines 223–238; **add a sentence** "failures before a 503 are not cleared" (nothing currently asserts on the limiter). It can go in that file; no new suite needed.

### 3.2 Replay protection rejects by counter

- **Problem**: T7 / §3.2 records `(counter, code)`. The implementation `TotpReplayGuard.checkAndRecord` (`replay-guard.ts` lines 19–40) only rejects when **both counter and code** match (line 31); `entries.set(counter, code)` at line 33 **overwrites** when the same counter arrives with a different code. The unit test even locks this in as a contract: `replay-guard.test.ts` lines 17–21 `allows a different code at the same counter`. In real TOTP, a counter has exactly one valid code; pairing by (counter, code) grants a meaningless allow path for "the second attempt in the same window" and contradicts the ops intuition that "this window is already used".
- **Files and locations to change**: `src/features/totp/replay-guard.ts` `checkAndRecord` lines 19–40; test `replay-guard.test.ts` lines 17–21.
- **How to fix**:

```ts
if (entries.has(counter)) return false; // 本窗口已用，不论 code
// prune: existingCounter < counter - 1（保持与 §3.2 一致，见 §4.2 T7 内部矛盾的处理）
entries.set(counter, code);
```

The value still stores the code (debugging / future audits), but comparison no longer uses the code.

- **Impact**: submitting a second different 6-digit string in the same window used to make the guard return true (the endpoint still 401'd because `verifyTotp` failed); now the guard also returns false. The external 401 is unchanged; behavior is stricter only on "HMAC collisions" or when a fake `verifyTotp` in tests returns a different code for the same counter. Restart still clears everything.
- **Tests** (`src/features/totp/replay-guard.test.ts`):
  1. **Change** `allows a different code at the same counter` to `rejects a different code at the same counter`: the second call is `false`.
  2. Keep `allows the same code at a different counter`.
  3. `src/features/password/password-endpoints.totp-stage2.test.ts` already has `replayed code (guard false)` (lines 52–59); add one: `setVerifyImpl` returns counter `100` for any code; the first 123456 succeeds, a second 654321 + the same cookie → 401 and `replayCalls` twice.

### 3.3 Challenge-page error slot wiring

- **Problem**: `totpChallengePageHtml(next, error?)` (`src/shared/login-page.ts` lines 198–218) already supports `<p class="error">` (`renderLoginCard` lines 105–106), and spec §3.4 line 123 requires the error slot (message only `"invalid credentials"`). But `handleLogin` GET line 71 calls `totpChallengePageHtml(next)` **never passing an error**; POST failures are 401 `text/plain` bodies of `"invalid credentials"` (`handleTotpSubmit` lines 125–128). Users who submit a wrong code through the form see blank plaintext, not a challenge card with an error bar. The escape test for the same slot on the password page lives at `password-endpoints.methods.test.ts` lines 156–164; the challenge page has none.
- **Files and locations to change**:
  - `src/features/password/password-endpoints.ts` `handleLogin` lines 62–72.
  - `src/features/password/password-login.ts` `handleTotpSubmit` failure branch lines 112–129.
  - HTML: `src/shared/login-page.ts` lines 198–218 (function signature unchanged).
- **How to fix** (keep the 401 status code; change **content-type / body** so browser forms see the slot; fetch clients still check status):

```ts
// 失败：401 HTML，挑战 cookie 不清除（浏览器继续持有，可重试）
function rejectTotp(deps: PasswordLoginDeps, res: ServerResponse, next: string): void {
  deps.logger.info("login rejected");
  res.setHeader("cache-control", "no-store");
  res.writeHead(401, { "content-type": "text/html; charset=utf-8" });
  res.end(totpChallengePageHtml(next, "invalid credentials"));
}
```

`password-endpoints.ts` must **not** import the totp slice; `totpChallengePageHtml` is already imported from `shared`. Put `rejectTotp` in `password-login.ts` (it already imports `shared`).

GET does not read the `error=` query (avoids open-redirect-style arbitrary text; the slot text is limited to this one constant). Never inject raw query input into the HTML.

- **Impact**: `expect(res.body).toBe("invalid credentials")` in stage2 (lines 47–48 etc.) **will go red**. Change the assertions to: `status === 401`, `content-type` contains `text/html`, body contains `class="error"` and `invalid credentials`, contains `name="code"`, and does **not** contain an attacker-controlled error string. This is a fix visible to browser users; the plaintext-401 contract came from the M3 password path, so switching TOTP failures to HTML must be stated in an `impl-m4.md` §3.4 revision note (P2).
- **Tests**:
  - Update the body assertions for wrong code / replay / unknown user in `password-endpoints.totp-stage2.test.ts`.
  - In `password-endpoints.methods.test.ts`, next to the `passwordLoginPageHtml` describe, add `totpChallengePageHtml`: escape (copy the password page's `bad <script>` case), and no `class="error"` when no error is passed.
  - Integration `full two-stage... wrong code is rejected`: besides status 401, `text()` may contain `name="code"` (optional, guards against regression to plaintext).

### 3.4 `verifyTotpCode` dummy-HMAC fast path (optional)

- **Problem**: `src/features/totp/totp.ts` `verifyTotpCode` lines 92–112: `code.length !== 6` (line 98) and `base32Decode` failure (lines 102–103) return `undefined` directly without running HMAC. A valid secret + wrong code runs 3 HMACs. users.yaml allows any non-empty `totpSecret` string (P4 / T3). Optional hardening; **does not block P0**.
- **Files and locations to change**: `src/features/totp/totp.ts` `verifyTotpCode` lines 87–112.
- **How to fix**: on decode failure, switch to a 20-byte all-zero dummy secret but still run `hotpCode` over `t0±window` + `timingSafeEqual`; the loop still ends in `undefined`. Length ≠ 6: keep immediate rejection (client maxlength=6, and unequal lengths cannot use `timingSafeEqual`). **Never** use `===` comparison for timing. The password slice keeps calling `verifyTotp` via deps; this item only changes the totp pure function.
- **Impact**: malformed secrets' CPU cost rises to the same order as real secrets (prevents probing "is this user's secret valid base32"). No protocol change.
- **Tests** (`src/features/totp/totp.test.ts` `rejects wrong code / wrong length / invalid secret` lines 71–77): keep the `undefined` assertions; optionally `it.skip` any timing (unstable in CI). Do not mock "HMAC ran", since `createHmac` is not injected. Document clearly: this item is best-effort and not a mandatory 0.11.1 acceptance item.

---

## 4. P2 Doc and Spec Write-back

`docs/implemented/impl-m4.md` is the frozen spec (preamble lines 3–11). Change the body via **"revision note"** sections (in the preamble or next to the relevant line) — do not pretend M4 always looked this way. The Chinese mirror `docs/implemented/impl-m4_zh.md` changes in sync. ADRs follow `docs/decisions/README.md`: landed records use present tense; when **superseding** a record, write a new one linking the old, and never change archived hashes.

### 4.1 T10 assembly signatures (spec ≠ implementation)

- **Spec** (`docs/implemented/impl-m4.md` line 54): `verifyTotp => Promise<boolean>`, `replayGuard: TotpReplayGuard`.
- **Implementation** (`password-login.ts` lines 48–51): `verifyTotp => number | undefined` (matched counter), `replayCheck: (username, counter, code) => boolean`. Wired at `src/index.ts` lines 188–190. D9 (`docs/decisions/implemented/2026-08-30-totp-slice-and-injection.zh.md` lines 7–8, 29) already describes the implementation.
- **Fix**: amend T10's revision note to match the implementation, and add a sentence: "returning the counter is what lets replayCheck own T7's match window; password does not hold a `TotpReplayGuard` instance, consistent with D9". Do not change the implementation back to `Promise<boolean>` (that would drop the counter and force password to recompute the window).

If Option A adds `challengeMacKey` to deps, list that field in the same note.

### 4.2 §3.3 first-dot vs the implementation's last-dot; T7 prune wording

- **Spec** `docs/implemented/impl-m4.md` line 86: "split on first `.`". Line 85 also says the username charset includes `.`, "no conflict with the `.` separator" — self-contradictory. P5 `USERNAME_RE` (`users-file.ts` line 8) **allows** interior `.`.
- **Implementation** `parseChallengeValue` line 21 uses `lastIndexOf(".")`, which is correct for `alice.bob.<exp>`.
- **Fix**: **change the spec to match the implementation**; do not switch to first-dot (that would split `alice.bob` into username `alice`). Revision note: "split off `expires` at the last `.`; under Option A, split off `mac` at the second-to-last `.`. Usernames may contain `.` (P5)."
- The T7 table (line 51) says drop everything before `counter-2`; §3.2 line 78 says `counter' < counter - 1`. The implementation follows §3.2 at line 27. Amend the T7 table to align with §3.2 / the code (keep window-1, i.e., drop entries older than `counter-1`).

The spec puts `CHALLENGE_COOKIE` in `password-endpoints.ts` at lines 84, 160; it actually lives at `password-login.ts` line 8 (moved to `challenge-cookie.ts` under Option A). Update the blueprint accordingly.

### 4.3 T13 `TODO(auth-m5):` markers missing

- **Spec** line 57: new code leaves `TODO(auth-m5):` where these points need revisiting.
- **Implementation**: **zero** `TODO`s in `src/` (grep confirms). D8 says "leave a `TODO(auth-m5)` at each".
- **Fix** (one-line comments; no functionality):
  - Next to `revokeByToken` in `src/session/session-store.ts` (lines 87–90): `// TODO(auth-m5): revokeBySubject — disabled users only block new logins (T13/D8).`
  - Next to `handleLogin` in `src/features/password/password-endpoints.ts`: `// TODO(auth-m5): login CSRF token — re-evaluated in T13/D8, still not added.`
  - Next to the class comment at `src/shared/rate-limit.ts` lines 22–24 and at `src/features/totp/replay-guard.ts` lines 7–10: `// TODO(auth-m5): persist limiter/replay across restart (T13/D8).`

### 4.4 README `required` wording

- English `README.md` line 123 and Chinese `README.zh.md` line 110: `required` reads "all users must (no code = no login)" — it does not say "no-secret / unknown users get a uniform 401 at the password stage, preventing enumeration".
- **Change to match T4**, e.g.: `required`: everyone goes two-stage; a user without `totpSecret` or a nonexistent user → the same 401 `invalid credentials` as a wrong password (not 503). `optional` keeps "second stage only when a secret exists".

### 4.5 README unsigned-cookie / restart semantics

- Current `README.md` lines 300–307 and `README.zh.md` lines 226–229: they say rate-limit/replay reset on restart, the challenge state lasts 5 minutes, and a still-fresh cookie after restart means the code page is usable.
- **Option A**: change to "challenge cookies are HMAC-signed with a per-process key; after a restart you must re-enter the password. The cookie itself cannot be forged to skip the password." Delete "if the cookie is still fresh after a restart, the code page remains usable".
- **Option B**: state explicitly in that section: "the challenge cookie is **unsigned**. An attacker who can forge it and holds the current TOTP code can skip the password stage. The real gates are the TOTP code and rate limiting."

### 4.6 SKILL.md TTL + replay protection

- `.agents/skills/dsh-auth-gate-config/SKILL.md` rate-limit line 83 only says "5 failures lock for 30s (reset on restart)"; it does not cover the TOTP challenge TTL, replay reset on restart, or (A or B's) cookie semantics.
- **Fix**: add two rows to the Common failures table:
  - Code page spinning / bouncing back to the password page after submit: the challenge expires after 5 minutes; under Option A a process restart also drops the challenge state.
  - The same code 401s a second time: replay protection (in-memory, reset on restart); independent of rate limiting.
- The skill ships with the package (`package.json` `files` includes `.agents/skills`). After changes, deployments must run `dsh-auth skill install --force` to update installed copies — add a sentence to the README skills section.

### 4.7 ADR

- **Option A**: create the bilingual `docs/decisions/implemented/YYYY-MM-DD-totp-signed-challenge-cookie.{zh,en}.md` (four-section template `_template.zh.md` / `_template.en.md`) and add **D10** to the `docs/decisions.md` index. Two lines at the end of D6: "the signing part is superseded by D10; stateless, no pending session, no password re-submission — still hold." Do not change D6's body trade-offs (do not rewrite history as present-tense fiction).
- **Option B**: add a "residual risk" subsection to D6, or a new D10 "accepting unsigned challenge cookies"; add half a sentence of risk to the D6 summary in `docs/decisions.md`.
- `npm run decisions:check` (part of the `verify` chain) must stay green. Do not touch `archived/`.

---

## 5. Test-Gap Checklist (12 items)

| #   | Gap (review name)                                            | Landed in                                     | Test-case essentials                                                                                                                                                                                                                                                                                        | Prerequisite                                                                                       |
| --- | ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | TOTP submit path does not reject disabled                    | `password-endpoints.totp-stage2.test.ts`      | set `disabled: true` on alice + a valid challenge cookie + verify returns a counter → 401, no session cookie; verify is still called                                                                                                                                                                        | **Acceptance for P0.1**                                                                            |
| 2   | `totpMode=off` leftover cookie can still POST a code         | same file                                     | `setTotpMode("off")` + correct code → 401, `replayCalls` empty                                                                                                                                                                                                                                              | **Acceptance for P0.2**                                                                            |
| 3   | `totpMode=off` GET still renders the challenge page          | same file                                     | GET + leftover cookie → `name="username"`, no `name="code"`                                                                                                                                                                                                                                                 | **Acceptance for P0.2**                                                                            |
| 4   | Forged / tampered challenge cookie                           | `challenge-cookie.test.ts` (A) or stage2 (B)  | A: wrong mac / old plaintext / wrong key → treated as no challenge; B: pin "forgery can skip the password" and cite the ADR                                                                                                                                                                                 | **Acceptance for P0.3**                                                                            |
| 5   | Dotted usernames / last-dot parsing                          | `challenge-cookie.test.ts` or stage2          | `alice.bob.<exp>[.<mac>]` round-trip; first-dot splitting must not become the implementation                                                                                                                                                                                                                | P0.3 (A) or P2 spec (B may add it earlier)                                                         |
| 6   | Users-file 503 in the TOTP path                              | `password-endpoints.totp-stage2.test.ts`      | harness `loadUsers` throws; POST code + challenge cookie → 503 `"user store unavailable"`, no failure recorded (cf. login-rate lines 205–220)                                                                                                                                                               | Spec matrix #4; **can be written before P0 lands** (the current code already has `loadUsersOr503`) |
| 7   | Session-store 503 wrongly clears the bucket in the TOTP path | same file                                     | 4 wrong codes → 503 on a correct code → another wrong code 429                                                                                                                                                                                                                                              | **Acceptance for P1.1**                                                                            |
| 8   | Correct password under `required` wrongly resets the limiter | `password-endpoints.totp-stage1.test.ts`      | 4 wrong passwords + bob's correct password under `required` 401 + 5th failure 429                                                                                                                                                                                                                           | **Acceptance for P1.1**                                                                            |
| 9   | Replay protection only accepts the (counter, code) pair      | `replay-guard.test.ts` + stage2               | same counter, different code → false; endpoint's second POST 401                                                                                                                                                                                                                                            | **Acceptance for P1.2**                                                                            |
| 10  | Challenge-page error slot not wired                          | stage2 + `password-endpoints.methods.test.ts` | wrong-code 401 HTML contains `class="error"` and the fixed message; HTML escape                                                                                                                                                                                                                             | **Acceptance for P1.3**                                                                            |
| 11  | Malformed secret skips HMAC                                  | `totp.test.ts`                                | invalid base32 / empty secret → `undefined`; optional dummy-HMAC                                                                                                                                                                                                                                            | P1.4 optional; **does not block 0.11.1**                                                           |
| 12  | Spec-matrix #5 integration gap                               | `integration.totp.test.ts`                    | (a) a disabled user with a secret is blocked at the password stage; (b) `required` unknown user 401 (can merge with no-secret); (c) this file does not test token mode — token regressions remain the job of the existing `integration.auth.test.ts`; note it in a comment here to avoid duplicating stacks | do (a) after P0.1; the rest can be parallel                                                        |

Note: the existing stage1 test "disabled user with secret is blocked at the password stage" (lines 42–48) does **not** count as gap 1 — it only covers stage one. The existing stage2 "expired challenge cookie" (lines 69–75) suffices and is not among the 12. Existing integration replay / required / off tests are kept.

---

## 6. Implementation Order and Acceptance

### 6.1 PR split

Recommended: **2 PRs** (both squash-merged into `main`, head=`development`):

| PR      | Contents                                                                                                                                                        | Commit type                                                                                  | Releases?                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| PR-fix  | P0.1 + P0.2 + P1.1 + P1.2 + P1.3 + tests 1–3, 6–10, 12a + P0.3-A and tests 4–5 if decided; README behavior-change section (rate limiting / disabled / 401 HTML) | `fix:`                                                                                       | **Yes** → release-please cuts **0.11.1** |
| PR-docs | P2 spec revision notes, T13 TODOs, SKILL, ADR D10, `docs/decisions.md`, test 5 (if B) / 11                                                                      | `docs:` (standalone TODO comments may use `chore:`; use `docs:` when in the same PR as docs) | No                                       |

Do not split P0.1 and P0.2 into two `fix:` commits — that would cut 0.11.1 and 0.11.2 and fragment the changelog. If P1.4 dummy-HMAC is not stable enough, **do not** put it in PR-fix.

If the owner has not decided between A/B: PR-fix **excludes** P0.3 code and the README keeps its signing wording for now; P0.3 becomes a third PR (A = `fix:` releasing 0.11.2; B = `docs:` no release).

### 6.2 Suggested commit messages

PR-fix squash title:

```
fix: reject disabled and totp-off on TOTP submit
```

If signing is included:

```
fix: sign TOTP challenge cookies and fail-close submit path
```

PR-docs:

```
docs: amend M4 TOTP spec and record challenge-cookie ADR
```

Suggested body bullets: the disabled second stage, off routing, `recordSuccess` moved later, replay-by-counter, the 401 HTML error slot; (optional) HMAC. Never hand-edit `version` / `CHANGELOG.md` / `.release-please-manifest.json`.

### 6.3 Landing steps (executor checklist)

1. The owner confirms §1.3 A or B in writing (one line in the issue / PR description suffices).
2. If A: add `challenge-cookie.ts` + unit tests (gaps 4–5) first, then change login/endpoints/harness. Watch `password-login.ts`'s line count; after moving the cookie helper out it should sit comfortably under 250 effective lines.
3. P0.1 → test 1 green; P0.2 → tests 2–3 green.
4. P1.1 → tests 7–8; P1.2 → test 9 (change the guard unit test that will go red first, then the implementation — or the reverse — but in the same commit).
5. P1.3 → update every TOTP-failure assertion of `body === "invalid credentials"`; run the whole stage2 file.
6. Tests 6 (users-file 503) and 12a.
7. `npm run build` (`lib/` must be committed in the same change as `src/`; CI runs `git diff --exit-code -- lib`).
8. `npm run verify` (format + lint + no-emdash + slice:check + lock:check + decisions:check + type-check + coverage 80% + build + bundle:check).
9. PR-docs: bilingual impl-m4 revision notes, `TODO(auth-m5)`, README/SKILL, ADR; then rerun `npm run decisions:check` and `verify`.

### 6.4 Step-by-step acceptance criteria

| Step   | Pass criteria                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1   | Disabled user: stage one still 401; stage two (challenge cookie + correct code) 401 with no session; `verifyTotp` is still called       |
| P0.2   | With `totp: "off"`, a leftover challenge cookie on GET/POST behaves like no cookie                                                      |
| P0.3-A | no mac / wrong mac / wrong key → password page; valid signature + correct code → 302 with two cookies (clear challenge + issue session) |
| P0.3-B | README/ADR contain the literal "unsigned / can skip the password" sentence; code format unchanged                                       |
| P1.1   | 503 and required-no-secret no longer `recordSuccess`; 4+1 failures still 429                                                            |
| P1.2   | after `checkAndRecord(u, c, a)`, `(u, c, b)` is false                                                                                   |
| P1.3   | wrong-code response is 401 HTML with the fixed error-slot message; `next` still escaped                                                 |
| P2     | `impl-m4.md` T10/§3.3/T13 consistent with the code; `decisions:check` green; SKILL covers TTL/replay                                    |
| Gate   | `npm run verify` all green; no `lib/` drift                                                                                             |

slice:check: new files must land under `features/password/` (or be totp pure functions); password must **not** import `features/totp`. Keep the harness in `test/`.

---

## 7. Rollback and Release Impact

- The current `package.json` version is **0.11.0**. PR-fix's squash commit type is `fix:` → per `docs/specs/development.md` Releases: under 0.x, `fix:` → **0.11.1** (release-please opens a release PR; hand-editing version/CHANGELOG/manifest is forbidden).
- PR-docs' `docs:` / `chore:` / `test:` commits **do not release**.
- **Rollback**: revert that `fix:` squash. Behavior reverts to: disabled users can complete the second stage again, `off` leftover cookies become live again, the 401 returns to plaintext, (A) challenge cookies are plaintext again. If the deployment already forced users to re-login (A's restart invalidation), old plaintext cookies may still be within TTL after the revert — A's parse treats the old format as invalid, and after the revert the old format is valid again; this is a brief window and is acceptable.
- **Upgrading existing deployments**:
  - Always: disabled and `off` semantics tighten; a correct password under `required` no longer washes the rate-limit bucket.
  - If A: release notes state "after upgrading and restarting, unfinished TOTP challenges require re-entering the password".
  - If 401 HTML: scripts relying on "a TOTP failure body is always the `invalid credentials` plaintext" must check the status instead.
- **Docs that are not rolled back**: once an ADR is implemented, reverting the code should be recorded by writing another ADR, not by deleting D10.
- If P1.4 does not land in 0.11.1, do not put it in the changelog.

---

## Appendix: Key Code Anchors (verified during this reading)

| Symbol                                                                 | Location                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CHALLENGE_COOKIE` / `CHALLENGE_TTL_SECONDS`                           | `password-login.ts` 7–11                                                            |
| `buildChallengeValue` / `parseChallengeValue`                          | `password-login.ts` 14–33                                                           |
| `PasswordLoginDeps`                                                    | `password-login.ts` 35–59                                                           |
| `handlePasswordLogin` routing                                          | `password-login.ts` 85–96                                                           |
| `handleTotpSubmit`                                                     | `password-login.ts` 98–146                                                          |
| `handlePasswordSubmit` `recordSuccess` / required / challenge issuance | `password-login.ts` 164–193                                                         |
| GET challenge page                                                     | `password-endpoints.ts` 62–71                                                       |
| `totpChallengePageHtml`                                                | `login-page.ts` 198–218                                                             |
| `verifyTotpCode`                                                       | `totp.ts` 92–112                                                                    |
| `TotpReplayGuard.checkAndRecord`                                       | `replay-guard.ts` 19–40                                                             |
| Assembly `verifyTotp` / `replayCheck` / `totpMode`                     | `index.ts` 187–190                                                                  |
| `USERNAME_RE`                                                          | `users-file.ts` 8                                                                   |
| D6 rejecting signing                                                   | `docs/decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md` 22–24 |
| T5 unsigned / T10 signature drift / §3.3 first-dot / T13 TODO          | `docs/implemented/impl-m4.md` 49, 54, 57, 85–86                                     |
