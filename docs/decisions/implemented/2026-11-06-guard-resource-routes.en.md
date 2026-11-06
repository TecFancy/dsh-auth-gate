# Guard both handler routes and the DSH 0.2.2 resource routes

## Decision

`wrapServer` now guards two kinds of HTTP routes: the existing `{ handler }` shape and the
`{ resource }` shape added in DSH 0.2.2 (a Fetch `Request` in, a `Response` out). The fallback
seat accepts both as well: a function, or a `{ resource }` object. The three registration
methods, existing and late registrations, double wrapping, per-entry rollback, and the startup
self-check all key off the same guarded function identity; the D27 rollback semantics are
unchanged.

The route type becomes a union: `WrappableRoute = WrappableHttpRoute | WrappableResourceRoute`,
and `WrappableFallback = HttpHandler | { resource: ResourceHandler }`. Runtime detection uses
`typeof route.resource === "function"`; older hosts never have that field and always take the
handler branch.

`Gate.decide()` narrows its input from `IncomingMessage` to `GuardRequest`, which carries only
`url`, `method`, and `headers`. A node:http handler entry point satisfies it directly; the
resource entry point copies those three items via `toGuardRequest()`. The gate therefore neither
needs nor is allowed to depend on Node-only fields such as `socket`.

Denial rendering becomes the transport-neutral `GuardReply` (status, headers, body):
`denyReply()` computes it once, the handler side writes it with `writeGuardReply()`, and the
resource side converts it with `guardReplyToResponse()`. Location sanitization, 401/403 bodies,
`no-store`, and `referrer-policy` live in exactly one place. The allow path never touches that
model: the original `Request`, `peer`, and `Response` pass through untouched, without reading,
cloning, or decompressing the body.

`assertGuarded()` inspects the guard marker on either `handler` or `resource`, and the fallback
on the function or its `.resource`.

## Context

DSH 0.2.2-rc.1 added `WebResourceRoute`: a route may carry a `resource` that maps a Fetch
`Request` to a `Response`. Two official entry points switched immediately:
`@deepseek-ai/dsh-client-modules` registers `/plugins` as a resource prefix, and
`@deepseek-ai/dsh-host-frontend-static` uses `{ resource }` for its SPA fallback.

This plugin's `wrapServer` assumed every route carried a `handler`. It received `undefined`,
read the guard symbol from it, and threw a `TypeError`; the entry never activated. Since the
post-0.1.6 startup audit treats only seven required ids as fatal, the process kept serving with
no login gate at all. That is a fail-open failure: everything looks normal while authentication
is gone. Routes wrapped before the crash also left a half-guarded table behind, so some API
surfaces returned 401.

## Alternatives Considered

- **Raise the peer floor to `>=0.2.2` and support only the new host.** This abandons every 0.2.0
  and 0.2.1 user, while a single runtime probe serves all three generations.
- **Convert the Fetch `Response` into a fake `ServerResponse`, or pretend a resource is a node
  handler.** This loses Request/Response semantics, tends to break streaming bodies, gzip, and
  Range, and drags a fake `IncomingMessage` along.
- **Buffer the response body on allow and re-wrap it.** This breaks streaming and compression
  and adds memory and latency for no benefit; returning the original `Response` is the safe
  option.
- **Patch only the compiled `lib/` output.** It rescues one running instance but cannot be
  published or tested, and the next build loses it.
- **Check `route.handler !== undefined` and skip the rest.** Skipping means no guard, so
  `/plugins` and the entire SPA fallback would be exposed; that is exactly the defect being
  fixed.

## Why

Denial semantics stay in one place and are shared by both transports, so behavior cannot drift;
the allow path is zero-copy, preserving both performance and semantics. Runtime detection lets a
single package serve old and new hosts, keeping `peerDependencies` and `engines.dsh` unchanged
so consumers need no migration. Neither the structural mirror nor `GuardRequest` imports a
0.2.2-only type, so older hosts never fail to load the build. The startup self-check remains
fail-loud: if any entry lacks the guard marker, `apply` throws instead of half-mounting.
