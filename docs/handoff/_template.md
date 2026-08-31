# handoff-<mN> — <phase> execution handoff

> Environment facts and process knowledge: things that are not in the repo,
> cost a lot to rediscover, or are known pitfalls. A new session working on
> the phase **must read this file first** (per AGENTS.md).
> This document describes _how_; the executable spec (`docs/implemented/impl-mN.md`)
> is the authority for _what/why_.

## 1. Environment facts

- Server / profile / instance paths; SSH aliases; how to check whether the
  instance is running (pgrep / curl).
- Versions pinned in the profile and where they come from.

## 2. Process knowledge & pitfalls

1. Numbered pitfalls discovered (each: symptom → cause → fix), including
   harness internals, tooling traps, and test-harness gotchas.

## 3. Verification sequence

- The exact steps to prove the phase works (smoke commands, expected output).

## 4. Handoff to the next phase

- Open items, leftover probes that must be removed, TODO(auth-mN) markers.
