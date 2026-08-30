# Guard wraps the webServer, not a fork (2026-08-30 backfill from M1)

## Decision

The login gate is applied by wrapping the `webServer` service's four entry
surfaces (route-table registration, upgrade registration, fallback
registration, and dispatch) from inside the plugin, plus a startup self-check
(`assertGuarded`, fail loud). The dsh web host itself is not forked.

## Context

M1 needed a way to force every page, API call and WebSocket connection through
the gate. The `webServer` service is provided by the dsh web-app composition;
upstream offers no contract middleware hook at the time.

## Alternatives Considered

- **Fork dsh-web-app and add the gate upstream** — rejected: a fork diverges
  from upstream forever and every dsh update becomes a merge exercise.
- **Register routes before/after and rely on route ordering** — rejected:
  routes registered after this plugin applies would bypass the gate; the
  four-surface wrap makes the plugin the last word on all entries.
- **No self-check** — rejected: a silently unguarded deployment is the worst
  failure mode for an auth plugin.

## Why

Wrapping is the smallest invasive surface a plugin can ship: the wrapper
returns a disposer that restores the exact pre-wrap state, and routes landing
after apply are caught by the wrapped register path. The startup self-check
turns "silently unguarded" into "boot fails with a clear error" - the
fail-loud companion to the fail-closed gate.

Backfill note: registered as part of the decision-record process landing
(2026-08-30); the original frozen decision lives in docs/implemented/impl-m1.md.
