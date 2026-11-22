# docs - Documentation map

English | [中文](README_zh.md)

This repository's documentation is organised by **kind of fact**, not by time.
Each kind has exactly one home; the rules are in
[`AGENTS.md`](../AGENTS.md) "Where each kind of fact lives".

## Current documentation

| Path | Contents | When to read |
| --- | --- | --- |
| [`architecture.md`](architecture.md) | The shape of the source tree and its layering rules: the host and client halves, the FSD layers, the `src/protocol/` cross-half contract, the two layering gates | Before adding a slice, moving a file between layers, or writing a route literal |
| [`security.md`](security.md) | The negative guarantees the plugin must never break: fail closed, wrap not fork, every entry guarded, the cross-site bounce, trusted proxy, session revocation, passkey sign-in and passkey-only, the launch-token bootstrap window, the post-admit rebridge, the signed challenge cookie, scrypt, the example domain, build parity - and what is deliberately not defended | Before touching the guard, the gate, session handling, or the login page |
| [`conventions.md`](conventions.md) | Standing conventions: commands, hooks, gates, code style, commit messages, CI, releases, branch hygiene, dependency policy | Every session |
| [`deployed/`](deployed/) | Deployment and operations: [deployment](deployed/deployment.md) (acceptance checklist A-J, backups, upgrades), [reverse-proxy](deployed/reverse-proxy.md), [local-proxy](deployed/local-proxy.md), [known-limitations](deployed/known-limitations.md) (the full version of the README's short list) | Deploying, troubleshooting, upgrading |
| [`decisions.md`](decisions.md) | A **compatibility table** for D1-D40, not a live index. The decisions themselves live in [`.agents/notes/`](../.agents/notes/) | When a code comment cites `D<n>` |
| [`demo/`](demo/) | README screenshots (login page, TOTP challenge, account security, passkey block; English UI, light theme) | Referenced by the README |
| [`design/`](design/) | Design exports (HTML plus the uploaded images) | Comparing against the visual baseline |
| [`i18n/`](i18n/) | The [terminology table](i18n/terminology.md) and the [Chinese prose rules](i18n/prose-rules.md) | Writing or editing Chinese documentation |

## Historical documentation

[`history/`](history/) is a **frozen historical area**, not current authority.
It holds the M1-M4 executable specs, the per-milestone handoff documents, old
plans that shipped or lost their force, external review transcripts, and the
versioned entry-coverage evidence.

The historical area may be cited as evidence, but `AGENTS.md` and the skills
must not make it required reading for every task. Current behaviour is defined
by the code, the tests, `architecture.md`, `security.md` and `deployed/`.

## Reading paths

- **A new session picking up a task**: `AGENTS.md` -> `docs/architecture.md`
  (structure) -> `docs/security.md` (what must not break) ->
  `docs/conventions.md` (commands and gates) -> the relevant Agent Note (why)
- **Deploying or operating**: `deployed/deployment.md` (first deployment runs
  the section 0-4 acceptance; upgrades run section 5 and 5.1) ->
  `deployed/reverse-proxy.md` -> `deployed/local-proxy.md`
- **Understanding why a decision was made**: look the number up in
  `docs/decisions.md`, then open the Agent Note it points at
- **Changing code**: `docs/conventions.md` "Commands" (the `verify` and
  `gates` rows), then the tests for the slice you are touching

## Documentation rules

Enforced by `npm run docs:check`:

1. **Reachability**: every current document must be reachable from `AGENTS.md`
   or this page by following relative links. An orphan document fails.
2. **Resolvable links**: relative links and `#fragment` targets must name an
   existing file and heading.
3. **Bilingual pairs**: unless exempt, `<name>.md` (English) pairs with
   `<name>_zh.md` (Chinese). Exempt: this page, `decisions.md`, `demo/`,
   `design/`, `history/`, `.agents/skills/`, `AGENTS.md`, `CLAUDE.md`.
4. **Size red line**: a single file stays at or under 50 KiB; over the line it
   must be sliced into a skeleton plus `references/`.
5. **No duplicate headings**: the same H2/H3/H4 heading may not appear twice in
   one file.
6. **Word budgets**: `AGENTS.md` and `conventions.md` are bounded by
   `scripts/doc-budgets.json`, so a standing document cannot only grow.

When a new document cannot satisfy 1-6, change the rules here first rather than
letting `docs:check` go quietly red.
