# Configurable logout CTA order (2026-08-30 backfill from v0.10.0)

## Decision

The logout button's slot order in Settings - General is configurable via
`logoutOrder` (natural, max 10000, default 1000) and forwarded to the client
half through `GET /auth/status`.

## Context

dsh's built-in settings entries sit in the -25..20 order band and most
third-party plugins sit below 1000. A hard-coded order could collide with a
plugin registering a larger order, pushing the logout action to an unexpected
position. v0.10.0 shipped this before the settings-surface work was fully
frozen.

## Alternatives Considered

- **Fixed constant** — rejected: cannot adapt to a host plugin that registers
  a larger order.
- **Auto-probe the maximum registered order** — rejected: probing slots at
  runtime is brittle and creates ordering feedback loops.

## Why

An explicit knob is simpler and more predictable than discovery; the default
1000 already clears every known entry, and raising it is a one-line config
change per deployment that needs it.

Backfill note: registered as part of the decision-record process landing
(2026-08-30); the change itself shipped in v0.10.0.
