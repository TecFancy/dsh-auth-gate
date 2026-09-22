# D14. Identity-block host comes from the `publicHost` option (empty falls back to the request Host header)

## Decision

Add the `publicHost: string` option (default `""`) and a shared resolver
`resolvePublicHost(publicHost, requestHost)` in `src/shared/host.ts`: a non-empty
configured value wins, otherwise the request `Host` header is used. All three login page
variants (token / password / TOTP) render their identity block through that resolver.
`AuthConfig` stays the single configuration entry point, and each mode's endpoint deps
gains an optional `publicHost?: string` field (absent means fall back, so existing call
sites keep working). Operators who paste `https://host/path` get it normalised to
`host[:port]`. The value decides **display text only** and never participates in an auth
decision; escaping and the 253-character cap stay in the rendering layer
(`login-page.ts`).

## Context

The login page's anti-phishing identity block shows which instance you are signing in to,
and users are expected to recognise a phishing page by comparing it with the address bar.
Its value came from `req.headers.host`, which is correct for direct access or transparent
passthrough, but production runs a **half-shell reverse proxy**:

```
dsh.example.com { reverse_proxy 127.0.0.1:3080 { header_up Host 127.0.0.1:3080 } }
```

Caddy rewrites `Host` to a loopback address (historically, so that dsh's privileged-API
fence sees a loopback request), so a remote user opening `https://dsh.example.com` saw
`127.0.0.1:3080` on the card - the opposite of the anti-phishing intent. Reproduced on an
isolated instance (`web-test` profile: request to 127.0.0.1:3081, card showed
127.0.0.1:3081).

## Alternatives Considered

- **Read `X-Forwarded-Host` / `X-Forwarded-Proto`** - forgeable by the client and at odds
  with the existing P10 discipline of never reading XFF; an identity block is a security
  display and cannot rest on attacker-controlled input.
- **Change the proxy to pass the original Host through (drop `header_up Host`)** - cleaner
  in principle, but it touches the loopback fence, `--trusted-host` and the launch-token
  bridge behaviour; that is a production-topology decision, not a side effect of a UI
  change.
- **Keep reading `Host` and document the limitation** - the card would keep showing a
  loopback address, defeating the anti-phishing feature that is literally the first thing
  the user sees.
- **Render dsh's `--trusted-host` value** - the host does not expose it to plugins, and
  reaching into host internals is not worth it.

## Why

An operator-set value is the only source that is neither forgeable by a request nor a
change to the production topology, and "empty falls back to the request Host header" keeps
every existing deployment byte-identical - the change is purely additive. Normalisation is
a thin convenience (strip scheme and path); no host validation is added, because the
rendering layer already escapes and truncates and the operator is responsible for writing
a sane domain.

Open item: `publicHost` affects display only. If redirects, cookie domains or the
launch-token bridge should ever follow the public domain too, that needs its own decision

- those are behavioural changes, not presentation.
