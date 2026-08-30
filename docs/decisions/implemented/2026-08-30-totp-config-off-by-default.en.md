# Three-state TOTP config, default off

## Decision

New config `totp: "off" | "optional" | "required"`, default **`"off"`**.
`off`: `totpSecret` is ignored (pure password flow; out-of-the-box behavior identical to M3).
`optional`: users with a secret go two-stage, users without stay single-stage.
`required`: every user must complete two-stage; a user without a secret fails with the uniform 401.

## Context

TOTP is a hardening feature, and upgrades must not silently change existing deployments.
Instances shipped in M3 may or may not already carry `totpSecret` values in user records
(parsed but unused). The config surface needs to express both "enabled?" and "how mandatory?",
while the anti-enumeration discipline (P9) requires every failure path to be a uniform 401 —
no config-driven signal like "you are the only one without TOTP".

## Alternatives Considered

- **Boolean `totpEnabled`** — cannot express the difference between "everyone must" and
  "only those with a secret".
- **Default `"optional"`** — changes behavior on upgrade (users with secrets suddenly face a
  second stage), violating the zero-surprise upgrade principle.
- **Per-user opt-in only (no global switch)** — cannot enforce a baseline hardening across all users.

## Why

Default `off` keeps M3 behavior byte-identical; `required` gives high-baseline deployments full
enforcement; `optional` provides a gradual migration path (enable for admins first, then roll
out). The three states cover upgrade compatibility, progressive enablement, and enforced
baselines; the default choice prioritizes not surprising existing deployments.
