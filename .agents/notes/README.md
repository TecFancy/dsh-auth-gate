# Agent Notes

English | [中文](README.zh.md)

One kind of design doc lives here. An **Agent Note** records a decision or
proposal that affects this codebase - the _why_ and _what we gave up_, the
parts code and docs can't carry. This file defines where Agent Notes live,
when to write one, and the in-file format.

The model is copied from the deepseek-harness `.agents/notes` tree: a
four-lifecycle, six-class decision-note system that humans review sparingly
and machines verify strictly.

## Layout and naming

Every Agent Note has two axes, both encoded in its **path** -
`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`:

- **Lifecycle** (the top-level folder) is the Agent Note's status, and a note
  moves between folders as that status changes:

  - **`proposed/`** - proposals reviewed before implementation; not yet built
    (or only partly).
  - **`implemented/`** - the decision shipped. The file records what was
    decided and what was rejected, and is **kept current with what actually
    shipped**: when the code later moves a file, renames something, or changes
    a key/default, the note is updated in the same change to match (facts only -
    paths, names, structure - not the decision itself).
  - **`rejected/`** - the proposal was considered and declined. Keep it only
    while its rationale prevents a tempting, meaningful mistake; otherwise
    delete the complete triplet.

- **Class** (the nested folder) is the _kind_ of decision - see
  [Classification](#classification) below.

The date in the filename is when the topic was **first proposed** (per git
history). Cross-references between notes use relative markdown links
(`[topic](../../implemented/architecture/2026-…-….md)`) - never bare prose or
numbers - so they are mechanically checkable and survive moves between
folders.

The active lifecycle tree is the working inventory: browse its
lifecycle/class folders or search the repository. There is **no centralized
`INDEX.md`** in this tree - the tree itself is the index. Low-future-value
implemented records move to the separate frozen
[`archived/`](archived/AGENTS.md) tree described below.

## Lifecycle transitions

A note starts in `proposed/` (substantial future work) or `implemented/` (a
decision already made) and moves between folders as its status changes. The
legal moves are exactly these:

| From           | To                                | What changes                                                                                                                                            |
| -------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proposed/`    | `implemented/`                    | `## Proposal` becomes present-tense `## Decision`; proposal-era sections fold into `## Consequences`, and the plan is dropped in favour of what shipped |
| `proposed/`    | `rejected/`                       | the reason is added to the `Status:` line and the file freezes                                                                                          |
| `implemented/` | [`archived/`](archived/AGENTS.md) | the triplet moves; an `Archived:` date line is added                                                                                                    |
| `implemented/` | _deleted_                         | only when fully superseded and consolidated into the note that now owns the decision                                                                    |
| `rejected/`    | _deleted_                         | when it no longer prevents a plausible mistake                                                                                                          |

Four facts about these transitions are not obvious from the folder list:

- **`rejected/` is never archived.** Archiving preserves a shipped decision's
  rationale; a rejected note records no shipped decision, so there is nothing to
  freeze. A rejected note is kept as a guardrail or deleted - see
  [Archiving](#archiving).
- **`archived/` is terminal.** A sealed triplet is permanently frozen and never
  moves, changes status, or returns to the active tree.
- **`proposed/` never goes straight to `archived/`.** Only implemented notes
  enter the archive. A proposal that is no longer worth pursuing is **rejected**,
  not archived - see [When to write one](#when-to-write-one). Reaching the
  archive from a proposal would require rewriting its `Status:` to `implemented`,
  which states that the work shipped when it did not.
- **A plan is dropped, not folded, when the work ships.** `## Plan` is legal in
  `proposed/` and `rejected/` and banned in `implemented/`, so this move deletes
  the plan rather than carrying it forward. The gate never sees the move, only
  the illegal heading in the destination snapshot - see the paragraph below.

The gate validates **snapshots, not transitions**: it reads the current tree and
each file's contents, never git history. So the enforcement of "only implemented
notes enter the archive" is the `Status:` line itself - a file in `archived/`
must declare `Status: implemented`, and any file that does is accepted regardless
of where it came from. Provenance is not mechanically checkable from a snapshot,
which is why the transitions above are stated here as policy: whether a note
reached its folder by a legal route is a **review** question, and git history is
the record that answers it. The same asymmetry governs `## Plan`: what the gate
checks is which folder the heading sits in right now, not whether the note
arrived there by a legal route.

## Classification

Each Agent Note belongs to one path-encoded class from the closed set in
`scripts/check-notes.mjs`; the classification gate rejects other folders.
Adding a class requires updating the canonical set and this section.

| Class            | What it covers                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `feature`        | A new user- or model-facing capability.                                                                          |
| `bug-fix`        | Corrects a defect or closes a gap a postmortem surfaced.                                                         |
| `simplification` | Removes code, behavior, or surface area without adding a capability.                                             |
| `architecture`   | A structural decision about the **shipped source** - how packages relate, what the runtime vocabulary is.        |
| `process`        | Tooling, policy, or workflow **around** the code - gates, the package manager, vendoring - not runtime behavior. |
| `testing`        | Test infrastructure and strategy.                                                                                |

The `architecture` / `process` line: **architecture** is about the source we
ship; **process** is the surrounding tooling and workflow. (`refactor` is
deliberately absent - it overlaps `simplification`, whose discriminator,
"does observable behavior change?", already covers it.)

## When to write one

A change **MUST** add or update at least one Agent Note in the same PR when it
falls into any of these buckets:

- changes behavior, architecture, or a contract shared across files/packages
- changes process, tooling, or workflows (gates, scripts, CI)
- changes testing strategy
- changes an on-disk, wire, or configuration format
- makes a choice a maintainer may reasonably revisit later

A proposal for substantial future work starts in `proposed/`; a decision
already made starts in `implemented/`. Pick the class folder that matches the
decision (see [Classification](#classification)). Updating the note that
already owns the decision satisfies the rule; do not create a duplicate.

A change is **exempt** only when it is purely mechanical or purely local with
no change to behavior, contracts, structure, process, or rationale: a typo, a
formatting tweak, a file relocation, a behavior-preserving refactor. Exempt
changes don't need a note and don't need an explanation.

A note is never edited into a _different_ decision: supersede it with a new
one, and keep both notes cross-linked. An implemented note that is fully
superseded may be consolidated into the current owner and deleted - only after
preserving every unique rationale, alternative, consequence, and verification,
repairing every inbound link, and deleting the Chinese counterpart and record
in the same change. Partial supersession does not qualify: keep both cross-linked.

## The file format

### The header block

The first three lines of every Agent Note are exactly:

```markdown
# Agent Note: <title>

Status: <status>
```

followed by a blank line. The `Status:` value is one of three forms, and must
agree with the lifecycle folder the file sits in - the gate cross-checks them:

- `Status: proposed`
- `Status: implemented`
- `Status: rejected - <why, in one line>`

A note in `archived/` is the single exception: it keeps `Status: implemented`
and carries `Archived: YYYY-MM-DD` on the line directly below it (see
[Archiving](#archiving)). The `Archived:` line is a header field, so it is only
valid in that position and only in `archived/` - a date line anywhere else is a
half-archived state the gate rejects, and a matching line in the body does not
satisfy the header requirement.

The status carries no dates and no parentheticals: the filename holds the
first-proposed date, git holds everything else, and an "accepted in amended
form" note is body content. The rejection reason is the one status with
content, because a rejected note's verdict is the fact readers come for.

### The body skeleton

Every note opens its body with `## Problem` - the motivation, written to
stand without the solution. What follows depends on the lifecycle; recurring
sections use these canonical names and nothing else, while genuinely bespoke
technical sections remain free-form between the required ones.

#### `proposed/`

```markdown
## Problem

## Proposal

…bespoke sections…

## Alternatives considered

## Acceptance criteria

## Risks
```

`## Proposal` is the intended change and may speak in the future tense -
plans, migration steps, and open questions belong here while the work is
unbuilt. `## Acceptance criteria` says what observable state means done.
`## Risks` covers both what could go wrong and what the change knowingly
gives up.

A note records the **decision**, not the work order. `## Proposal` states what
will change and why; it does not carry the material the change will be made of.
Three shapes stay out of the tree, because they are written for whoever executes
the work and are obsolete the moment it ships: the **whole-file contents** a
change is about to write (they belong in the commit that writes them),
**numbered step-by-step procedures**, and **command recipes** - a recipe being a
sequence that builds the change. Judging the result is not a recipe: a single
command that demonstrates an acceptance criterion, a migrates-from/to fixture, or
a reproduction of the defect belongs with the criterion it settles. What a later
reader needs in order to judge the decision stays in: what is being chosen, why,
what lost, how completion is judged, what could go wrong, and the stable
contracts the change fixes - public API shapes, module boundaries, and wire or
on-disk formats. A planning tool that emits a step-by-step work order is welcome
to do so outside this repository.

#### `implemented/`

```markdown
## Problem

## Decision

…bespoke sections…

## Alternatives considered

## Consequences
```

`## Decision` describes shipped reality in the present tense, and the whole
file is kept current with it. `## Consequences` records what the trade-off
cost **and** bought. Proposal-era headings are spec-speak here and the gate
rejects them: `## Proposal`, `## Plan`, `## Migration plan`, and
`## Acceptance criteria` may not appear in an implemented note. A `## Testing`,
`## Deferred`, or `## Related` section is fine where it states present-tense
fact.

#### `rejected/`

A rejected note is the proposal, frozen: it keeps whatever proposal-time
sections it had (including `## Acceptance criteria` or `## Plan`), and the
verdict lives on the `Status:` line. Only the header block, the `## Problem`
opener, a `## Proposal` section, and the Alternatives-considered mandate below
apply.

### Alternatives considered - mandatory

Every note carries an `## Alternatives considered` section: each genuine
alternative and why it lost, one bold-led paragraph per alternative or a
`### Why not <X>?` subsection per contested one. A decision recorded without
what it beat invites re-litigation.

Alternatives are recorded, never invented.

### Moving between lifecycles

Which moves are legal is a policy question answered by
[Lifecycle transitions](#lifecycle-transitions); this section covers the
mechanics. Moving a file between lifecycle folders means updating the `Status:`
line and re-satisfying that folder's skeleton in the same change - the gate
fails the move otherwise. Concretely, `proposed/` → `implemented/` rewrites
`## Proposal` into a present-tense `## Decision`, folds `## Acceptance
criteria` and `## Risks` into `## Consequences` (or a present-tense
`## Testing`/`## Verification` section for what now pins the behavior), and
drops plans in favor of what shipped. `proposed/` → `rejected/` only adds the
reason to the `Status:` line and freezes the file.

## Archiving

Archive an implemented note when the shipped decision is complete and its
rationale is unlikely to guide future work. Keep it active while its
alternatives, ownership boundary, negative guarantee, durable or wire
semantics, security rule, or reintroduction condition remains useful. Never
archive a proposed note: reject an obsolete proposal.

`implemented/` and `rejected/` are the only two lifecycles with an exit, and
they differ - see [Lifecycle transitions](#lifecycle-transitions) for the full
set of legal moves. An obsolete proposal is rejected rather than archived.

The archive is path-encoded as `archived/{class}/yyyy-mm-dd-topic-title.md`;
`implemented` is deliberately absent because only implemented notes can enter
it. An archival change moves the complete English/Chinese/sidecar triplet,
retains `Status: implemented`, inserts the same `Archived: YYYY-MM-DD` line
immediately below that status in both language files, re-records the sidecar,
seals the new files with `npm run archives:check -- --write`, and repairs or deletes
inbound links. These are the only permitted content changes during archival.

The `Archived:` date is the day the note was archived, and it cannot precede the
date in the filename - that one is when the topic was first proposed, and a note
cannot be archived before it existed. The gate compares the two, which is
possible precisely because both live inside the file.

Once sealed, every archived triplet is permanently frozen. Do not edit,
translate, reformat, update, move, or delete it, and do not treat it as
authority for current behavior. Freezing is machine-enforced: every archived
file is sealed by a SHA-256 in `archived/manifest.json`, and
`check-archives.mjs` (`npm run archives:check`) fails on an edited, deleted,
moved or unsealed file, and on a manifest that lost or changed an entry already
committed at the baseline. `check-notes.mjs` still checks their shape and
`check-bilingual.mjs` keeps their sidecars honest; `check-note-links.mjs` does
not read links out of archived notes, since a sealed note cannot be repaired.
Active prose may still link into an archived note when it intentionally cites
history; those links are checked.

## Bilingual counterparts

A `.zh.md` counterpart mirrors its English sibling's structure section-for-
section under the repo's i18n contract (`docs/` pairing gate). The
machine-checked header tokens (`# Agent Note: ` and the `Status:` line) stay
in English verbatim. The format gate skips `.zh.md` files - the pairing gate
checks their consistency. Both languages carry equal authority.
