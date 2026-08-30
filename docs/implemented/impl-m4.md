# dsh-auth M4 Implementation Spec (executable spec)

> ## Amendment (0.11.1, 2026-08-30) — TOTP hardening review
>
> Post-M4 security review (Grok 4.6) findings closed on top of this frozen spec; the body
> below is the historical M4 contract, amended as follows:
>
> - **T5 / §3.3**: challenge cookie is now **HMAC-signed** (`<username>.<expiresEpochMs>.<mac>`,
>   process-level key; invalid MAC = "no challenge"). See ADR D10 (replaces D6's "not signed").
> - **T4**: `off` also gates the submit path and GET rendering (leftover/forged challenge
>   cookies are inert under `off`); submit path rejects `user.disabled` (both checked after the
>   constant-time verification, mirroring the password path).
> - **T7**: replay guard keys on `(user, counter)` — a different code in the same window is
>   also rejected (one window has exactly one valid code).
> - **T8**: `recordSuccess` moves after session-store availability (503 keeps the failure
>   bucket); `required` + no-secret failure records only `recordFailure` (no bucket reset).
> - **§3.4**: TOTP failures respond 401 with the challenge-page HTML (error slot), not plain
>   text.
> - **T10**: actual assembly is synchronous `verifyTotp: (secretB32, code, nowMs) => number | undefined`
>   (matched counter) plus `replayCheck(username, counter, code)`, and deps gain
>   `challengeMacKey: Uint8Array`.
> - **T13**: `TODO(auth-m5):` markers are present in `src/` at the three revisit points.
> - **§3.3**: value is split on the **last** `.` (usernames may contain dots, P5).
> - **§3.3 / file map**: `CHALLENGE_COOKIE` / build / parse / issue live in
>   `src/features/password/challenge-cookie.ts` (0.11.1 split; re-exported through
>   `password-login.ts`). Historical mentions of `password-endpoints.ts` as the cookie home
>   (§3.3, T11, file map) refer to the pre-0.11.1 layout.
> - Files: `src/features/password/challenge-cookie.ts` (new), `src/integration-totp-helpers.ts` /
>   `src/integration.totp-hardening.test.ts` (integration hardening suite).

> Reader: the coding agent implementing this (expected deepseek v4 flash, **new session**). This document is a
> **decision-complete spec**: all decision points are already closed; the executor only translates, it does not
> design.
> Baseline: `docs/implemented/impl-m3.md` (M3 delivered: users.yaml + scrypt + rate limiting + `dsh-auth user` CLI — M4 stacks
> on top of it). M1's D1–D16, M2's M1–M22 and M3's P1–P26 stay unchanged unless explicitly amended below.
> Design basis: `docs/specs/dsh-auth-plan.md` §6 phase 3 / §8; engineering gates and slice layout: `docs/specs/development.md`
> and `docs/specs/src-refactor-plan.md` (layered `src/`: gate/session core + features/{token,password,proxy} + shared leaf;
> cross-slice imports only through barrels; features never import each other).
> **This file is the sole authority for M4 details**; where it conflicts with plan/M1/M2/M3, this file wins.
>
> Environment and verification workflow: see `docs/handoff/handoff-m3.md` (mandatory reading for a new session: server
> smoke workflow §4, M1–M3 pitfalls §3, M4 starting hints §5). **Do not explore the harness internals yourself** —
> if you need a fact not present in this file, stop and report.

---

## 1. M4 Goals

Bring phase 3's "OTP hardening" to life: a **TOTP two-stage login** on top of the M3 password flow:

- `POST /auth/login` (password mode) becomes two-stage **only for users who have a `totpSecret`** (and only when
  configured on): password passes → TOTP challenge page → correct authenticator code → session cookie issued;
- users **without** a secret keep the exact M3 behavior (single-stage password login, byte-identical responses);
- `mode: "token"` (M2) stays 100% unchanged, as does the rest of the guard/session/self-check machinery;
- CLI gains `dsh-auth user totp enable <name>` / `user totp disable <name>` (generate an RFC 4648 base32 secret,
  write it into users.yaml, print an `otpauth://` URI for the authenticator app; remove it);
- TOTP verification is constant-time, windowed (±1), with **in-memory replay protection** (recent verified codes
  are rejected again) — consistent with the existing in-memory rate limiter (reset on restart, noted in README);
- all M3 evaluation leftovers are re-evaluated in this milestone and given a final disposition (T13);
- new decisions are recorded as ADRs per the decision-record process (T15): this milestone is the **first
  feature milestone fully covered by the ADR regime** (refactor milestone backfilled D1–D5).

Guard/session/self-check/rate limiter internals are **not changed** (the limiter is reused as-is); this milestone
adds the TOTP flow, the challenge stage inside the existing password endpoints, the CLI commands, and the config
surface.

---

## 2. Frozen decision table (M4 increments; D1–D16 / M1–M22 / P1–P26 unchanged)

| #   | Decision            | Frozen value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Scope               | TOTP two-stage applies **only to `mode: "password"`**; `mode: "token"` and all other machinery are byte-identical to M3/M2. A user's `totpSecret` (P4, already zod-parsed-but-unused) becomes **the per-user enable flag**. No new dependencies (RFC 6238 = `node:crypto` HMAC-SHA1, zero added packages; base32 encode/decode is self-written, ~40 lines, to avoid a Node version dependency).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T2  | Algorithm           | RFC 6238 TOTP with the RFC 4226 HOTP core: `counter = floor(unixTimeMs / 30000)`, 8-byte big-endian counter, `HMAC-SHA1(secretBytes, counter)`, dynamic truncation (offset = last byte & 0xf; 4 bytes; `& 0x7fffffff % 1_000_000`), **6-digit** code, zero-padded. Window **±1** (3 counters: `t-1, t, t+1` → 90 s validity, clock-drift tolerance). Code comparison is constant-time (`timingSafeEqual` over equal-length digit buffers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T3  | Secret format       | `totpSecret` in users.yaml = **RFC 4648 base32, no padding, uppercase**, exactly **32 chars (160 bits, 20 random bytes)**. Generated by `randomBytes(20)` + self-written base32 encode. CLI prints an `otpauth://totp/<label>?secret=<BASE32>&issuer=dsh-auth` URI (label = `dsh-auth:<username>`, both percent-encoded) for manual entry / QR. Everything downstream (verify) decodes base32 → bytes. Uploading any other length/character → users file schema validation stays as P4 (any nonempty string is accepted; a malformed secret simply fails verification, never crashes — zod already only checks `string`).                                                                                                                                                                                                                                                                                                |
| T4  | Config surface      | New config: **`totp: "off" \| "optional" \| "required"`**, default **`"off"`** (M3 behavior byte-identical out of the box; explicit opt-in). Semantics: `off` — ignore secrets entirely (pure password); `optional` — users **with** a secret do two-stage, users without keep one-stage; `required` — **all** users must complete two-stage: a user without a secret (or unknown user) fails with the uniform 401 (never 503; anti-enumeration preserved, same body as wrong password). `totp` is validated with `z.enum(["off","optional","required"])`. No other new config (challenge TTL/cookie name/window are module constants, P22 style).                                                                                                                                                                                                                                                                       |
| T5  | Challenge mechanism | **Stateless challenge cookie** (no pending-session state, no storageDomain involvement): after the password stage passes, set `dsh_auth_challenge = <username>.<expiresEpochMs>` — HttpOnly, `; Secure` per `cookieSecure`, `SameSite=Lax`, `Path=/`, `Max-Age=300` (module constant `CHALLENGE_TTL_SECONDS = 300`). Value is **not signed** (see ADR T15-a): the cookie only proves "password stage passed recently"; the real gate is the TOTP code. `expiresEpochMs` is server-validated (`exp > now && exp - now <= 300_000`) so a manually replayed stale cookie dies server-side.                                                                                                                                                                                                                                                                                                                                  |
| T6  | Endpoint behavior   | No new routes (same 4: prefix 404 fallback + `/auth/login`, `/auth/logout`, `/auth/status`; M16/P16 route model unchanged). **`GET /auth/login`**: valid challenge cookie present → render **TOTP challenge page** (single 6-digit code input + hidden next); otherwise the password page (M13/M20 rendering rules otherwise unchanged). **`POST /auth/login`**: challenge cookie valid **and** body has `code` → TOTP submit path; otherwise the M3 password path. Full flow frozen in §3.4 (ordering: body → challenge-cookie parse → limiter → users file → verify → session).                                                                                                                                                                                                                                                                                                                                        |
| T7  | Replay protection   | In-memory **replay guard** (per username): on a _successful_ TOTP verification, record `(counter, code)`; a later submission of the same `(counter, code)` is rejected with the uniform 401. Housekeeping: per-user cap 9 entries, entries older than `counter-2` are dropped on insert; entry cap 10 000 users, oldest evicted (same pattern as `LoginRateLimiter`). Reset on restart — noted in README together with the limiter. The challenge cookie's one-shot success (cleared on session issue, T6) narrows replay further.                                                                                                                                                                                                                                                                                                                                                                                       |
| T8  | Rate limiting       | **Reuse the existing `LoginRateLimiter` instance** (same IP + account buckets, same 429 semantics, P10 untouched): the TOTP submit path calls `check` before verifying and `recordFailure(ip, account)` / `recordSuccess(ip, account)` after (account = username from the challenge cookie). A wrong code therefore feeds the same exponential backoff as a wrong password. `username === ""` impossible here (cookie carries it). No new limiter, no config.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T9  | Verification core   | New slice `src/features/totp/` (barrel-enabled; `FEATURE_SLICES` in `scripts/verify-slice-boundaries.mjs` gains `"totp"`): `totp.ts` (base32 + HOTP/TOTP + `generateTotpSecret()` + constant-time `verifyTotpCode(secretB32, code, nowMs, window=1)`) and `replay-guard.ts` (`TotpReplayGuard`, per-username counter/code records, cap/prune as T7). **password slice never imports the totp slice** (features same-layer prohibition): `index.ts` (root, assembly) wires totp implementations into password deps (T10).                                                                                                                                                                                                                                                                                                                                                                                                 |
| T10 | Assembly (deps)     | `PasswordLoginDeps` grows: `totpMode: "off" \| "optional" \| "required"`, `verifyTotp: (secretB32: string, code: string, nowMs: number) => Promise<boolean>` (index.ts injects `features/totp` impls), `replayGuard: TotpReplayGuard` (module instance created in `apply`, like the limiter). `password-endpoints.ts` reads/writes the challenge cookie via existing `parseCookieHeader`/`buildSetCookie`. All cross-slice traffic lands on barrels (root → `features/totp/index.js` etc.).                                                                                                                                                                                                                                                                                                                                                                                                                              |
| T11 | Files & budgets     | `src/features/totp/totp.ts` (≤250), `src/features/totp/replay-guard.ts` (≤250), `src/features/totp/index.ts` (barrel), tests `totp.test.ts` + `replay-guard.test.ts` (copy helpers, no cross-test imports — M3 pitfall 8). `src/shared/login-page.ts` adds `totpChallengePageHtml(next, error?)` (same card, one `code` input `autocomplete="one-time-code" inputmode="numeric" maxlength="6"`). `password-login.ts` splits if needed (M3 P24 precedent; the login handler grows by the TOTP branch — keep ≤250, split the challenge-cookie parsing into `password-endpoints.ts` if needed). **`src/cli.ts` must stay ≤250**: the two TOTP command handlers live in `src/features/totp/cli.ts` (exported through the totp barrel), `cli.ts` delegates with one branch.                                                                                                                                                   |
| T12 | Log discipline      | P23/M21 continuation: **codes never appear in logs** (and neither do challenge cookies). TOTP failures reuse the existing `logger.info("login rejected")` (no code, no username — uniform, anti-enumeration); success reuses `"session issued"`. Rate limit reuse `"rate limit exceeded"`. Challenge issued → no log (M3 logs no successful password stage either; session issue is the terminal event). Error paths: `"user store unavailable"` (503, M3 wording reused).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| T13 | M3 leftovers (eval) | Final dispositions, all **not implemented**, each with a one-line why (recorded in ADR T15-b): **(a) `revokeBySubject`** (P15/P17 TODO(auth-m4)) — not done: users file re-read per login (P7); gate-path file IO for every request is a performance/caching tradeoff the single-gate model doesn't merit; README keeps the documented limitation (disabled users only block new logins). **(b) Login CSRF token** (P21 re-evaluate) — still not added: TOTP does not change the analysis (a forged TOTP submission needs the victim's current code; challenge cookie CSRF-set is harmless — the code is the gate); `SameSite=Lax` + third-party Set-Cookie restrictions stand. **(c) Rate-limit persistence** — not done: in-memory reset-on-restart already documented; TOTP replay guard is in-memory for the same reason and documented together. New code keeps `TODO(auth-m5):` markers where these are revisited. |
| T14 | CLI                 | `dsh-auth user totp enable <name>` — user must exist and not be disabled-flag-blocked (any status counts as existing); generates a new secret **only if none present** (existing secret → stderr `user <name> already has a TOTP secret (disable first)` + exit 1); writes users.yaml atomically via `writeUsersFile` (preserves other fields, 0600, P19); prints to stdout: the base32 secret and the `otpauth://` URI + a note "add to authenticator, then verify by logging in". `dsh-auth user totp disable <name>` — removes the secret (idempotent: no secret → success, `user <name> has no TOTP secret` on stdout? **No** — silent success, mirroring `disable` idempotence; stderr only on error). Invalid name/file errors like existing commands (exit 1).                                                                                                                                                    |
| T15 | ADR records         | Written at implementation time, all to `docs/decisions/implemented/` (bilingual `(en                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | zh).md`, four-section template, `verify-decision-records`must pass), then`docs/decisions.md`index extended (D6+): **(a)**`YYYY-MM-DD-totp-two-stage-challenge-cookie`— stateless challenge cookie vs. pending-session store vs. single-page resubmission; **(b)**`YYYY-MM-DD-totp-disposition-of-m3-leftovers`— T13 (a/b/c) evaluation conclusions; **(c)**`YYYY-MM-DD-totp-slice-and-injection`— new`features/totp/`slice + root injection over same-layer import; **(d)**`YYYY-MM-DD-totp-config-off-by-default` — three-state config + default off (backward compat). If a decision set is tight, (a)+(d) may merge into one ADR (decision = "adaptively-enabled two-stage via stateless challenge cookie, default off") — executor's call, but each surviving decision must be traceable. |
| T16 | DoD                 | (1) `npm run verify` fully green (all 10 gates; 230 + new tests). (2) `lib/` rebuilt in the same commit. (3) **otplib cross-validation** (§3.1): ≥ 200 randomized cases + RFC vectors, bit-for-bit match, transcript in handoff-m4. (4) Real-server smoke on `web-test` (handoff-m3 §4 workflow): password → challenge page → wrong code 401 → correct code → session cookie; challenge cookie cleared; replay (same code twice) → 401; required-mode user without secret → 401; `mode:"token"` regression untouched. (5) README/README.zh updated: config table + CLI + limitations (in-memory replay/limiter reset on restart; challenge cookie TTL; `off` default). (6) ADRs landed + decisions.md updated. (7) `docs/handoff/handoff-m4.md` written (env facts, real smoke results, cross-validation transcript, pitfalls, M5 starting hints; zh mirror optional).                                                   |

