# Agent Note: Ask the host once after admitting, and re-mint its browser cookie when it refuses

Status: implemented
Legacy ID: D37

English | [中文](2026-11-16-host-cookie-rebridge.zh.md)

## Problem

dsh has two cookie layers. The outer one is this plugin's `dsh_auth` (`SameSite=Lax`,
7 days by default) and the gate only checks that. The inner one belongs to
`client-connection`: `dsh-auth-<sha256(authority)>` (`SameSite=Strict`, 30 days by
default), minted by `GET /?token=<launchToken>`, with both its name and its signature
bound to the request Host. The gate never inspects the inner layer, so a valid session can
still meet the host's `dsh web authentication required` 401 instead of the login page, and
a refresh does not help: the gate keeps admitting, so the browser never reaches the login
page.

That is exactly what broke production on 2026-11-16. On 11-15, to let LiveShare's Origin
through, Caddy dropped `header_up Host 127.0.0.1:3080`; the host cookie name moved from
`dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw` to
`dsh-auth-4C5y9yeEZVr1ky05miKn8P90w2IagA3Qrb7raNo49G0`, browsers that signed in before the
change held only the old name, and 93 such sessions were still valid at the time. The same
class of failure comes from a domain or port change, an expired host cookie, or cleared
site data.

## Decision

After the gate answers `allow`, and before the guard calls the original entry, ask the host
one more question for **top-level document navigations to `/`**: call
`connection.requestRejection(request)`. When it answers `401` (not authenticated), reply
`302` to the relative `/?token=<launchToken>` and set a one-shot marker cookie
(`dsh_auth_rebridge`, 60 seconds) on that redirect. While the marker is present, do not rebridge: hand the
request to the original entry and let the host answer with its own 401.

The hook is installed on the HTTP entries only (handler and resource forms, existing and
late-registered routes, the fallback seat). WebSocket upgrades are excluded: a handshake
cannot be repaired with a redirect. In the admit path the **cross-site bounce runs before
the rebridge**: the two fix different failures. The bounce fixes "the Strict cookie exists
but a cross-site navigation does not send it"; the rebridge fixes "the cookie name does not
match, or the cookie expired". A cross-site navigation always meets a host 401, and a
freshly minted Strict cookie is not sent along the rest of that cross-site redirect chain
either, so rebridging first would turn a case the bounce can repair into a 401.

## Alternatives considered

- **Mint `dsh-auth-*` inside the guard.** That copies the host's cookie-name algorithm,
  HMAC and maxAge. It is an unfrozen internal format that fails silently when dsh changes
  it, and the maintainer decision on issue #69 already rejected it ("no in-tree mint of
  dsh-auth-*").
- **Turn the host's 401 into a login redirect.** It has to recognise the host's response by
  status and body text, which couples its wording; and the outer session is still valid, so
  the user would sign in again only for the bridge to re-mint, while a broken bridge turns
  into repeated sign-ins.
- **Rely on the cross-site bounce page alone** (decision 2026-10-13). The bounce fixes a
  Strict cookie not being sent on a cross-site navigation; it cannot fix a cookie whose
  name does not match, because a same-origin retry still answers 401.
- **Redirect to `/?token=` on every navigation.** That costs a round trip every time, puts
  the token in access logs, and without a marker becomes a redirect loop whenever the host
  keeps refusing.

## Why

`requestRejection` is the host's documented seam, described as "apply Connection's
Host/Origin checks and browser authentication to another Web route". It reads request
headers and writes no response, which is exactly what a post-admit question needs. Using it
means copying no host internals: when dsh changes its cookie scheme the hook follows the
host's own verdict, and the worst case is that the hook goes inactive and behavior returns
to what it was.

A request whose URL already carries a `token` query is not rebridged: that hop is exactly
where the host mints its cookie (the post-login bridge goes through it on every sign-in),
`dsh_auth` is already valid while the host cookie is not yet issued, so
`requestRejection` must answer 401. Rebridging there would 302 to the same address, which
buys nothing beyond one more `Location` header carrying the token and one extra hop on
every sign-in.

The one-shot marker pins the cost of a failed rebridge to a single extra hop: the second
request arrives with the marker, the hook declines, and the host's 401 reaches the user
unchanged. The marker shares the `buildCookie` attribute template in `shared/http` with the
session cookie and is `SameSite=Lax` like the outer session, so it survives the same
navigations and widens no authorization surface (it takes part in no decision; it only says
"a rebridge just happened").

Restricting the hook to top-level `GET` navigations to `/` follows from what a redirect can
do: an `/api` fetch, a static asset and a WebSocket upgrade gain nothing from a 302, so
rebridging them would only turn one 401 into one useless round trip. A `403` is not
rebridged either: it is the host's Host/Origin fence (`trustedHosts` does not name this
authority), and `/?token=` meets the same fence, so rebridging would only turn a clear 403
into one wasted 302.

## Consequences

- When the host refuses, the user sees one extra 302 round trip (`/` → `/?token=` → the
  host's 303 → `/`) and then the app. When the host accepts, the cost is one synchronous
  header check: no disk read, no network call.
- The hook depends on `connection.requestRejection`. On a dsh build without it the hook
  stays inactive and logs one warning; behavior is identical to 0.20.0.
- The rebridge 302 puts the launch token in `Location`, the same existing constraint as the
  post-login bridge (the token already reaches access logs; redact `token=` at the proxy).
- The marker is `HttpOnly` and takes part in no decision, so it cannot forge state; it does
  make "a rebridge just happened" visible to that browser for 60 seconds, which is the
  necessary cost of loop protection.
- Behind several replicas without sticky routing, `/?token=` can land on a process that does
  not know that token, the rebridge fails, and the user sees the host's 401. That is the
  same existing constraint as the post-login bridge, not a new limitation.
