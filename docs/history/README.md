# docs/history - Frozen historical area

English | [中文](README_zh.md)

**This area is not current authority.** It holds documents that were true when
they were written and are kept as evidence, not as instructions.

Nothing here is required reading for a task. `AGENTS.md` and the skills must not
point at this tree as a prerequisite. When a historical document and the current
code disagree, the code wins.

## What is here

| Directory | Contents | Why it is kept |
| --- | --- | --- |
| [`specs/`](specs/) | The M1-M4 executable specs (`impl-m1` through `impl-m4`), the original roadmap (`dsh-auth-plan`), the pre-D30 refactor plan, and the shipped fix plans (`totp-fix-plan`, `login-page-polish-plan`, `impl-client-logout`, `impl-launch-token-bridge`, `impl-m2-admin`) | They record what each milestone was asked to deliver and the contracts it froze. A reader tracing why a behaviour exists may need them; a reader changing that behaviour does not. |
| [`handoff/`](handoff/) | The per-milestone session handoffs (`handoff-m2`, `m3`, `m4`) | They record the environment facts and pitfalls of the machine each milestone ran on. The durable parts were extracted into `docs/deployed/`; the rest is a snapshot. |
| [`plans/`](plans/) | The passkey feasibility plan and the PR #53 takeover plan | Both shipped or were closed. The decisions they produced are Agent Notes now. |
| [`reviews/`](reviews/) | External review transcripts (Grok 4.6, Kimi K3.1) | They are the evidence behind a fix. A review is not a decision; the decision is the note it produced. |
| [`evidence/`](evidence/) | Versioned entry-coverage reports (`entry-coverage-0.1.5-rc.2`, `0.2.0-rc.2`, `0.2.2-rc.1`) | Each records that every guarded entry was probed and denied on a specific release. |

## Index

Every file here, so the tree is reachable from this page.

### specs

- [dsh-auth-plan](specs/dsh-auth-plan.md) - the original roadmap and threat model (M0-M6)
- [impl-m1](specs/impl-m1.md) - the guard, the wrap seam, the session store
- [impl-m2](specs/impl-m2.md) - the shared-token gate
- [impl-m2-admin](specs/impl-m2-admin.md) - the admin surface slice
- [impl-m3](specs/impl-m3.md) - the password flow
- [impl-m4](specs/impl-m4.md) - TOTP
- [impl-client-logout](specs/impl-client-logout.md) - the client logout action
- [impl-launch-token-bridge](specs/impl-launch-token-bridge.md) - the 0.1.2-alpha compatibility layer
- [login-page-polish-plan](specs/login-page-polish-plan.md) - the shipped visual baseline
- [totp-fix-plan](specs/totp-fix-plan.md) - the 0.11.1 hardening plan (Chinese)
- [totp-fix-plan.en](specs/totp-fix-plan.en.md) - the English side of the same plan
- [src-refactor-plan](specs/src-refactor-plan.md) - the pre-D30 layering refactor

### handoff

- [handoff-m2](handoff/handoff-m2.md) - environment facts and M1 pitfalls
- [handoff-m3](handoff/handoff-m3.md) - the M3 session handoff
- [handoff-m4](handoff/handoff-m4.md) - the M4 session handoff, with the 0.11.1 amendment

### plans

- [passkey-login-plan](plans/passkey-login-plan.md) - the passkey feasibility study (shipped as M6)
- [pr53-login-page-fix-plan](plans/pr53-login-page-fix-plan.md) - the PR #53 takeover plan (closed)

### reviews

- [grok46-dsh-020-host-corridor-review](reviews/grok46-dsh-020-host-corridor-review.md)
- [grok46-launch-token-bridge-review](reviews/grok46-launch-token-bridge-review.md)
- [grok46-d21-token-failure-card-review](reviews/grok46-d21-token-failure-card-review.md)
- [kimi-k3.1-passkey-review](reviews/kimi-k3.1-passkey-review.md)
- [claude-code-0.23-full-repo-review](reviews/claude-code-0.23-full-repo-review.md) - four Claude Code agents over 0.23: guard, auth flows, client, engineering system (eleven P1, no P0)
- [claude-kimi-grok-0.23-fix-review-rounds](reviews/claude-kimi-grok-0.23-fix-review-rounds.md)

### evidence

- [entry-coverage-0.1.5-rc.2](evidence/entry-coverage-0.1.5-rc.2.md)
- [entry-coverage-0.2.0-rc.2](evidence/entry-coverage-0.2.0-rc.2.md)
- [entry-coverage-0.2.2-rc.1](evidence/entry-coverage-0.2.2-rc.1.md)

## Rules

- **Frozen.** A document here is not edited to match current behaviour. If the
  behaviour changed, the current document changed; this one stays as the record
  of what was true then.
- **Not bilingual-gated.** These documents keep whatever language pairing they
  had. They are not re-translated, not given sidecars, and not reformatted.
- **Links out are not repaired.** A historical document may link to a path that
  no longer exists. Repairing it would mean editing a frozen record. Links
  *into* this tree from current documents are checked.
- **Sealed.** `manifest.json` records a SHA-256 for every file here. The seal
  may only grow, and CI compares it against the pull request's base, so editing
  a historical file and its hash together still fails.

## Where the current version of a fact lives

| If you are looking for | Read instead |
| --- | --- |
| How the source is laid out | [`../architecture.md`](../architecture.md) |
| What the plugin must never do | [`../security.md`](../security.md) |
| Commands, gates, releases | [`../conventions.md`](../conventions.md) |
| Why a decision was made | [`.agents/notes/`](../../.agents/notes/) |
| How to deploy or troubleshoot | [`../deployed/`](../deployed/) |
