# D18. The bundled skill stays a single SKILL.md (no references/ directory)

## Decision

`.agents/skills/dsh-auth-gate-config/` (the configuration quick reference shipped inside the
npm package) stays a single file: the whole body lives in `SKILL.md` and no `references/`
subdirectory is used. Two tests lock that into CI: the skill directory has no `references/`,
and every option in the `Config` schema appears in the skill body (so a new or renamed option
must land in the skill first). If the body ever grows into a genuine appendix, or the dsh
skill loader gains a body size cap, this decision is revisited.

## Context

On 2026-09-02 the failure table and the verification tips were split into
`references/{failures,verification}.md`, shrinking the main file from 13.9KB to 6.5KB, and the
split version was installed into the workspace and used. It never merged and was superseded by
the bilingual rewrite plus later growth. Evaluating it established the facts: the skill is
user-invocable only (`disable-model-invocation: true`), the catalog exposes just the frontmatter
summary, and the body is injected only when a human opens the skill; `dsh-skill` (0.1.5-rc.2)
imposes no body size limit; `references/` is not a loader feature, so a path in the body costs
the model another read; and `installSkill` copies the whole directory with `fs.cp recursive`,
so split files install fine - the toolchain was never the problem.

The cost showed up in practice: on 2026-09-22 the workspace copy was still the 6.5KB split
version (`publicHost` appears 0 times there, 3 times in the repository version), and the stub's
"10 rows" failure table had grown to 13 rows. Three copies - packaged, `$DSH_HOME/skills` and
the workspace `.dsh/skills` - are kept in sync by hand, and nothing in CI watches `.agents/`.
What was moved out is exactly what the skill's description promises (login trouble, rate
limiting), so splitting makes the answer cost an extra file read.

## Alternatives Considered

- **Split as originally attempted (main file + references/)** - saves roughly 2.2k tokens on
  each explicit open, at the cost of rot-prone stub counts, a second read, and a three-copy sync
  surface; the drift already materialised, and it hides the skill's main payload.
- **Split by language (a zh and an en file)** - the skill panel cannot choose a language, so the
  body must carry both; splitting per language makes every invocation read two files.
- **Keep one file but compress the body** - the parts easiest to cut are the ones people look up
  (the failure matrix); a quick reference whose contract is "open it and you have the answer"
  cannot afford that.
- **Write the rule down without any test** - the same split will be proposed again, and drift
  between the schema and the skill body stays unguarded.

## Why

The skill is a low-frequency quick reference a user opens explicitly: the catalog costs one
summary line, the body costs only that one invocation, so little is saved - and "open it and you
have the answer" is its entire value. A single file also collapses the sync surface from three
files to one, which matches the repository's "one explanation has one home" prose discipline.
The two tests lock shape and sync only, not wording, so a future change can amend this record
when a real reason appears.
