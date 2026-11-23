# Agent Note: The gate authenticates the instance, not the users behind it

Status: implemented

English | [中文](2026-11-15-no-user-isolation.zh.md)

## Problem

Creating a second account is one command (`dsh-auth user add <name>`), and both
READMEs describe per-user accounts and an `admin` role. Read together, those two
facts suggest a permission model this plugin does not have: that each user gets
their own sessions and their own workspace. The mentions that did exist were
confined to the passkey-only and login-CSRF discussions, so no operator-facing
limitation explained the general boundary. Discovering the sharing after the fact
is worse than being told about it.

The plugin was built against one adversary: the unauthenticated outsider at the
instance's single entry point. The model decisions starting with the first plan
([the frozen plan](../../../../docs/history/specs/dsh-auth-plan.md)) removed
multi-user isolation deliberately. What was missing was not the behaviour but its
disclosure.

## Decision

State the boundary where an operator reads, and record the reasoning here.

The model, precisely:

- **A valid full session receives the instance's owner principal.** On a host with
  route authentication, a request to a host `required` route that carries a valid
  full session is answered with a `{ principal: { kind: "owner" } }` peer
  ([`src/host-auth-wiring.ts`](../../../../src/host-auth-wiring.ts)). One peer serves
  every such session, and if the host aborts it the replacement is still owner.
  Bootstrap and `password-change-only` sessions get `undefined`, so the host keeps
  its `401`; the plugin's own `/auth/*` routes are `anonymous` rather than admitted
  through that peer.
- **The plugin adds no per-user layer on top.** `PasswordGate.decide()` (password
  mode) allows any session that is neither bootstrap nor restricted; it never reads
  `users.yaml` and never branches on `subject` or `role`
  ([`password-gate.ts`](../../../../src/host/features/password/model/password-gate.ts)).
  The session-kind fence exists because of what a session may do, not whose it is.
  The peer granularity is owner because the host's permission question is only
  "admitted or not", and the plugin answers it the same way for every full session.
- **`subject` is not a data-ownership key.** It names the credential that produced
  the session. It is used for audit, revocation, and to load the caller's own record; no
  admission decision gives two users different principals.
- **`role: "admin"` is not a host-data isolation boundary.** Its server-side
  authorization checks are exactly `GET /auth/users`, `POST /auth/users/password`,
  and `GET`/`POST /auth/passkey/settings`. Elsewhere the role is a label
  (`/auth/status`, the account header), a client-only render gate (the
  user-management block, and the footer's star together with token mode), a CLI
  mutation (`dsh-auth user role`), or a write invariant (the last active admin
  cannot be removed).

For an operator that means the sharing the frozen plan was written around: the plan
states that any client which passes the gate can see and open all sessions. The
plugin's half of that sentence is what it controls - one owner principal for every
complete session, and no per-user step of its own. What the host serves an owner peer
is the host's decision, not this plugin's.

Three disclosure sites carry this, each at its own level: the "what it does not do"
list in both READMEs (the operator fact),
[`known-limitations`](../../../../docs/deployed/known-limitations.md) (the mechanism),
and [section 16 of `security`](../../../../docs/security.md) (a deliberate non-goal,
next to the CSRF omission that already depended on it).

## Alternatives considered

- **Implement per-user isolation here.** Rejected: it is a different product, and
  most of it would sit outside this repository. Making users distinct on the host
  surface needs an ownership record per session, an ownership check on every request
  that carries an identifier, and the same check on the streaming surfaces where a
  partial implementation leaks silently. It would also turn a login gate into a
  multi-tenant platform.
- **Filter only the session list.** Rejected: the panel would stop showing other
  users' sessions while the other surfaces still returned them. A false sense of
  privacy is worse than a documented absence of it.
- **Say nothing.** Rejected: per-user accounts plus an `admin` role read as a
  permission model, so silence is not neutral - it misleads by omission.

## Consequences

- An operator can decide before deploying: keep the single-gate model, or add a
  plugin that implements per-user isolation.
- No endpoint, payload or config key changes, and no version floor moves. This is
  the boundary written down, not a new behaviour.
- Sign-in, password reset and revocation stay per user, and the user list stays
  admin-only. What is absent is separation of one signed-in user's data from
  another's on the host surface.
- The statement stays honest only while the admission model does. A change that
  introduces per-session principals has to update this note, both READMEs and the
  two docs pages together.
