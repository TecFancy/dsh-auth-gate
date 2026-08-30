# TOTP two-stage login via a stateless challenge cookie

## Decision

M4 stacks a TOTP second stage onto `mode: "password"`: after the password stage passes, a user
with TOTP enabled receives a **stateless challenge cookie**
(`dsh_auth_challenge = <username>.<expiresEpochMs>`, TTL 300 s, HttpOnly/Secure/SameSite=Lax);
GET then renders the code page, and only a correct code POST issues the real session and clears
the challenge cookie in the same response. No pending-session state, no storageDomain involvement.

## Context

M3 already parses `totpSecret` as an optional user-record field (P4); two-stage login is the body
of M4. The hard part is expressing the intermediate state "password passed, code not yet
verified": it needs a short lifetime, replay resistance, and a thin implementation that does not
add a new state domain to the single-gate model.

## Alternatives Considered

- **In-memory pending session** — a Map entry after the password stage, deleted on code success.
  Rejected: a new state domain with expiry cleanup, lost on restart, inconsistent with the
  storageDomain persistence philosophy.
- **Single-page resubmission (password + code together)** — the challenge form re-POSTs
  username/password/code. Rejected: the password crosses the network a second time, widening the
  plaintext-credential exposure surface.
- **Signed challenge token** — MAC the challenge cookie value against tampering. Rejected: the
  challenge cookie only proves "password stage passed recently"; the real gate is the TOTP code.
  Forging a username only changes whose secret is verified, and the attacker has no code.

## Why

The stateless challenge cookie reduces the intermediate state to a short-TTL browser state: zero
server storage, restart-invisible, fully reusing the existing cookie helpers
(`parseCookieHeader`/`buildSetCookie`), with a server-side `expiresEpochMs` re-check so manually
replayed stale cookies die after 300 seconds. The security boundary still rests on the TOTP code
itself; leaking the challenge cookie alone cannot complete a login.
