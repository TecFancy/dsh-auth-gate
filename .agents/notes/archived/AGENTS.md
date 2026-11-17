# AGENTS.md - Archived Agent Notes

Archived triplets are frozen historical snapshots, not current authority.
Never edit, reformat, translate, repair, delete, or move a sealed artifact;
use an active note or current documentation for new decisions and facts. Only
implemented notes enter here, as `{class}/yyyy-mm-dd-kebab-title.md` triplets
with an `Archived: YYYY-MM-DD` line below `Status: implemented`.

Freezing is machine-enforced. `manifest.json` in this directory records a
SHA-256 for every artifact below it, and `npm run notes:seal` (pre-commit, CI,
`verify`) fails on an edited, deleted, moved or unsealed artifact and on a
stray file or nested directory. The manifest may only grow: CI compares it with
the copy at the pull request's base, so editing a sealed file and its hash
together still fails. An empty archive has an empty manifest, so the seal
exists before the first note is archived.

To archive, move the triplet, insert the `Archived:` line, re-record the
sidecar, then append the new hashes with `npm run notes:seal -- --write`. Never
edit `manifest.json` by hand. If a sealed file must change (a leaked secret, a
link that has to go), the only route is an exact old-to-new hash pair in
`AUTHORIZED_RESEALS` in `scripts/lib/archive-seal.mjs`, added with an Agent
Note that says why; it permits that one change and no other.

What the other gates do here: `notes:check` checks shape (the `Archived:` line
sits directly below `Status:`, its date is well formed and does not precede the
note's own date, the triplet is complete, no proposal-era heading survives) and
`bilingual:check` keeps the sidecar current. `notes:links` does not read links
out of archived notes, which cannot be repaired, but still checks links into
them from active notes. `zh:prose` and Prettier skip the tree for the same
reason. The seal is what makes "never edit" something a gate says, not a habit.
