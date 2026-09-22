# D16. Every example uses example.com (the real deployment domain is not shipped)

## Decision

The real deployment domain is replaced by the documentation-reserved `dsh.example.com`
(isolated instances use `dsh-test.example.com`) throughout docs, deploy samples, tests and
code defaults; the `dsh-auth-proxy` `--target` default becomes `https://dsh.example.com`
accordingly. The rule lands in `docs/specs/development.md` under Conventions: the real
deployment domain does not enter the repository, and it never appears in the published
npm artifacts (`lib/`, `docs/demo/`, `.agents/skills/`).

## Context

This plugin grew out of a self-hosted deployment: `docs/deployed/*` documents the live
Caddy + systemd topology, and early docs, deploy samples and the proxy CLI's default
`--target` wrote the real public domain verbatim. That domain is a publicly resolvable
entry point, so carrying it in a public repository publishes both the existence of the
instance and its deployment shape; the shipped `lib/proxy-cli.js` default additionally
sends anyone running `dsh-auth-proxy` with default arguments to the author's server.
The `docs/demo/*.png` screenshots leaked the same domain and were re-recorded with the
example host as part of D15.

## Alternatives Considered

- **Fix the docs only and keep the CLI default** - the real domain still ships to npm in
  `lib/proxy-cli.js`, the leak is unchanged, and a default should not point at someone
  else's production deployment in the first place.
- **Make `--target` required (drop the default)** - the more thorough fail-closed reading,
  but it is a CLI behaviour change that would break existing callers on upgrade; left for
  its own decision, so this change only replaces the default's value.
- **Add a gate script that scans for the real domain** - the script would have to contain
  the forbidden string, which is the thing being kept out of the repository; a positive
  allowlist (example.com, loopback, a few known sites) is too brittle. The rule lives in
  the conventions doc and is enforced by review instead.
- **Rewrite git history to erase the old domain** - history is already public, rewriting
  forks every clone, and the only gain is psychological.

## Why

`example.com` is reserved by RFC 2606 for documentation and never resolves to a real
service, which turns "no real domain in the repository" into a rule anyone can verify at a
glance. It also fixes a genuine defect: a public package should not point its default
traffic at the author's production deployment. The cost is that `dsh-auth-proxy` with
default arguments now necessarily fails to connect, which is far safer than silently
proxying to somebody else's server.
