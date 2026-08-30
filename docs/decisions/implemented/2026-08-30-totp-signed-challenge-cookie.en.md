# D10. HMAC-sign the TOTP challenge cookie (replaces D6's "not signed")

## Decision

The challenge cookie value changes from `<username>.<expiresEpochMs>` to
`<username>.<expiresEpochMs>.<mac>`, with
`mac = HMAC-SHA256(process-random key, <username>.<expiresEpochMs>)` (base64url). The key is
generated once in `apply()` via `randomBytes(32)` and lives as long as the rate limiter / replay
guard; parsing compares the MAC in constant time, and any invalid value is treated as "no
challenge" (password path). The rest of D6 (stateless, no pending session, no password
re-submission, TTL 300s, SameSite=Lax, cleared on success in the same response) is unchanged.

## Context

D6 rejected signing the challenge token: the cookie only proves "the password stage passed
recently"; the real gate is the TOTP code, and forging a username only changes whose secret is
verified. A security review (Grok 4.6, 2026-08-30) pointed out the residual risk: an **unsigned**
cookie can be forged to **skip the password stage** — an attacker who writes
`dsh_auth_challenge=<victim>.<future-ts>` only needs the victim's current 6-digit code
(shoulder-surfing, malware, same-window code theft) to finish the login; the 2FA AND semantics
(password **and** code) degrade to TOTP-only. The `off`-mode and `disabled` gaps fixed alongside
this decision (`totpMode` routing and `user.disabled` checks in the submit path) further amplified
the "password stage is skippable" outcome.

## Alternatives Considered

- **D6 as-is (unsigned, document only)** — zero code change, a fresh cookie still resumes the
  challenge after restart; but "anyone with the current TOTP code can skip the password" must be
  written into the README as an accepted risk, and the two-stage guarantee does not hold. Only
  suitable for internal doors that accept "TOTP code == login".
- **Server-side pending challenge** — introduces storage/cleanup state, conflicts with the
  stateless architecture (already argued in D6); rejected.
- **One-time random token bound to the challenge** — equivalent to a pending state; rejected for
  the same reason.

## Why

"Skip the password" turns TOTP from a second factor into the only factor, which is unacceptable
for a single-door public deployment. A process-level HMAC adds no config, no dependency and no
storage, and matches the in-memory limiter/replay-guard model (T4 "no other new config", D1
fail-closed). The cost — in-flight challenges die on restart/plugin reload, forcing a password
re-entry, window ≤ 5 minutes — is the same order as the documented "challenge lasts 5 minutes"
and is explicitly noted in the README.

## Impact

- New module `src/features/password/challenge-cookie.ts` owns build/parse (inside the password
  slice); password gets the key through deps (`challengeMacKey: Uint8Array`), never imports totp
  (D9).
- After upgrading to a version with this decision and restarting, legacy plaintext cookies parse
  as "no challenge" — users land on the password page and sign in again.
- Tests: `challenge-cookie.test.ts` (tampered / legacy plaintext / wrong key / dotted username /
  expired); stage2 endpoint tests updated accordingly.
