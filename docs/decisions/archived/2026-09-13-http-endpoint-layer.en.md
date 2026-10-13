# D11. Auth HTTP endpoint pieces get their own `http` layer

## Decision

The endpoint pieces duplicated by the token and password feature slices
(`authCatchAll`, `logout`, `status`, `queryOf`, `methodNotAllowed`) move into a
new core mechanism layer `src/http/` (peer of `gate/` and `session/`), consumed
by both feature slices through the `http/index.ts` barrel. `src/shared/` stays a
leaf layer with its constraint unchanged.

## Context

The 2026-08-30 layered refactor (D5) established `gate`/`session` as core
mechanism layers, but each authentication surface kept its own copy of the
logout / status / catch-all / method-guard logic, with `logout` identical
byte for byte. Deduplication had exactly three possible homes: `shared`,
`session`, or a new layer.

## Alternatives Considered

- **`src/shared/http-auth.ts`** - D5 and `verify-slice-boundaries.mjs` define
  `shared` as a leaf that does not depend upward, while logout/status need
  `buildSetCookie` and `SessionStore` from `session`; that either breaks the
  leaf constraint or forces the cookie builder to be injected as a parameter -
  both are more indirection than a new layer.
- **Inside `src/session/`** - `methodNotAllowed`, `authCatchAll` and `queryOf`
  have nothing to do with sessions; the session layer would turn into a junk
  drawer.
- **Keep the duplication** - the two copies are already identical byte for byte,
  so every behaviour change (the M22 logout semantics are one example) has to be
  remembered twice.

## Why

`http/` plays the same role as `gate` and `session`: cross-mode core mechanism.
The dependency direction `http -> session/shared` is single and clear,
`features/* -> http` still enters only through the barrel, and the leaf
constraint on `shared` is untouched; `slice:check` only needed the new layer
added to its allowlist to guard it.
