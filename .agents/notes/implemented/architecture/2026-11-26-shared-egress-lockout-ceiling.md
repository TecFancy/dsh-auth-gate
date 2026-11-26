# Agent Note: The IP rate-limit bucket stops escalating at two minutes

Status: implemented

English | [中文](2026-11-26-shared-egress-lockout-ceiling.zh.md)

## Problem

Issue #82: since D19 the bucket key is the real client address, so every user behind one egress
address (office NAT, mobile CGNAT, VPN exit) shares a single `byIp` bucket. Five mistyped passwords
from one device lock the whole address out. That is the usual trade-off of address-based throttling -
the per-account bucket is what protects a password - but D39 sharpened it: escalation is real now,
`strikes` survive lock expiry, and only 600 s of quiet decays them. A busy shared address therefore
does not see a repeating 30-second lock any more; it can be held at 900 seconds.

The asymmetry is the point. An account bucket names a principal that can be punished: the failures
belong to whoever is guessing that password. An address bucket names a network, and on a shared
address the failures usually belong to one person while the lock lands on their colleagues.
Escalating an address adds no deterrence against the attacker - they sit inside the same bucket and
can simply stop - it only lengthens the collateral.

## Decision

`LoginRateLimiter` caps only the `byIp` bucket at `ipMaxDelaySeconds` (default 120 s); account
buckets keep `maxDelaySeconds` (default 900 s). Both still share `maxFailures`, `baseDelaySeconds`
and `windowSeconds`, so the sequence is unchanged up to the cap: 30 → 60 → 120, and then 120 for the
address while a targeted account continues to 240 / 480 / 900.

Everything else stays as D39 left it. The IP bucket still produces the collateral lockout - that is
the spray brake - a successful login still clears the account bucket only, a burst still cannot
spend more than one probe once a bucket's budget is spent, and `ipMaxDelaySeconds` is clamped to
`maxDelaySeconds` so a caller cannot make the address ceiling the looser one.

The option is internal: a `RateLimitOptions` field with a default, not a plugin config key. An
operator who wants a different ceiling has to change code, which keeps the trade-off reviewable in
one place instead of turning it into a deployment knob nobody benchmarks.

## Alternatives considered

- **Document the 900-second collateral and change nothing (issue #82 option 1).** Cheapest, and
  rejected because the escalation buys no deterrence on a shared address: the attacker is inside the
  same bucket, so the extra minutes fall on bystanders only.
- **Throttle the IP bucket instead of locking it (option 2).** A fixed short window caps the damage
  further, but it also weakens the one brake that covers spraying and the accountless flows (token,
  passkey): five guesses per two minutes becomes roughly ten per minute, and a delay-based variant
  would need a new response path and hold the connection open.
- **Lock the address only once failures span several usernames (option 3).** Costs a per-bucket set
  of account keys (cardinality and memory), does nothing for token or passkey where there is no
  username, and a determined sprayer can trip it deliberately.
- **A config switch that disables the IP bucket (option 4).** Removes the only protection on
  accountless flows and on spraying across many accounts; an operator who misreads it turns the gate
  into a per-account lockout only.
- **Never escalate the address at all (flat `baseDelaySeconds`).** Less code, same objection as the
  throttle: a single client could sustain five guesses every thirty seconds against every account
  behind that address, forever.

## Consequences

- Worst-case collateral on a shared address drops from 15 minutes to 2. The sprayer's budget per
  address drops with it - about five guesses per two minutes instead of five per fifteen - which is
  the deliberate trade: a determined sprayer rotates addresses anyway, and the account bucket still
  bounds any single target.
- There are now two ceilings to keep in mind when tuning: `baseDelaySeconds` and `maxFailures` move
  both sequences, while the two caps move only their own bucket.
- No configuration surface changed, so deployments need no new setting;
  [`docs/deployed/known-limitations`](../../../../docs/deployed/known-limitations.md) states what a
  shared-egress deployment should expect.
