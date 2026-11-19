# Agent Note: An in-process read carrying a Peer is admitted by its caller

Status: implemented

English | [中文](2026-11-19-peer-reads-admitted-by-caller.zh.md)

## Problem

dsh 0.2.2's `webServer.readResource(request, peer)` answers an in-process caller
with what an HTTP request for the same URL would receive, without an HTTP
exchange. Its documented contract is that the caller has already admitted the
reader: the method checks no cookie, Host or Origin, and the `peer` it receives
*is* that admission. `dsh-experimental-liveshare` serves the owner's viewer page
exactly this way: the share host reads the index and every shell asset with the
reader's `Peer` and ships the bytes to the relay.

The guard wrapped that resource like any HTTP entry and asked the gate first. A
gate decision needs a credential, and an in-process request carries none: no
`dsh_auth` cookie, no `Authorization`, no `Sec-Fetch-*`. The password gate
classified it as an anonymous non-navigation request and answered `401
unauthorized`; the owner's asset answer became `401 {"error":"asset-not-found"}`,
and the relay folded that into its own `503 the host is offline or the page could
not be loaded`.

That is what broke LiveShare on 2026-11-19. The viewer logged in at the relay,
the owner was online, and the page still failed, because the refusal happened in
the owner's own process: the gate stopped the owner from reading the page it was
about to serve. The host already keeps the two cases apart - `dsh-host-frontend-static`
authorizes the index only when `peer === undefined` and renders it with
`peer ?? browserPeer` - but the guard, wrapping the same fallback, took the
`Request` and ignored `peer`.

## Decision

`guardResource` treats the presence of a `peer` as proof that the caller admitted
the reader:

- A read whose `peer !== undefined` goes to the original resource unchanged,
  before the gate is consulted, carrying the original `Request` and `Response`.
- The HTTP-only acts after an allow are skipped with it: the proxy-marker fence,
  the cross-site bounce, the rebridge hook, and the `onAdmit` telemetry hook.
  None of them has a browser to act on, and counting an in-process read as an
  admitted browser request would inflate the usage ping.
- The malformed-URL answer stays in front of the bypass: a URL that cannot be
  parsed is still `400`, because the host's own read rejects it as well.

The bypass grants no new authority. `readResource` is callable only from inside
the host process; a caller there could read the dist files from disk and call the
resource directly. The trust boundary this plugin defends is the browser, not
other plugins.

## Alternatives considered

- **Forward the owner's cookie with the read.** The relay never has an owner
  cookie - the owner talks to it over its own WebSocket tunnel - and inventing
  one would give the relay owner-level authority the protocol never granted it.
- **Exempt only the index (`/`).** The shell assets (`assets/...`) are read
  through the same `readResource`, so the page would still fail on its first
  script; the reader's authority is the `peer`, not the path.
- **Have dsh mark the read with a header the gate accepts.** That is a host
  change, shipable only on the host's release train, and it invents a second
  admission mechanism beside the `peer` the host already provides.
- **Turn the gate off for shares, or stop using it.** That removes browser
  authentication from the whole instance to fix one entry kind.
- **Make the owner serve its page bytes without `readResource`.** The owner would
  re-implement index rendering and asset serving, which is the drift the host's
  read seam exists to prevent.

## Consequences

- LiveShare viewer pages work behind the gate: the index and shell assets read as
  the admitted reader. Covered by an integration test on the real
  `@deepseek-ai/dsh-host-webserver` stack (a peer-carrying read serves the
  fallback, the same URL over HTTP is still `401`, and a peerless in-process read
  is still denied).
- The browser path is unchanged: with no `peer`, the guard runs exactly as before
  (deny, redirect, cross-site bounce, rebridge, admit hook).
- One coupling to watch: if a future dsh passes a `Peer` for a request that
  originated over HTTP, that request would skip the gate. `serveResource` (the
  HTTP path) passes none today; if that changes, the guard needs a new
  discriminator rather than this presence test.
- In-process reads no longer appear in the anonymous usage ping. The count is a
  browser-request count by definition, and counting an owner's internal page read
  as usage would be wrong.
