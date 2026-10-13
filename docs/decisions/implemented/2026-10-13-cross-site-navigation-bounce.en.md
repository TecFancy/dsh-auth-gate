# Cross-site top-level navigations get a same-origin bounce page

## Decision

When the gate has already allowed a request and that request is a cross-site
top-level document navigation (`GET` with `Sec-Fetch-Site: cross-site` and
`Sec-Fetch-Dest: document`), `guardHttp` does not call the original handler. It
answers `200` with a tiny static HTML page whose only script is
`location.replace(location.href)`, under a strict CSP pinned to that script's
sha256, plus `cache-control: no-store`, `referrer-policy: no-referrer` and
`x-content-type-options: nosniff`. The second request is issued by a
same-origin document, so it carries `Sec-Fetch-Site: same-origin`, reaches dsh
with its `SameSite=Strict` cookie, and does not match the predicate again.
Deny paths and the upgrade (WS) path are unchanged. A `<noscript>` link with an
empty `href` covers browsers without JavaScript.

## Context

The outer session cookie `dsh_auth` is `SameSite=Lax`; dsh web's own inner
cookie `dsh-auth-<hash>` is `SameSite=Strict`. A cross-site top-level
navigation (a link on another site, or `127.0.0.1` to `localhost`) sends the
Lax cookie only, so the gate allows the request and dsh then answers
`401 dsh web authentication required`. Chrome keeps the original cross-site
context across a reload, so F5 never recovers; only a fresh typed navigation
does. A cross-site `/?token=...` fails the same way: dsh mints the Strict
cookie and redirects to `./`, but the whole redirect chain is still cross-site
and the new cookie is not sent.

## Alternatives Considered

- **Make the outer cookie `SameSite=Strict` too** - the gate would then deny the
  same navigation and send the user to the login page, trading a 401 for a
  login prompt on every cross-site entry.
- **Rewrite the inner cookie from the plugin** - the inner cookie belongs to
  dsh; touching it couples this plugin to a host internal.
- **Redirect (`302`/`303`) back to the same URL** - a redirect keeps the
  cross-site initiator, so the Strict cookie is still withheld.
- **Interpolate the request URL into the page** - needless reflection surface
  (the URL may carry dsh's launch token); `location.href` already gives the
  script the URL.

## Why

Only a navigation initiated by a document of the same site is same-site, so a
page served from our origin is the smallest thing that changes the request
context. Gating the bounce on `Sec-Fetch-Site: cross-site` makes it loop-free by
construction (the retry is `same-origin`), and missing headers keep today's
behavior. The page is a constant with no request data and a CSP hash computed
from the script text at module load, so the two cannot drift.

## Consequences and trade-offs

- For top-level `GET` document navigations the bounce effectively lowers dsh's
  inner `SameSite=Strict` cookie to `SameSite=Lax` strength: a cross-site link
  now reaches dsh with both cookies after one extra same-origin hop. This is
  deliberate. The outer gate cookie already accepts exactly these requests, and
  dsh's state-changing surface is not reachable through a top-level `GET`
  (the `/api` RPC endpoint accepts only `POST`, the host's `GET` routes are
  read-only, and `/?token=` still needs the unguessable launch token). Non-`GET` methods, iframes and subresource
  requests keep the full Strict behavior.
- The bounce runs whenever the gate allows, including unauthenticated public
  paths such as `/auth/login`; the page is a constant, so this costs one extra
  round trip and leaks nothing.
