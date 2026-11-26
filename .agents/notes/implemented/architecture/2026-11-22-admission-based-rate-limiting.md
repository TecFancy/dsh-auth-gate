# Agent Note: Login rate limiting is admission-based and scoped

Status: implemented
Legacy ID: D39

English | [中文](2026-11-22-admission-based-rate-limiting.zh.md)

## Problem

The login limiter's five-failure lockout held only for a serial client. The check, the password
verification and the failure record were separated by awaits with nothing reserving a slot, so a
concurrent burst could all observe "not locked" before any failure was recorded. The bucket
bookkeeping had two more holes: TOTP shared the password stage's `(ip, username)` bucket and a
correct password cleared it, so an attacker who already held the password could reset the code
counter by re-posting the password; and a locked bucket zeroed `failures` when the lock expired,
so the `maxDelaySeconds` ceiling was never reached and the real rate stayed at five attempts per
`baseDelaySeconds` forever. Every successful login also cleared the shared IP bucket, so one
valid account could launder an IP's failure history. None of these is visible to a serial test:
the suite was green while the in-process limiter only promised anything against one client at a
time.

## Decision

`LoginRateLimiter.admit(ip, account, scope)` performs the lock check, the in-flight reservation
and the bucket lookup in one synchronous section and returns a settle handle. A login handler
reserves a slot before any credential work starts and settles it exactly once with `success`,
`failure` or `abandon` (a `finally` settles `abandon`, which only releases the slot); a failure
settles into the bucket, a success clears the account bucket. Reserved slots count as failures
when admission is decided, so concurrent requests cannot all pass the five-failure gate.

Buckets are namespaced by an auth-domain `scope`: `login`, `totp`, `passkey`, `token`,
`password-change`, `admin`. Only the stage that owns a scope mutates it, so a completed password
stage can no longer clear the TOTP attempt counter, and `clearAccount()` (an admin reset) clears
that account's bucket in every scope.

Backoff is driven by a `strikes` counter that lock expiry does not reset; only a quiet
`windowSeconds` does. The n-th strike (n >= `maxFailures`) locks for
`baseDelaySeconds * 2^(n - maxFailures)`, capped at `maxDelaySeconds` (900 s) for an account bucket
and at the lower `ipMaxDelaySeconds` (120 s) for the IP bucket - see
[the shared-egress ceiling note](2026-11-26-shared-egress-lockout-ceiling.md). Eviction under the
10,000-entry cap ranks idle buckets by earliest lock expiry and fewest failures, never removes a
bucket with an in-flight reservation, and pushes live lockouts to the end of that ranking so a
rotating attacker cannot flush them. A successful admission settles the account bucket only, so a
login never clears the IP bucket.

Admission beyond `maxConcurrentPerIp` (32 in-flight attempts per IP per scope) answers
`retry-after: 1`; this is a concurrency guard, not a lockout. Once a bucket's failure budget is
spent, its next admission opens only one probe at a time, for the IP bucket as well: a burst of
distinct usernames from one address must not settle a whole lockout's worth of strikes at once.
State is still in-process and resets on restart (`TODO(auth-m5)`).

## Alternatives considered

- **Serialize the login handlers behind a per-account async lock.** Rejected: the lock would be
  held across the scrypt and TOTP awaits, turning concurrency into queueing and adding a
  deadlock/timeout surface to the login path. A synchronous reserve-and-settle handle gives the
  same admission guarantee without holding anything across awaits.
- **Give TOTP its own bucket and keep `check`/`recordFailure`/`recordSuccess` as the only API.**
  Rejected: scoping is the general fix - passkey and token are distinct auth domains too - and the
  legacy pair still clears the IP bucket on success, which is the laundering defect.
- **Make `check()` plus `recordFailure()` atomic instead of adding `admit()`.** Rejected: those
  stay the interface for the authenticated admin and password-change surfaces, which are not
  brute-force entries and where clearing both buckets on success is correct; rewriting them would
  drag those flows into a reservation model they do not need.

## Consequences

The five-failure policy now bounds concurrent attempts, the documented escalation to
`maxDelaySeconds` exists, and a TOTP, passkey or token attempt can no longer be reset by a
successful password stage. The cost is one more call protocol on the limiter (`admit` + `settle`)
and a bounded admission queue: a burst above 32 concurrent attempts from one IP per scope gets
`retry-after: 1` instead of a credential check, so a throttled client retries rather than reads a
lockout message. Because state is in-process, a restart still clears every lockout and every
strike history; [the trusted-proxy note](2026-09-22-trusted-proxy-client-ip.md) still decides
which address a bucket is keyed on.
