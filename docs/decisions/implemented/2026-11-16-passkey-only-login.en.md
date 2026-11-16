# Passkey-only sign-in

## Decision

The `passkey` option gains a third value, `"required"`: the instance becomes passkey-only, so neither a
password nor "password + TOTP" can start a new session — only a passkey can. This is an **instance-level**
policy, not a per-account one. There is no per-user "disable password sign-in" field, no HTTP endpoint and no
Settings toggle for it; turning it on or off is a config-file edit plus a restart.

Three hard constraints come with it:

1. **A broken configuration does not restore password sign-in.** With `passkey: "required"` and an unusable
   `publicHost`, RP ID or origin, the feature degrades to unavailable but password sign-in **stays disabled**,
   and the login page renders a diagnostic card with the fixed reason. This is issue #133's fourth point, and
   the one place where this decision deliberately departs from the existing fail-closed semantics: fail-closed
   used to mean "turn the passkey feature off", and here it has to mean "close the whole sign-in entry".
2. **Removing the last credential is refused.** The HTTP endpoint answers `400` with
   `reason: "last-credential"`, and the check is re-run inside the `mutateUsersFile` lock (a pre-lock snapshot
   cannot stop two concurrent removals). The CLI cannot read the plugin configuration, so it demands
   `--force` unconditionally instead of guessing whether the instance is passkey-only.
3. **There is exactly one recovery path: set the option back to `"optional"` and restart.** No CLI recovery
   command, no web toggle.

## Context

Issue #133 asks for "after enrolling a passkey, explicitly disable password sign-in". D35 had excluded
passkey-only from v1 on the grounds that "the lockout and recovery paths are immature (lose every device and
the password is disabled = permanently locked out)". This decision re-evaluates whether that reasoning still
holds.

It does not disappear, but it can be turned into one operational step an operator understands: the policy
lives in the config file, so recovery is editing it back. The genuinely dangerous shape is a **web toggle**:
one click disables password sign-in, a hijacked session can flip it, and recovery depends on an entry point
that was just closed. Putting the switch in the config file requires server access to flip, which matches
issue #133's fifth point ("the recovery action should be performed deliberately by whoever holds server
access").

The repository's model boundary also settles the scope: `docs/specs/dsh-auth-plan.md` §0 decision 1 says "no
multi-user/session isolation — the gate protects the entire instance", and `role: "admin"` is not a permission
boundary (D36 documents this). Under that model, "disable the password for one account" is meaningless: the
other accounts still sign in with passwords to the same instance, and the inside of the gate is not isolated
anyway.

## Alternatives Considered

- **A per-account `password_login_disabled` field plus an enable endpoint and a Settings toggle** (the shape an
  external review proposed) — not chosen. It needs a `users.yaml` schema change, a new endpoint, session
  records carrying `authMethod`/`passkeyCredentialId` to prove "this key was really used recently", a one-way
  Settings toggle, and a full concurrency-test suite. What it buys — "only one of several accounts goes
  passkey-only" — does not hold in a model without user isolation: the other accounts still sign in with
  passwords to the same instance. Roughly 7–9 person-days for a switch that looks like a permission boundary
  but is not one.
- **Add `passkey: "required"` without changing the broken-configuration semantics** — not chosen. A broken
  WebAuthn configuration would silently fall back to password sign-in, which is exactly what issue #133's
  fourth point forbids, and it would make "passkey-only is on" a false promise.
- **Add a CLI recovery command, `dsh-auth user password-login enable`** — not chosen. It would need to read
  the plugin configuration to decide whether to refuse, and there is no channel between the CLI and that
  configuration; making it clear the flag unconditionally would be a local bypass of the policy, and it
  duplicates the config-edit path. Editing the config is already one step.
- **A Settings toggle to turn passkey-only off** — rejected outright. A hijacked session could restore the
  password entry with one click, which demotes the policy to a preference.
- **Require two credentials before enabling** — not chosen. Issue #133 asks for one; raising the bar
  unilaterally would make "enrol one and try it" impossible. The docs strongly recommend two; the protocol
  enforces one.

## Why

The carrier of a policy determines its security properties. In the config file, flipping it inherently
requires server access, and the recovery path is the same as the enabling path, so there is no "turned it off
and now nobody can get in" shape. In a web UI or in `users.yaml`, it would add either "a hijacked session can
change the policy" or "a bad state cannot be parsed, so even the CLI cannot fix it".

Instance-level rather than per-account, because this repository's threat model is a single gate: everyone who
gets past it shares one dsh deployment. Adding per-account sign-in policy to a model without isolation
manufactures the illusion that each account has its own security boundary — the exact kind of misleading
omission D36 argues against.

The costs are written down in `docs/deployed/known-limitations.md`: an administrator password reset does
**not** restore access under passkey-only (the reset still sets `must_change_password`, but that restricted
session can only be reached by signing in); existing sessions stay valid until they expire; the password hash
is kept and still authenticates credential changes, it just cannot create a session.
