# <Feature> — <one-line description> (implementation spec)

> **Status**: proposed / in progress / implemented
> **Scope**: what it builds on / which milestone it belongs to (M0–M5)
> **Source**: date + verification instance + origin (review / ADR / plan section)

## 1. Background

Why this exists: the gap, the constraint it works around, the failure it fixes.

## 2. Behavioral contract

| Scenario | Behavior |
| -------- | -------- |
| ...      | ...      |

Fail-open / fail-closed scope must be explicit here.

## 3. Frozen design decisions

- **D-<name>-1**: decision + reason (one line each; cite the ADR when one exists).

## 4. Deployment notes

Topology requirements, interaction with reverse-proxy modes, operational
hygiene (logs, tokens, cookies).

## 5. Tests

- Unit: file list + what each covers.
- Integration: real-stack cases (assembly edges, not hand-mounted fakes).

## 6. Change log

| commit   | content |
| -------- | ------- |
| `<hash>` | ...     |
