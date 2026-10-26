# Unconfigured instances get a first-run wizard from dsh's launch token

## Decision

The plugin trusts dsh's launch token only while the instance is unconfigured. After a
fresh install and a dsh restart, the browser opens the URL the startup log printed
(`http://host:port/?token=<launchToken>`) and no longer stops at an Access token box:
it receives a bootstrap session and lands on the `/auth/setup` wizard, which either
generates and saves the shared token (token mode) or creates the first administrator
(password mode), and then lets you into dsh. As soon as the configuration exists the
window closes, in two hops: the gate bounces the request to
`/auth/bootstrap?token=...`, that endpoint finds the instance configured, and answers
`302 /auth/login?next=%2F`. Neither hop sets a cookie and nothing is admitted, so an old
launch URL cannot act as a second permanent key.

Verification lives in a new endpoint, `GET /auth/bootstrap`. The two gates (TokenGate /
PasswordGate) only add one shape test at the point where they were about to deny
anyway: `GET` plus pathname `/` plus exactly one non-empty `token` query returns
`{deny:{redirect:"/auth/bootstrap?token=..."}}`. The gates compare no token, read no
file and perform no IO. The probe, session issuance and wizard pages all live in
separate endpoints. The bootstrap session TTL is `min(sessionTtl, 3600)` seconds, it
reaches `/auth/*` only, and completing the wizard revokes every bootstrap session
before issuing a full one; `/auth/continue` then reuses the launch token bridge to
return to `/?token=`.

## Context

The shipped configuration is `mode: "token"`, resolving a shared token from
`DSH_AUTH_TOKEN`. On a fresh install that reference does not resolve, the gate
fails closed for every request, and nobody gets in, including the person who just
installed the plugin. dsh prints a URL carrying its launch token on every start, and
`authorizeIndex` accepts that URL and mints a 30 day cookie. In 0.17.4 the auth-gate
gate saw "no session, no Bearer" first and answered `302` to the login page, so the
launch token never had a chance to be used. Installing and restarting therefore still
required a shell command to create an administrator, or writing `DSH_AUTH_TOKEN` by
hand and restarting again, which is exactly the step issue #115 asks to remove.

Three constraints applied at the same time. `guard.ts`, `wrapServer` and the `Gate`
vocabulary are frozen (D2, D27) and must not change for this. The "`next` keeps the
pathname only" rule was settled in D-bridge-9. This release adds no configuration
option and no client change, and older dsh versions (no `connection.authenticatedUrl`)
must behave exactly as in 0.17.4.

## Alternatives Considered

- **Treat the launch token as a permanent second key**: `?token=` would admit forever,
  which is a long-lived key that bypasses TOTP and passwords and weakens the whole gate.
  dsh also rotates its launch token per process, so it was never meant to be held.
- **Keep the query in the guard's `next`**: suggested in issue #99 and rejected in
  D-bridge-9, because it reflects the launch token into the unauthenticated login page
  URL and its Referer.
- **Add a `tryBootstrap` hook to the guard, or a new `Gate` decision type**: both
  external designs took that route. It edits the frozen `guard.ts` and `Gate` vocabulary
  to save one endpoint.
- **Let the probe treat "cannot read the configuration" as unconfigured**: a permission
  error or a YAML parse failure would open the wizard, so one disk fault would open the
  door. That violates fail-closed.
- **Make the client panel the only entry point**: a bundle that fails to load or a page
  that will not render locks the instance again, exactly when recovery is needed.
- **Add a `bootstrap: true/false` option**: one more way to lock yourself out, and it
  turns the rollback from "revert the code" into "edit the config, then revert".

## Why

- Unconfigured is decidable: token mode checks whether the credential read succeeds and
  returns empty (a missing service or a throwing `resolve` is `unknown` and opens no
  wizard), password mode checks whether `users.yaml` is missing or has zero users. Once
  a configuration exists the predicate is false by itself, so there is no "bootstrap
  already used" state to maintain. The process also keeps a `markedConfigured` flag that
  the wizard sets after a successful write, which closes the window immediately even if
  a credentials service caches values and `resolveToken()` cannot see the new one yet.
- The gates only redirect by shape, so `guard.ts`, `wrapServer` and the `Gate` vocabulary
  stay untouched and the risk surface stays small. All IO and all decisions sit in the
  separate endpoint, which fails closed in order: missing `sessions`, a throwing probe,
  a missing `connection` or a throwing `sessions.create` all fall back to
  `302 /auth/login?next=%2F`.
- The bootstrap session has its own fence: at most one hour, `/auth/*` only, revoked the
  moment the wizard completes. It is not a channel into dsh, so "let this person in
  temporarily" cannot become "open the instance temporarily".

## Consequences and trade-offs

- The launch token appears in `Location: /auth/bootstrap?token=...`. That is the same
  exposure class as the token in the original request URL (D-bridge-5 already accepts
  that the launch token reaches access logs and browser history), and the 302 carries
  `referrer-policy: no-referrer`, so no new category of exposure is added.
- The channel assumes a single process: every process mints its own launch token, so
  behind several replicas without sticky routing `/auth/bootstrap` can be answered by a
  process that does not know the token and falls back to the login page.
- A credentials service that caches resolved values may need a dsh restart before the
  token saved by the wizard becomes the only credential; the result page says so. The
  window itself does not wait, since `markedConfigured` applies immediately.
- Older dsh versions (no `connection.authenticatedUrl`) have no wizard at all: there is
  no launch token to read, so their behavior is unchanged from 0.17.4.
