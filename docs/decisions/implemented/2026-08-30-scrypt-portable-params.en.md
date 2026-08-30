# Portable scrypt parameters, verify against stored values (2026-08-30 backfill from M3)

## Decision

Password hashes use Node's built-in scrypt with stored parameters
(N=65536, r=8, p=1, keylen=32, maxmem 128 MB as the module constants) written
next to each hash. Verification re-derives from the stored parameters instead
of the module constants, so hashes created under older parameters keep
verifying after an upgrade. `dsh-auth user hash` exists for offline hashing.

## Context

M3 (password mode) needed a password hashing scheme that is dependency-free,
tunable, and does not invalidate every stored hash on parameter upgrades.
Node's `node:crypto` ships scrypt natively.

## Alternatives Considered

- **bcrypt / argon2** — rejected: brings a dependency (argon2 needs native
  bindings); scrypt in `node:crypto` is zero-dependency.
- **Verify against current module constants only** — rejected: a parameter
  bump would silently invalidate all existing users.
- **Single fixed parameter set, users migrate by re-login** — rejected: a
  public door cannot afford "everyone locked out" on a hardening patch.

## Why

Portable parameters make hardening a rolling change instead of a day-zero
event; the stored-parameter verification path is what the login-rate tests
exercise ("old-parameter hashes still verify under new constants"). Basic
timing-safety (constant-time compare) is applied on the verification side.

Backfill note: registered as part of the decision-record process landing
(2026-08-30); the original frozen decision lives in docs/impl-m3.md.
