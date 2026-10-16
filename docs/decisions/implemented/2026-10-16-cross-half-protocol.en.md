# The `/auth/*` paths and payload shapes live in one cross-half contract, `src/protocol/`

## Decision

The plugin's route paths (`/auth`, `/auth/login`, `/auth/logout`, `/auth/status`,
`/auth/password`, `/auth/users`, `/auth/users/password`), the login page notice key
`password-changed`, the URLs built from them (`loginPath()`, the post-change redirect, the logout
form target) and the prefix test `isAuthPath()` are defined once, in `src/protocol/index.ts`. That
file holds only pure constants and pure functions and imports nothing.

Each half enters through one bridge: the host through `src/host/shared/protocol/index.ts`, the
client through `src/client/shared/api/protocol.ts`. Every other file takes its paths from its own
half's bridge, never imports `src/protocol/` directly, and never writes a path literal.
`slice:check` enforces three things: `src/protocol/` imports nothing outside itself, only the two
bridges may import it, and they must land on `src/protocol/index.ts`.

`src/protocol/index.test.ts` pins every value. Changing a path changes a public contract, so the
expected value there changes first.

The same contract holds the payload shapes of the endpoints, as pure types in
`src/protocol/payloads.ts` re-exported by `index.ts`: the `/auth/status` response, the `/auth/users`
row and list response, the request, success and JSON error bodies of `/auth/password` and
`/auth/users/password`, and the value sets they share (`UserRole`, `SessionKind`, `PasswordRule`).
Neither half redeclares them. The host types every JSON writer of those endpoints with them and reads
form fields through `formField<Request>(params, name)`, so a wrong key or error code does not
compile; its user and session entities take `UserRole`, `SessionKind` and `PasswordRule` from the
contract. The client annotates its request objects with the request types before `encodeForm`
encodes them, reads response bodies through `Unchecked<T>` (the contract's keys, every value
`unknown`), and compares error codes through a helper typed with the body's `error` union. Runtime
validation stays in the client; the types only fix which keys and codes exist. Responses still
evolve only by addition, because deployed clients know only the old shape.

## Context

Before this change the same paths were written more than twenty times. On the host side,
`guard.ts` and `password-change.ssr.ts` each defined their own `LOGIN_PATH`, the two endpoints
files each wrote their registration paths, and `auth-common.ts` and both gates each wrote their
own `/auth` prefix test. On the client side, five files each wrote their own request target.

Under D30 the client and host halves never import each other, so cross-half consistency rested on
`integration.p11-pins.test.ts` comparing source text, and it covered only the post-change
redirect. A change to any other path on one side would surface only at runtime.

The payloads had the same problem. `src/client/entities/account/model/admin-types.ts` was a
hand-written mirror of the host's `AdminUserView` and of the `/auth/status` response, the client
request bodies and error-body readers were typed separately from what the host parsed and wrote,
and only jsdom tests and manual end-to-end checks caught drift.

## Alternatives Considered

- **Put it in `src/host/shared/protocol.ts`**: `host/shared` is a layer of the host half, and its
  segment barrels carry Node code. The client would need an exception to deep-import a single file,
  and one accidental barrel import would pull Node code into the browser bundle.
- **Keep source-text pins**: extend the p11 approach to every path. A pin only detects a mismatch;
  it does not remove the duplication, and every new path needs another pin.
- **Import `src/protocol/index.ts` directly from both halves, without bridges**: Steiger would see
  many deep relative imports leaving the analysed tree, and client files would need paths like
  `../../../../protocol/index.ts`. With a bridge, FSD sees an ordinary `shared` segment.
- **Keep the payload mirror and let tests catch drift**: the jsdom and integration tests exercise
  the shapes they happen to cover, but a renamed field or error code on one side still compiles.
- **Put runtime schemas (zod) in the contract**: one schema could both type and validate, but the
  contract must import nothing, and zod would land in the browser bundle. The client's hand-written
  validators already degrade field by field the way the additive contract needs.
- **Also put a route table (kind + path) in the contract**: in password mode, which routes are
  registered depends on which wiring is present, so a static table would either repeat those
  conditions or disagree with the real registrations. Checking the registered set is left to
  `host:check`, which reads it from the source.

## Why

Defining each path once removes the source of drift instead of detecting it afterwards. The
contract file imports nothing, so both builds (the Node host and the browser client) can include
it safely, and the client bundle gains only a few strings. Funnelling it through two bridges
leaves the D30 layering checks untouched, and the new rule costs a few lines in `slice:check`.
Payload types are erased at build time, so sharing them costs the bundle nothing, and because
`shared` is the lowest layer of each half, every layer reaches them without an `@x` import.
