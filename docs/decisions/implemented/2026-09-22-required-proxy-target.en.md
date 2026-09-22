# D17. `--target` is required for dsh-auth-proxy (there is no default upstream)

## Decision

`dsh-auth-proxy` now requires `--target`: when it is missing, `parseProxyArgs` throws
`--target is required`, the CLI prints the usage and exits 1 without connecting anywhere.
The flag carries no brackets in the usage text, and the Default column of the documented
option tables reads "required". The `https://dsh.example.com` default left over from D16
is removed with it.

## Context

The proxy points a loopback port at an upstream origin, and only the caller knows that
origin: it may be `https://<public-host>` (production shape, headers rewritten by Caddy)
or `http://127.0.0.1:3080` (local verification with `--unsafe-plain-target`). The default
has changed twice: it was the real deployment domain, which D16 removed, and then the
reserved `dsh.example.com`. The reserved host resolves to no real service, but running
with default arguments still connects somewhere, so the failure moves from "connected to
the wrong place" to "TLS handshake landed on example.com" - a message far away from the
actual cause, which is that no upstream was given.

## Alternatives Considered

- **Keep the `https://dsh.example.com` default** - the flag stays optional, but the
  default has no useful meaning: any call that forgets `--target` fails with a TLS error
  unrelated to its cause.
- **Document "always pass it" without changing the code** - the contract would rest on
  readers being careful while the code path still guesses an upstream.
- **Fall back to an environment variable (e.g. `DSH_PROXY_TARGET`)** - one more implicit
  source to inspect during triage alongside argv and the config; a local proxy of this
  kind is better served by one source, written on the command line.
- **Infer the upstream from the `publicHost` option** - that value only affects what the
  login page displays (D14), and promoting it to a behavioural source would break the
  boundary D14 drew.

## Why

The upstream is a fact only the caller holds, so there is nothing to infer a default from.
Requiring it turns the argument into an explicit input: a forgotten flag now yields
"`--target` is missing", which is directly actionable, instead of a remote TLS error. That
matches the fail-closed discipline already used in this repository (when in doubt, refuse
rather than guess). The cost is that an upgrade must add `--target` - the systemd sample
and every documented command already passed it explicitly.
