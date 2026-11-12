# Passkey sign-in

## Decision

Add a **second sign-in method** in `password` mode: users may enrol a passkey (WebAuthn, `attestation: "none"`,
UV required) and the login page offers "Sign in with a passkey" without a username. Enrolment requires a current
password (plus TOTP when enabled) on top of the signed-in session. Server-side verification uses **`@simplewebauthn/server`** (MIT, 21 transitive packages, ~870 KiB unpacked,
host side only), with ~60–80 lines of hand-written `get`/`create` browser glue; RP ID/origin are derived only from
the existing `publicHost`. v1 ships `passkey: "off" | "optional"` only; no passkey-only mode; conditional UI is off by default and can be
enabled by an administrator in Account security. A passkey sign-in is always a complete authentication, following
GitHub's passkey model
(passkeys satisfy both the password and 2FA requirements; `totp` constrains password sign-in only); environments
that do not accept synced passkeys set `passkey: "off"`. Plan: `docs/plans/passkey-login-plan.md`.

## Implementation status (2026-11-12)

M6 shipped in three PRs, all green through `npm run verify` (lint/FSD/coverage/build/bundle/host checks):

- **PR1** (`152e46b`): the `/auth/status.passkeyEnabled` contract, `users.yaml` `passkeyUserHandle`/`passkeys[]`
  with cross-record validation, the ceremony store + opaque cookie, `publicHost` → RP ID/origin derivation with
  a startup self-check, the `dsh-auth passkey list/rm` CLI, and the bundled config skill.
- **PR2** (`f20f2de`): `@simplewebauthn/server@14.1.0` (pinned exactly), `POST /auth/passkey/options` and
  `/auth/passkey/login` (discoverable/username-less, library verification, userHandle/BE consistency, counter
  policy, a separate rate-limit bucket, dummy equal-work), the login-page passkey button with inline JS and
  conditional UI, and a real-stack integration test with a self-built EC P-256 authenticator.
- **Review fixes** (`0a8f747`): after Kimi K3.1 Pro's review, the begin quota that never consumed anything and
  the missing `Permissions-Policy` (two majors), plus the 503 ordering, the userHandle check ordering, an unused
  dependency and a file-length overrun.
- **PR3**: registration/management/settings endpoints (enrolment and removing the last credential require
  re-authentication), the client Account-security passkey block and conditional-UI toggle, README /
  known-limitations / deployment docs, and this record moved to implemented.

## Context

The gate currently offers only a shared token or "password + optional TOTP". TOTP does not stop phishing
(real-time OTP forwarding works) and leaves password reuse, spraying and offline cracking untouched. A passkey
removes the password from the login path and binds the credential to the origin, improving security and
convenience (one touch/biometric) at once. Every prerequisite already exists: a server-rendered login page with
progressive-enhancement inline JS, the TLS-termination deployment assumption, the `publicHost` option, one
session-issuance path, rate limiting, CSRF checks and failure cards. Constraints: a small runtime-dependency budget (this plan explicitly accepts one verification library)
(only schemastery/yaml/zod), zero third-party resources on the login page, password sign-in must keep working
without JS, and the `/auth` prefix is passed through by the gate (each endpoint owns its authentication).

## Alternatives Considered

- **Keep password + TOTP only** — leaves phishing and the password surface in place; misses the "safer and more
  convenient" option entirely.
- **OAuth/OIDC with an external identity provider** — viable, but adds an external dependency and redirect
  configuration, i.e. one more service to run for self-hosters; passkeys are a browser primitive with no server
  dependency.
- **Email magic links / email OTP** — needs mail infrastructure, is weaker than origin-bound credentials, and is
  equally phishable.
- **Hardware security keys only (FIDO2, non-syncable)** — unusable for users without a key and gives up the
  convenience half of the benefit; the cloud-copy risk of synced passkeys is documented instead and covered by the
  counter policy for device-bound credentials.
- **Passkey-only (password disabled)** — lockout and recovery paths are not mature (lose every device and have no
  password = permanent lockout); deferred.
- **Hand-written verifier (`node:crypto` + minimal CBOR/COSE, zero runtime dependencies)** — the smallest
  dependency surface, but CBOR/COSE/signature boundaries are the easiest security code to get wrong (the research
  brief itself wrote the COSE `crv` label incorrectly); it needs 250–400 lines of implementation plus 300–400 lines
  of tests. After evaluation the user chose the library, moving that risk to a mature implementation.
- **Username-first vs username-less** — username-less (discoverable) saves a step and never leaks whether an
  account exists, so it wins.

## Why

A passkey is the only option that is simultaneously phishing-resistant, passwordless, browser-native and free of
external services, and the repo already carries every prerequisite, so the new surface is one verification path.
The verifier delegates to `@simplewebauthn/server`: it covers exactly the CBOR/COSE/signature/attestation
boundaries that are easiest to get wrong, while we keep the policy layer (ceremony store, credential transaction,
rate limiting, audit, UI). The dependency cost (21 transitive packages, ~870 KiB, host side only) is accepted
explicitly and the version is pinned exactly.
Registration re-authentication is a red line: adding a backdoor passkey from a hijacked session is the only new
persistence surface a passkey introduces over TOTP. v1 skips passkey-only and attestation to keep the change,
lockout risk and review cost bounded; `publicHost` as the sole RP ID anchor avoids the "never works" mismatch
under the existing half-shell proxy (which rewrites `Host` and strips `Origin`).
