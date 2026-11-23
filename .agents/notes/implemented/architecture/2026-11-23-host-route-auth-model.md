# Agent Note: Host route authentication is bridged, not re-implemented

Status: implemented

English | [中文](2026-11-23-host-route-auth-model.zh.md)

## Problem

dsh `0.2.3-alpha.2` moved request authentication out of the connection layer and
into the route table. `WebRoute`, `WebResourceRoute`, `WebUpgradeRoute` and
`WebFallback` gained `auth?: 'anonymous' | 'required' | 'deny' | (request =>
policy)`, a route that omits it is `required`, and the web server resolves the
policy with `webserver/authorize` **before** it dispatches. The old host had no
such concept: it checked its own cookie at the edge, and this plugin's guard -
wrapping the four entry kinds - was the only thing that decided who got in.

Three things broke at once on that line:

- Every route the plugin registers for itself (`/auth/login`, the first-run
  wizard, the password pages) became `required`, so a visitor without a host
  session could not reach the login page that was supposed to give them one.
- The host's own `required` routes (`/`, `/index.html`, `/api/*`) are denied
  before the wrapped handler runs, so the guard's `302` to the login page never
  happened; the visitor got the host's bare `401`.
- A signed-in visitor had a valid `dsh_auth` session but no host credential, so
  even the routes the gate allowed were refused by the host.

The launch-token bridge and the post-admit host-cookie rebridge were built on
`connection.authenticatedUrl` and `connection.requestRejection`; that line
removed both, so their repairs were unavailable exactly when the model changed.

## Decision

The plugin bridges the two models rather than duplicating either one, in three
places with one owner each.

**Its own routes declare `anonymous`.** `mountRoutes` stamps
`auth: 'anonymous'` on every `/auth/*` registration, because those pages are how
a caller authenticates in the first place. The gate still decides all of them -
the declaration only stops the host from pre-empting the gate. Older hosts ignore
the field.

**A complete session becomes one owner `Peer`.** `src/host-auth-wiring.ts`
registers a `connection.authentication` provider through
`ctx.inject(['connection', 'connection.authentication'])`, answering with an owner
`Peer` only for a session of kind `full` that is unrevoked and unexpired.
Bootstrap and restricted sessions answer `undefined`, so the host keeps its
`401`; the plugin's own admin surface still distinguishes roles. The bridge
declares both services because Cordis 4.2 refuses to read
`connection.authentication` from a context that injected only `connection` - the
failure is a thrown service-access error, not `undefined`.

**The SPA fallback is downgraded, never widened.** `src/host/shared/guard/host-auth.ts`
composes a rule over the host's own fallback `auth`: when the host asks for
`required`, the adapter keeps `required` if the request carries a complete
session (the index render needs a `Peer`) or any `Authorization` header (an API
credential must not be treated as an anonymous navigation), and answers
`anonymous` otherwise so the wrapped gate can answer with its usual `302`. A host
rule that throws is treated as `required`. The adapter is attached to the
registered object, so it rolls back with the guard.

The launch-token bridge and the rebridge become silent no-ops when the route-auth
model is present instead of warning about a missing seam: the host cookie is no
longer required to reach the app, so the seam being gone is not a degradation.

## Alternatives considered

**Reject the host's `401` with a `webserver/request` waterfall listener that
redirects unauthenticated document navigations to the login page.** It works,
but it would duplicate the gate's policy in a second place - the listener would
have to know the navigation rules, the restricted and bootstrap kinds, the
`next` encoding and the cross-site bounce - and the guard would no longer be the
single owner of "who is admitted". The fallback adapter keeps that ownership: it
only decides whether the host or the gate gets to answer, never who is allowed.

**Leave the SPA fallback at `required` and let the host's `401` page serve as the
"please sign in" screen.** Simplest possible diff, but it contradicts the
product: the host's page offers token login and device pairing, not this
plugin's password/TOTP/passkey door, and a user with a valid `dsh_auth` cookie
would still be stuck. It also loses the `next` round-trip.

**Mirror the host's token provider by reading its cookie format.** The format is
unfrozen internal state (`dsh-auth-<sha256(authority)>` signed with a private
secret); reimplementing it would break silently on any host change, which is the
same reasoning that produced the launch-token bridge's "drop host and scheme"
rule in the first place.

**Also admit a raw shared-token `Authorization: Bearer <token>` in the provider.**
The provider is synchronous and the token lives behind an asynchronous
credentials read, so admitting it would mean caching a credential in front of the
gate. Refused: scripts sign in once and reuse the session cookie, and a request
carrying `Authorization` is never downgraded to anonymous, so the failure stays
closed. Recorded as a limitation.

## Consequences

- The gate remains the only place that decides admission for the plugin's own
  surface. The host's `required` routes now admit any complete session - the same
  set the gate admits - with the one documented narrowing below (a raw
  shared-token `Authorization` header, which the synchronous provider cannot
  resolve).
- First-run on this host line loses the launch-token proof: the token is not
  readable through a public seam, so `/auth/bootstrap?token=…` refuses and the
  first credential has to come from the CLI (`dsh-auth user add`) or
  `DSH_AUTH_TOKEN`. The wizard still exists for hosts that expose the seam.
- One behaviour narrows on this line: a raw shared-token Bearer call to a host
  route that the gate would have allowed now receives the host's `401`. It is a
  documented limitation, not an accident.
- `guardResource` no longer treats "the peer argument exists" as "this is an
  in-process read"; it requires a header-less request. A `required` resource
  route also carries a `Peer` on the network path from this line on, and a
  network request always has at least `Host`, so the two cases stay apart without
  guessing.
- The dev/test host cohort moves to `0.2.3-alpha.2` with Cordis `4.2.0-alpha.1`,
  and the integration suite gains a real-stack case that mounts the alpha.2
  contract (`webserver/authorize` bail plus a provider registry) to prove the
  login redirect, the signed-in index render with a `Peer`, and the anonymous
  `401` on `/api`.

## Deferred

Four known follow-ups, recorded so a later change does not re-derive them:

- **An explicit mark for in-process reads.** `guardResource` currently infers
  "the caller admitted this reader" from a `Peer` plus a header-less request;
  wrapping `webServer.readResource` and marking the `Request` objects it is
  given would be a stronger signal. The inference is sound for the two real
  callers (LiveShare builds a bare `Request`; the network path always carries
  `Host`), and the mark would replace wrapping discipline on a method the guard
  does not own today.
- **A CI leg on the previous host line.** The suite now runs on
  `0.2.3-alpha.2` with Cordis 4.2 only; the `^4.0.1` cordis peer and the
  `0.2.2`/`0.1.x` fallback shapes are covered by unit tests and by the shape
  rules, not by a real host boot.
- **Per-session peers.** One shared owner `Peer` mirrors today's semantics (the
  old guard admitted every complete session to the host surface). If the plugin
  ever gains per-user permissions, the provider must map session -> peer and
  dispose that peer on revoke; today a revoked session stops reaching the host
  at the next authorize call, but an already-admitted WebSocket keeps running.
- **Reading the launch token through `webserver/entry-url`.** The host does emit
  its authenticated entry URL (with the token) to listeners, so the first-run
  wizard could verify it by capturing that row at startup. Not done here because
  listener ordering is not a documented contract.
