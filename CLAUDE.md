# CLAUDE.md

This file is a compatibility pointer for tools that look for a `CLAUDE.md`
entry point, Claude Code included. It holds no conventions, so it cannot drift.

**Read [AGENTS.md](AGENTS.md)**: it is the single orientation for every agent
(where each kind of fact lives, the rules that hold every session, and the
files to read first).

**Full standing conventions live in [docs/conventions.md](docs/conventions.md)**
(commands, hooks, gates, code style, commit messages, CI, releases).

Skills are authored under `.agents/skills/`. Claude Code reads them from
`.claude/skills/`, a generated and gitignored mirror: run `npm run skills:sync`
(also run by `npm install`) after a fresh clone or a skill edit.

Do not add conventions here; they belong in `docs/conventions.md` (or an Agent
Note in `.agents/notes/` for decisions). See `docs/architecture.md` for the
architecture reference and `.agents/notes/README.md` for the decision system.