---

## 3. Authoritative contracts (new M4 facts; the rest see impl-m2 §2 / impl-m3 §3)

### 3.1 TOTP internals (RFC 6238 / RFC 4226, measured baseline Node 24.13.1)

- `HMAC-SHA1(key=secretBytes, msg=8-byte BE counter)` from `node:crypto` (`createHmac`).
- Dynamic truncation: `offset = lastByte & 0xf`; `binary = (d[offset] & 0x7f) << 24 | d[offset+1] << 16 | d[offset+2] << 8 | d[offset+3]`; `code = String(binary % 1_000_000).padStart(6, "0")`.
- Window ±1: for `t in {t0-1, t0, t0+1}` with `t0 = floor(nowMs / 30_000)`; if any counter's code matches, verification maps to success (then replay check, §3.2).
- Constant-time compare: both sides converted to equal-length buffers (`Buffer.from(code, "ascii")`) + `timingSafeEqual`. Do **not** fall back to `===` anywhere.
- `generateTotpSecret()`: `randomBytes(20)` → base32 (RFC 4648 alphabet `A-Z2-7`, no padding, uppercase). Base32 encode/decode is a private helper in `totp.ts` (node's `Buffer` base32 support is version-dependent — self-written avoids the engines question; ~40 lines, unit-tested via round-trips).
- **Cross-validation against otplib (user-approved 2026-08-30)**: before the milestone lands, a one-off throwaway script (in a temp dir, never in the repo — development.md rule 4) installs `otplib@13.5.0` (`npm install --registry=https://registry.npmjs.org/ --no-save --prefix /tmp/...`) and compares our implementation against `@otplib/totp` (authenticator 30 s step, 6 digits) over **≥ 200 randomized cases**: random 20-byte secrets (base32-encoded), random counters in `±1`-window and outside-window positions, plus the RFC 6238 Appendix-B vectors. Every case must match bit-for-bit (window hit and miss). This is evidence, not a runtime dependency: the script's transcript is recorded in `docs/handoff/handoff-m4.md`; the package is not added to package.json.

### 3.2 Replay guard semantics

- Key: username. Value: `Map<counter, code>` (≤ 9 entries).
- `checkAndRecord(username, counter, code): boolean` — if `(counter, code)` already recorded → `false` (replay, uniform 401 upstream); else drop entries with `counter' < counter - 1`, insert, `true`.
- On `verifyTotpCode` success the _matching_ counter is the one passed to the guard (not all three).
- Entries cap: total users ≤ 10 000, oldest user evicted (Map iteration order, `LoginRateLimiter` pattern).

### 3.3 Challenge cookie

- Name: `dsh_auth_challenge` (module const in `password-endpoints.ts`).
- Value: `<username>.<expiresEpochMs>`. Username charset `[a-zA-Z0-9._-]` (P5) — no separator collision with `.`.
- Server-side validation on read: split on first `.`; username nonempty and `exp` integer and `exp > now && exp - now <= 300_000` → valid.
- Issued: password stage passes AND user has secret AND totpMode ≠ off → `buildSetCookie(CHALLENGE_COOKIE, value, 300, cookieSecure)` + `302 /auth/login?next=<validated next>` (next survives from the password POST).
- Cleared: TOTP success → `buildSetCookie(CHALLENGE_COOKIE, "", 0, cookieSecure)` + issue session (same response shape as M3: 302 + session cookie). A re-issued password stage simply overwrites it.
- `logout` does not touch it (a challenge cookie dies by TTL/server-side exp anyway).

### 3.4 Frozen login flow (password mode, TOTP-aware)

```
POST /auth/login:
  1. parseFormBody (415/413 → respondFormError, M19 semantics)
  2. next = validateNext(body next ?? "/")
  3. challenge = parseCookieHeader(req.headers.cookie, "dsh_auth_challenge")
  4. if challenge valid AND body has "code":
       → TOTP path: ip/account limiter check (429 short-circuit, P10); loadUsers (503 on error);
         parse username from challenge; user = snapshot.users.get(username);
         if user === undefined || user.totpSecret === undefined → recordFailure + 401 (uniform)
         t0 = floor(now/30000); match = verifyTotp(user.totpSecret, code, now)
         if !match → recordFailure + 401 "invalid credentials" + info("login rejected")
         if !replayGuard.checkAndRecord(username, matchedCounter, code) → recordFailure + 401 (replay, uniform)
         recordSuccess; clear challenge cookie; issueSession(username, next)   [M3 issueSession unchanged]
       (any loadUsers/session-store failure → 503 wording as M3)
  5. else → M3 password path unchanged, EXCEPT after `rejectedInvalid` passes:
       user has totpSecret:
         totpMode "off"      → issueSession (M3 behavior)
         totpMode "optional" → issue challenge cookie + 302 /auth/login?next=...   (TOTP page next)
         totpMode "required" → issue challenge cookie + 302 /auth/login?next=...
       user has no totpSecret:
         totpMode "off"|"optional" → issueSession (M3 behavior)
         totpMode "required"      → recordFailure + 401 "invalid credentials" (uniform, counts against limiter)

GET /auth/login:
  challenge cookie valid → 200 totpChallengePageHtml(next)   (next from query, validated)
  otherwise              → 200 passwordLoginPageHtml(next)   (M3 unchanged)

login page / challenge page CARDS share CARD_STYLE (P13); challenge card:
  title "Verify", subtitle "Enter the 6-digit code from your authenticator app",
  one input name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"
  autofocus, submit "Verify", hidden next, error slot (uniform "invalid credentials" text only).
```

### 3.5 CLI contract additions (P18/P19 extended)

```
dsh-auth user totp enable <name>   --file <path>
  - <name> must match USERNAME_RE and exist in file (else stderr + exit 1, existing error style)
  - has secret → stderr "user <name> already has a TOTP secret (disable first)" + exit 1
  - new secret = generateTotpSecret(); snapshot.users.set(name, { ...user, totpSecret: secret })
  - writeUsersFile (atomic, 0600, P19); stdout:
      "TOTP secret for <name>: <BASE32>"
      "otpauth://totp/dsh-auth%3A<enc name>?secret=<BASE32>&issuer=dsh-auth"
      "Add it to your authenticator app, then verify by logging in."
dsh-auth user totp disable <name>  --file <path>
  - user must exist (else stderr + exit 1)
  - remove totpSecret (absent → still success, exit 0, idempotent like `disable`)
  - stdout "user <name> TOTP disabled"
```

Implementations in `src/features/totp/cli.ts` (exported via barrel); `cli.ts` adds:
`if (command === "totp") return totpCommand(file, tokens[2], tokens[3], io)` — budget check: `cli.ts` stays ≤250 (usage constant + one branch; handlers live in the totp slice).

---

## 4. File blueprint (src/ and docs/)

```
src/features/totp/index.ts        barrel: export * from "./totp.js"; export * from "./replay-guard.js"; export * from "./cli.js";
src/features/totp/totp.ts         base32 encode/decode, HOTP, TOTP (window), generateTotpSecret, verifyTotpCode (≤250)
src/features/totp/replay-guard.ts TotpReplayGuard (≤250)
src/features/totp/cli.ts          totpCommand + enable/disable handlers (≤250 each function ≤80)
src/features/totp/totp.test.ts    RFC 6238 appendix-B vectors (secret 12345678901234567890 ASCII → base32 → 6-digit),
                                  window ±1 boundaries, base32 round-trip, constant-time path, malformed input
src/features/totp/replay-guard.test.ts  record/replay/multi-user/cap/prune/clock injection
src/shared/login-page.ts          + totpChallengePageHtml (card reuse)
src/features/password/password-login.ts   deps + TOTP branch (≤250; split to password-endpoints if needed)
src/features/password/password-endpoints.ts challenge cookie const/parse/issue/clear + GET/POST dispatch (≤250)
src/index.ts                      config totp field + replayGuard instance + verifyTotp wiring (T10)
src/cli.ts                        one `totp` branch delegating to features/totp/cli.ts (≤250)
scripts/verify-slice-boundaries.mjs  FEATURE_SLICES += "totp"
docs/implemented/impl-m4.md  (this file) + docs/implemented/impl-m4_zh.md (mirror, same batch)
docs/decisions/implemented/2026-08-30-*.{en,zh}.md   ADRs per T15 (verify-decision-records must pass)
docs/decisions.md                  index grows (D6+)
README.md / README.zh.md           config table (+totp), CLI section (+user totp …), limitations paragraph
docs/handoff/handoff-m4.md                 handoff for M5 (en; zh mirror optional)
```

Tests for the endpoint flow live under `src/features/password/` (`password-login.totp.test.ts` and/or
`password-endpoints.totp.test.ts` — split suites to respect `max-lines-per-function` describe caps, M3 pitfall 7)
plus an integration file `src/integration.totp.test.ts` (standalone ctx/port stack, real scrypt, TOTP via real
`verifyTotp` + a fake fixed-time clock injected into both TOTP and replay guard for determinism; 429 case in its
own describe with a fresh stack — M3 P25).

**Mandatory pitfall reminders (from handoff-m3 §3):** (1) deps.verify argument order — same signature as
`verifyPassword`; (7) describe callback line caps / suite splitting; (8) no cross-test imports, no helper files
inside src/; (11) fetch integration tests must POST a body. New: (12) **never log codes/challenge cookies**;
(13) `timingSafeEqual` both sides must be equal length — always pad/convert, never `===`; (14) replay guard writes
only on _matching_ counter, never on window misses.

---

## 5. Test matrix (additions; existing suites must stay green)

| #   | Suite                           | Cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | totp.test.ts                    | RFC 6238 Appendix-B vector: secret "12345678901234567890" (ASCII bytes) base32-encoded, T=59 → 287082 (6-digit); T=1111111109 → 89005924→6-digit 005924? (assert against computed local reference — executor computes with the same implementation, cross-checked against RFC's 8-digit values mod 10^6); window: code at t0 accepted at t0±1 (>=90s later), rejected outside; wrong code → false; malformed secret/empty code → false; base32 round-trip: 20 random bytes → encode → decode = original; uppercase/no-padding invariant |
| 2   | replay-guard.test.ts            | same (user, counter, code) twice → second false; different counter same code → true; multi-user isolation; prune: old counters dropped; cap: 10k users eviction; clock injection                                                                                                                                                                                                                                                                                                                                                        |
| 3   | password-login.totp.test.ts     | off mode: user with secret → straight session (byte-identical to M3); optional: with secret → challenge cookie + 302 (no session cookie on this response); without secret → session; required: without secret → 401 + failure counted; wrong code → 401 + failure counted; correct code → session + challenge cleared; replay (second POST same code) → 401; expired challenge (clock injection) → treated as no challenge → password path                                                                                              |
| 4   | password-endpoints.totp.test.ts | GET /auth/login with valid challenge cookie → challenge page HTML (code input present); without → password page; POST dispatch: code-with-valid-challenge → TOTP path; code-without-challenge → password path (username/password fields); 405 unchanged; rate: 5 bad codes → 429 with retry-after; users-file error → 503                                                                                                                                                                                                               |
| 5   | integration.totp.test.ts        | Real stack, real scrypt, real TOTP, injected clock: full two-stage (password → 302 challenge → GET challenge page → POST code → 302 + session cookie works on `/__auth_probe`); wrong code; replay; required-mode no-secret user; disabled user (TOTP or not) blocked at password stage; `mode:"token"` unchanged regression (smoke-level)                                                                                                                                                                                              |
| 6   | cli.test.ts additions           | totp enable: new user → secret printed + users.yaml contains 32-char base32 + URI; existing secret → exit 1 + stderr; missing name/bad name → exit 1; disable: removes secret, idempotent, unknown user → exit 1                                                                                                                                                                                                                                                                                                                        |
| 7   | slice:check                     | new slice passes (features/totp only barrel-imported by root; password never imports it)                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Coverage: keep ≥ 80 % red line (new files are small and densely exercised).

---

## 6. Implementation order

1. `scripts/verify-slice-boundaries.mjs` FEATURE_SLICES += `"totp"` (else new dir is `null` → slice:check fails).
2. `totp.ts` + `totp.test.ts` (pure functions first, vectors green).
3. `replay-guard.ts` + test.
4. `login-page.ts` challenge card + test (card HTML assertions in endpoint tests).
5. `password-login.ts`/`password-endpoints.ts` TOTP branch + challenge cookie + tests (T6/T8 logic).
6. `index.ts` config + wiring (T4/T10) + `integration.totp.test.ts`.
7. `features/totp/cli.ts` + cli.ts branch + tests.
8. `npm run build` (lib/ in same commit), full `npm run verify`.
9. **otplib cross-validation script** (temp dir, transcript for handoff-m4).
10. ADRs (T15) + decisions.md + README zh/en + docs/implemented/impl-m4_zh.md; final verify.
11. Server smoke (handoff-m3 §4 workflow adapted: add TOTP user via new CLI, exercise §3.4 flow), then
    `docs/handoff/handoff-m4.md`.
