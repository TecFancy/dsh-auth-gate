# The auth gate fails closed (2026-08-30 backfill from M2/M3)

## Decision

The gate denies when credentials cannot be confirmed: a missing credentials
service yields a permanent deny, a failed token/credential resolution is
treated as "no credential", and the guard stays mounted regardless of service
availability. Failures are loud in logs, never silent.

## Context

Implemented during M2 (shared-token gate) and M3 (password gate). The harness
mounts plugin rows in parallel, so the credentials service may not be ready
when this plugin applies; storage services may be absent on misconfigured
deployments. The deployment target is a public dsh instance.

## Alternatives Considered

- **Fail open on missing services** — skip the guard when credentials are
  unavailable. Rejected: a public deployment without auth is a bare door.
- **Mount the guard only when services are ready** — rejected: readiness
  timing is racy under parallel mounting, and the window before readiness is
  unguarded.

## Why

The asymmetry of auth failure: a false lock can be fixed by an operator, a
false unlock cannot be recalled. The token resolver is therefore fetched per
operation (no caching), and every resolution failure logs an error and returns
undefined - the gate then denies exactly as if no credential existed.

Backfill note: registered as part of the decision-record process landing
(2026-08-30); the original frozen decision lives in docs/implemented/impl-m2.md.
