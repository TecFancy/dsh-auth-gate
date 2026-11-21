# Agent Note: A credential change revokes sessions, including the CLI path

Status: implemented
Legacy ID: D40

English | [中文](2026-11-22-credential-change-session-revocation.zh.md)

## Problem

`docs/security.md` §6 promises that a credential change revokes every session for that user, and
the web paths keep that promise: the Settings self-service change and an administrator's reset
revoke immediately. The CLI path did not. `dsh-auth user passwd` rewrites the stored hash in a
separate process with no handle on the running plugin's session store, so stolen cookies and
Bearer tokens stayed valid until their TTL - the operator-run reset that follows a suspected
compromise was the one path that left the attacker's sessions alive. Two smaller gaps sat next to
it: a user deleted from `users.yaml` kept their sessions, and `dsh-auth user add` skipped the
password policy the web write paths enforce.

## Decision

`users.yaml` gains an optional per-user `password_changed_at` (ISO-8601). The three password-write
paths stamp it through one helper, `applyPasswordChange` in
`src/host/entities/user/model/password-change-mark.ts`: CLI `user passwd`, the self-service change,
and an admin reset. The plugin's `DisabledSessionSweeper` handles three cases on every password-mode
pass, comparing absolute credential versions so a change made while the plugin was down is still caught on the
next start:

- a disabled user loses every session;
- a user with `password_changed_at` loses every session whose recorded credential version is
  older; sessions store the stamp observed at sign-in, so a verification that straddled the change
  cannot mint a survivor, while sessions issued after the change survive, which keeps the sweep
  idempotent;
- a subject no longer present in `users.yaml` loses every session. Bootstrap sessions are not
  enumerated by the store, and the internal `token` subject is exempt by name.

The web paths still revoke immediately; the sweep is the backstop for the CLI path and after a
restart. The interval stays `revokeSweepMs` (default 5 s), and `0` keeps the pre-existing opt-out:
no timer, so the CLI path then falls back to expiry. The CLI prints the delay after a successful
`user passwd`. `dsh-auth user add` now runs `checkPasswordPolicy` like the web writes, so the CLI
cannot create a weak initial password.

## Alternatives considered

- **Give the CLI the session domain.** Rejected: the CLI is a separate process and the session
  store belongs to the running plugin (in-process, persisted per instance); letting a second
  process write it means a second writer and a lock protocol for a file one component owns.
- **Re-check the password-change timestamp in the gate on every request.** Rejected: the gate is
  frozen as a synchronous, zero-file-IO decision; reading `users.yaml` there puts disk I/O on the
  admission path of every request.
- **Narrow `docs/security.md` §6 to the web paths and warn loudly in the CLI.** Rejected: the
  operator-run reset after a compromise is precisely the path that must not leave sessions alive,
  so documenting the gap was worse than closing it.
- **Store a per-session revocation marker instead of comparing timestamps.** Rejected: sessions
  created after the change are the whole predicate, and rewriting session rows on every password
  change is more moving parts for the same guarantee.

## Consequences

The CLI reset now evicts sessions, but not synchronously: the window is one sweep interval
(`revokeSweepMs`, default 5 s), larger if the plugin is stopped until the next start, and absent
when the operator configured `0` (the CLI cannot read that configuration, so its note states the
delay unconditionally). The timestamp is a `users.yaml` schema addition: older files load
unchanged because the field is optional, while a file written by this release carries a key older
releases' strict schema rejects, so do not downgrade the plugin after the first password change.
Removed users are swept through the same orphan pass, which also means renaming a user in
`users.yaml` signs the old subject out. The bootstrap kind and the `token` subject stay outside
the sweep because neither is a `users.yaml` user. The client-facing behaviour on the web paths is
unchanged; [the self-service change note](../feature/2026-09-23-self-service-password-change.md)
still owns that flow.
