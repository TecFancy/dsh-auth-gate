# Agent Note: Adopt the fsd-react agent-engineering structure

Status: implemented

English | [中文](2026-11-16-agent-engineering-restructure.zh.md)

## Problem

This repository had 145 Markdown documents, 38 numbered ADRs, four frozen
executable specs, three handoff documents, and no machine check that any of them
agreed with each other. The symptoms were measurable:

- **47 documents were unreachable.** `docs/README.md` was the only navigation
  page and nothing linked to it from `AGENTS.md` or `README.md`, so the whole
  `docs/` tree was reachable only by knowing the path.
- **The navigation page was stale.** It said the decision index ran to D32 when
  it ran to D38, listed one external review when there were four, and called a
  shipped plan "in progress".
- **The decision index was at its capacity limit.** `docs/decisions.md` was
  49803 bytes against a 50 KiB red line: 97.3% full, one more decision from
  failing.
- **The archive seal could be bypassed.** It compared the working tree against
  the working manifest, so editing a sealed file and its hash together passed.
- **Four dead links shipped green.** `docs/conventions.md` linked
  `./decisions.md` from a directory where that path does not resolve.
- **30 of 30 Chinese documents had no language switcher**, and nothing compared
  the two sides' structure, so a translation could silently drop a code block.
- **The skills had no gate at all.** Three `SKILL.md` files were never parsed by
  anything; one of them carried an unquoted colon in its `description`, which a
  YAML consumer refuses.
- **`check-live-entries.mjs` was an orphan.** It was in no npm script and no CI
  step, so nobody ran it.

`fsd-react` solved the same class of problem with a different structure: a fact
taxonomy, a four-lifecycle note tree, a gate registry with negative self-tests,
reachability and bilingual gates, and a PR check that requires a decision note.
This note records adopting that structure here, and the places where copying it
would have been wrong.

## Decision

Adopt the fsd-react agent-engineering structure, adapted to a backend plugin
with a large historical corpus.

**The fact taxonomy.** `AGENTS.md` now carries a table naming one home per kind
of fact: rationale in `.agents/notes/`, current state in `docs/`, standing rules
in `docs/conventions.md`, work orders nowhere in git. The table is the thing
that makes the rest of the structure legible; without it, a new document has no
obvious home and the tree grows by accretion.

**The note tree.** The 38 numbered ADRs moved into
`.agents/notes/{implemented,archived}/{class}/` as triplets (English, Chinese,
sidecar). Each note keeps a `Legacy ID: D<n>` line, so the 875 existing `D<n>`
citations (141 of them in `src/` comments) still resolve. `docs/decisions.md`
became a static compatibility table, 7619 bytes, and new decisions do not get a
number.

**The docs split.** `docs/conventions.md` (2874 words, six unrelated
subjects) became `docs/conventions.md` (commands, gates, CI, releases),
`docs/architecture.md` (the source tree and its layering rules) and
`docs/security.md` (the negative guarantees). The security page is the one
addition with no fsd-react counterpart, and it is a prerequisite rather than a
nicety: the fail-closed rule, the trusted-proxy rule and the signed challenge
cookie were documented only inside the frozen `impl-mN` specs, so demoting those
specs to history without extracting the invariants first would have left the
security contract with no current home.

**The historical area.** 46 documents moved to
`docs/history/{specs,handoff,plans,reviews,evidence}/`, frozen and sealed. They
are evidence, not instructions: `AGENTS.md` does not require them, and the
bilingual and prose gates skip them, because re-translating a frozen record
would edit the record.

**The gate registry.** `scripts/lib/gate-registry.mjs` is the one list of gates.
`run-gates.mjs` derives the `verify`, pre-commit and self-test runs from it and
refuses to start when the list disagrees with the npm scripts, the hook or the
workflow. The change-surface scenarios the old runner had are kept: a docs-only
change must not pay for coverage and a double build.

**The gates.** Reachability and link checking, doc word budgets, the note tree
and its links, the archive seal with a trusted baseline, bilingual pairing with
a structural signature, skill front matter and links, and the generated
`.claude/skills/` mirror. Each has a `--self-test` that pins the negative cases
it exists to reject.

**The PR check.** `.github/workflows/require-decision-record.yml` requires a
note (or a stated exemption) when a PR touches code, tooling or configuration.
The release-please exemption is narrow: the generated branch name and exactly
the four version files, so a release PR that smuggled a change in still fails.

## Alternatives considered

**Copy fsd-react wholesale.** Rejected: it is a frontend template. Its FSD slice
guide, design tokens, Stylelint, Betterer and SonarQube skills have no
counterpart here, and its `docs/` is five files against this repository's 145.

**Keep the numbered ADR index and only fix its size.** Rejected: the index was
97.3% full and had no machine check, so it would have hit the red line again
within one decision. Generating a compact table from the note tree removes the
capacity problem and the staleness problem together.

**Migrate the ADRs incrementally (strangler fig).** Considered and rejected by
the user in favour of a one-shot migration. The argument for incremental was
that 36 notes need a `Consequences` section that the old ADRs do not have, and
inventing one would state a cost nobody recorded. The migration therefore keeps
`## Why` and adds `## Consequences` only where the source already had it; a note
without one is honest, a generated one is not.

**Keep `docs/conventions.md` as one file and add a budget.** Rejected: the
file mixed commands, gates, architecture, security, releases and dependency
policy. A budget would have capped its growth without giving any of those
subjects a home, and the security invariants would still have been buried in a
frozen spec.

**Make the Chinese prose gate blocking immediately.** Rejected for now: the rule
set is calibrated, but the existing corpus has 319 findings across 38 documents.
Making it blocking in a structural refactor would mean either rewriting 38
documents or lowering the rule. It ships as a report (`npm run zh:prose --
--status`) with a registered `manualReason`, and becomes a gate once the corpus
is clean.

**Keep the legacy `docs/decisions/archived/` seal alongside the new one.**
Rejected: the content moved into the note tree, so keeping the old directory
would create a second authority. The archive gate treats a missing legacy
directory as retired and still fails on a half-deleted one.

## Consequences

**Bought.** Every current document is reachable from an entry point and every
link resolves. The decision index dropped from 49803 to 7619 bytes. The archive
seal now catches an edit-and-rehash. A translation that drops a code block
fails. A skill with an unloadable front matter fails. A gate that stops
rejecting its negative case fails. A PR that changes code without a note fails.

**Cost.** The gate count went from 15 to 20, and `verify` now runs the
self-tests too, so a full local run is slower. The note tree is 114 files where
the ADR directory was 76, because each note carries a sidecar. The bilingual
gate now requires a language switcher and a matching structural signature on
every current pair, which is real work on every translation.

**Given up.** The `D<n>` numbering is closed: a new decision is identified by
its path, not a number. The frozen specs are no longer the authority for current
behaviour, so a reader who wants to know what the guard does must read
`docs/security.md` and the code, not `impl-m1`. The historical area's outbound
links are not repaired after sealing, so a link inside a frozen document may
point at a path that no longer exists.

**Not done.** The Chinese prose gate is a report, not a gate. The
`agent-notes-heartbeat.yml` weekly sweep was not adopted: with no `proposed/`
notes yet it would only produce noise. `gen-zh-brief` and the local blob pinning
were not adopted: the sidecar records the confirmed state, and the briefing tool
is worth adding only once the cost of updating a pair is measured.
