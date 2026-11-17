# Agent Skills

> **Single source of truth.** Edit files under `.agents/skills/` only.
> `.claude/skills/` is auto-generated (and gitignored) by
> `scripts/sync-skills.mjs` and consumed by Claude Code.
> After editing, run `npm run skills:sync`. `npm run skills:frontmatter` checks
> the part a consumer actually parses (the front matter block) and is unaffected
> by the mirror; run it too before pushing a skill change. `npm run skills:check`
> asserts the one invariant a gitignored tree can carry: the mirror on disk is
> what a sync of the committed sources produces, applied twice to catch a
> generator whose second run differs. It reconciles before it reports, so a clean
> clone and a hand-edited mirror both pass with a note. Cold clone? `npm install`
> (the `prepare` hook) or `npm run skills:sync` regenerates the Claude mirror.

## Skills in this repository

| Skill                  | Purpose                                                                                                                                    | Invocation                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `dsh-auth-code-review` | Review checklist for a change here: enforcement paths, lifecycle and disposal, real-entry-path tests, prose contracts, fail-closed posture | Model-invoked                                        |
| `dsh-auth-pre-push`    | The smallest evidence that covers an outgoing diff, plus force-with-lease discipline                                                       | Model-invoked                                        |
| `dsh-auth-doc-sync`    | Which documents a change owes an update to (architecture, security, conventions, an Agent Note, a deployment page)                         | Model-invoked                                        |
| `dsh-auth-gate-config` | Configuration quick reference shipped with the package: options, the `dsh-auth` CLI, the password policy, login trouble                    | User-invoked only (`disable-model-invocation: true`) |

`dsh-auth-gate-config` is deliberately user-invoked. It is a low-frequency
lookup that ships inside the npm package, and letting the model discover it
would put a large reference in the skill catalogue of every session. The other
three are agent workflows and are model-invoked.

## Authoring standard

A skill written in this repository follows these five rules. The failure mode of
a skill is silent: it gets loaded, believed, and applied without judgement.

1. **Trigger-first description.** Start with "Use when ...", name the phrases a
   user would actually say, and say when NOT to use this skill and which sibling
   owns that case instead.
2. **Guidance, not a checklist.** Say so in the first lines, and mean it: a skill
   that reads as a tick-list gets applied without judgement.
3. **Link the authority, never restate it.** A `## Sources of truth` section
   pointing at `docs/conventions.md`, `docs/architecture.md`, `docs/security.md`,
   `AGENTS.md`, the notes rules, and sibling skills. One owner per fact applies
   to skills too.
4. **State the boundary and the limits.** Name the sibling skills' division of
   labour and add an explicit "what this skill is not" section.
5. **Keep it executable.** Every command, flag, and path must exist in this
   repository. A skill that names a script that does not exist is worse than no
   skill at all. Frontmatter is YAML: quote a value that contains a colon or a
   space-hash, or use a folded `>` block. A colon makes a consumer refuse the
   file; a space-hash starts a comment and silently truncates the value, which is
   worse because nothing fails.

`npm run skills:frontmatter` enforces the mechanical half: the block is YAML for
the shapes skills use, `name` and `description` are present, `name` is
lower-kebab-case and matches the skill's directory, the body after the front
matter is not empty, every key is one the repository knows, and the provenance
fields travel as a set (`source` with `sourceCommit`; a non-`local` `origin` with
both). The accepted shape is a closed subset, so an accepted file is one the gate
has fully interpreted. `skills:check` mirrors bytes and is not a substitute: it
would copy an unloadable block faithfully into every mirror.

## Provenance

A skill this repository authors itself carries `origin: local` and neither
`source` nor `sourceCommit`; the two come as a pair, so `origin: local` with a
`source` contradicts itself and the gate refuses it. A skill adapted from an
upstream source carries `origin`, `source`, `sourceCommit` and a
`localModification` line stating what changed, so a later upstream change is a
diff rather than a re-discovery.

All four skills here are `origin: local`. There is no upstream to track, so
there is no `skills:updates` network check.

## Guidelines

1. **No modifications without record** - an adapted skill carries the four
   provenance fields; a locally authored one carries `origin: local`.
2. **Review diff before update** - always read the diff before updating.
3. **Commit updates separately** - make each skill update its own commit, so it
   can be rolled back.
