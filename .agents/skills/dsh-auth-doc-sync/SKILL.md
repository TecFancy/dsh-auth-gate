---
name: dsh-auth-doc-sync
description: >
  Use when finishing a PR-sized chunk of work in the dsh-auth repo, or when the
  user says "commit", "wrap up", "next step", "update the docs", "sync the docs",
  or "doc sync", to decide which documents the change owes an update to
  (architecture, security, conventions, an Agent Note, a deployment page) and to
  keep note lifecycle and archiving honest. Not for choosing which checks to run
  before a push (use dsh-auth-pre-push), and not for reviewing a change (use
  dsh-auth-code-review).
origin: local
---

# Doc Sync

Guidance, not a checklist. The name describes its trigger, not a licence to stop
thinking: its job is to ask, once a change is done, which documents that change
makes wrong or incomplete, and to answer from the diff. Most small changes (a bug
fix, an added test) owe nothing beyond the one question "does this need an Agent
Note?", and the right outcome is often "no update".

Documents here are ordinary repository files, so they ship in the same pull
request as the code and are reviewed with it.

## Sources of truth

- [AGENTS.md](../../../AGENTS.md): the fact taxonomy, which says which home each
  kind of fact has (rationale in a note, current state in `docs/`, standing rules
  in `docs/conventions.md`).
- [docs/conventions.md](../../../docs/conventions.md): the standing rules, the
  gate commands, and the release flow.
- [.agents/notes/README.md](../../notes/README.md): when a change owes a note,
  the lifecycle transitions, the body skeleton, and the archiving rules.
- Siblings: [dsh-auth-pre-push](../dsh-auth-pre-push/SKILL.md) picks the checks
  that prove the change, [dsh-auth-code-review](../dsh-auth-code-review/SKILL.md)
  reviews someone else's change.

## What this skill is not

- Not the writing standard. It decides **which** documents a change must touch;
  what they must say is the reviewer's judgement.
- Not a gate. `docs:check`, `notes:check` and the other gates catch mechanical
  drift; this skill catches the semantic drift they cannot see.
- Not a rule to update every document on every change, and not a reason to
  create new ones: there is no `INDEX.md`, no roadmap and no planning tree.

## Decide from the diff

Work through these in order, and skip any that the change does not reach.

### 1. Architecture reference

If the change touches layering, import rules, routing, the protocol contract or
the module table, check that `docs/architecture.md` is still accurate. An example
in it must survive lint and type-check and may not name a file that does not
exist.

### 2. Security invariants

If the change touches the guard, the gate, session handling, the login page,
rate limiting, or anything that decides whether a request is admitted, check
`docs/security.md`. A new negative guarantee belongs there; a guarantee the
change removes must be deleted from it in the same PR, with the note that
explains why.

### 3. Conventions and notes

Ask:

- Is this a change that needs an Agent Note? The notes README lists the buckets;
  if it is one, add or update the note in the same PR (updating the note that
  already owns the decision satisfies the rule).
- Is there a standing rule to add to `docs/conventions.md` (a new gate, a changed
  command, a changed release step)? Change `docs/conventions_zh.md` in the same
  change, since the pair must carry the same facts.
- Did the source tree change? Then `docs/architecture.md` moves too, and
  `npm run slice:check` has a whitelist to update.

### 4. Note lifecycle

- The change delivers an existing `proposed/` note: move it to `implemented/`
  following the transitions table in the notes README (rewrite the skeleton, do
  not just rename it).
- The change produces a rejected proposal: keep it in `rejected/` with the reason
  on its `Status:` line if it still prevents a tempting mistake; otherwise delete
  the complete triplet.
- A new idea is a `proposed/` note, not a roadmap document.

When adding or updating a note, run the **supersession audit** in the same PR: if
an older note already covers the same decision, mechanism or rejected option,
handle it now. Fully superseded: fold it into the current owner. Partly
superseded: cross-link both and say which section is superseded.

### 5. Deployment pages

If the change alters configuration, a default, a failure mode, an upgrade step or
a reverse-proxy requirement, update `docs/deployed/` and both READMEs. The
README carries the consumer contract; `docs/deployed/` carries the operator
detail.

### 6. Archiving

The bar is **future value**: could this rationale still guide a future change?
Word count and age are leads for finding candidates, never grounds for archiving.
The notes README owns the mechanics (transition, `Archived:` line, sidecar, seal,
inbound links).

- **Keep active**: alternatives that still prevent a re-proposal, negative
  guarantees, ownership boundaries, security rules, reintroduction conditions
  that still hold.
- **Archive**: one-off UI adjustments, narrow adapters, closed small bugs,
  process history whose current behaviour is obvious elsewhere.
- A `proposed/` note is never archived: reject an obsolete proposal instead.

### 7. Writing a new or heavily edited document

- **Verify facts by running them.** A command, field, default or behaviour
  written into a document is one you have run; an assertion that does not run is
  deleted. Change the claim to match the code, never the code to match a stale
  document.
- **The newcomer test.** Could an engineer with no repository background rebuild
  the relevant architecture from three to five linked documents?
- **Current state only.** No compatibility notes, migration history or "it used
  to be"; decision history belongs in `.agents/notes/`.

## Often missed

`README.md`, `AGENTS.md` and `docs/conventions.md` face repository users with
quick-reference commands and conventions. When a command or architectural
convention changed, update them as well; they sit outside most `docs/` sweeps.
After editing, run the gate for what you touched (`npm run docs:check`,
`npm run notes:check`, `npm run notes:links`, `npm run bilingual:check`);
`dsh-auth-pre-push` says which subset is enough.
