# D23. Password policy (14+ characters, four classes) and the users.yaml change surface (dedicated lock + CAS)

## Decision

**1) The password policy becomes its own shared leaf module, `src/shared/password-policy.ts`:**

- `PASSWORD_MIN_LENGTH = 14`, `PASSWORD_MAX_LENGTH = 256` (the ceiling keeps an oversized input from
  stalling scrypt; the request-level 16 KiB 413 is a backstop, not the policy); four character
  classes = `[A-Z]` / `[a-z]` / `[0-9]` / non-alphanumeric (special); `sameAsOld` rejects a new
  password equal to the old one.
- The rule enum is `PasswordRule = "minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" |
"special" | "sameAsOld"` and the result is `{ ok, rules }` where `rules` holds the failed entries
  in enum order (the endpoint returns it directly as the `rules` array of its 400 `policy`).
- **Check order: length → character classes → old hash** (the most expensive check last); when the
  length fails, the old-hash comparison does **not** run.
- `sameAsOld` uses an **injected comparator**: `checkPasswordPolicy(newPassword, opts?: {
oldPasswordHash?, verifyOld? })` returns `Promise<PasswordPolicyResult>`. That keeps the shared
  layer from importing an upper feature (a hard layering rule) while still reusing the production
  `verifyPassword`.
- **No trim, no truncation, no NFKC normalization:** the password is taken byte for byte, neither
  the client nor the CLI does an opportunistic cleanup, and NFKC would invalidate existing hashes,
  so it is explicitly out of scope this phase.

**2) Every `users.yaml` change converges on one in-lock read-modify-write:**

- **The lock is a separate `users.yaml.lock` file, never `users.yaml` itself:** the existing write is
  tmp → rename, and rename swaps the inode, so a lock held on the old inode protects nothing. The
  lock uses `fs.open(lock, "wx", 0o600)` and stores `{pid, host, token, startedAt}` (where `token` is
  a random value); zero new dependencies.
- **Releasing the lock must verify ownership (compare-and-unlink):** `finally` reads the lock file
  back and only unlinks it when the `token` matches. Otherwise, after this process's lock is judged
  stale and taken over, the original holder's release would delete the new holder's lock and let two
  writers into the critical section at once (a double write). **A zero-byte or corrupt lock file
  counts as stale**, so a failed `JSON.parse` must not wedge acquisition all the way to the timeout.
  A test covers "after a takeover, the original holder's release does not delete the new lock".
- When acquiring fails (EEXIST), the lock file's mtime and pid are inspected (`process.kill(pid, 0)`
  tells whether the process lives; ESRCH means dead): past `staleMs` (10 s by default) or with a dead
  pid the lock is removed and acquisition retried, otherwise it backs off until `timeoutMs` (5 s by
  default) and then throws `UsersFileError("users file is locked by another process")`. **No failure
  path may leave the lock behind** (a lock left by a killed process is covered by `staleMs`).
- **Known residual: taking over a stale lock is not atomic.** The takeover path is two steps, remove
  the old lock then create a new one, and creating it also has a microsecond window where the file
  exists before its payload lands, so two processes can in theory both believe they hold the lock
  (the pre-write CAS and compare-and-unlink are a second line of defence, but they cannot close that
  window). Fix direction (P2 candidate): create the lock with `tmp + link()`, and claim a stale lock
  atomically with rename. Recorded plainly, not glossed over.
- Inside the lock: read the current file (absent means an empty snapshot) → record
  `before = {mtimeMs, size}` → run `mutator` → **pre-write CAS**: stat once more, and if it differs
  from `before`, **re-read and re-run the `mutator`** (≤ `attempts`, 3 by default, which is safe
  because the password-change mutator re-verifies the old hash against the fresh snapshot); once the
  retry limit is exceeded, throw `UsersFileError` (a 503 at the endpoint), never an overwrite.
- **The measured cost of the in-lock critical section:** the lock body includes one scrypt
  verification (measured at roughly 100 to 200 ms), and the worst case (a CAS conflict re-running up
  to 3 times) is about 600 ms. Against `timeoutMs` (5 s) and `staleMs` (10 s) that still leaves an
  order of magnitude of headroom, so "scrypt inside the lock" is an acceptable trade; what it buys
  is never overwriting a concurrent writer. No further slow operation may be added to the mutator.
- Before writing, keep `.bak` (0600, one rolling copy; a failed `.bak` write does not block the main
  write) → atomic write (tmp + rename, 0600) → release the lock in `finally`. All new errors are
  `UsersFileError` with operator-facing messages.
- Single public surface: `mutateUsersFile(filePath, mutator, options?)` is the **only change entry
  point** for the CLI and the endpoint; the previous `writeUsersFile` keeps its semantics for tests
  and low-level use.
- **last-admin invariant:** checked before writing. If the number of users with
  `role === "admin" && !disabled` would go from more than zero to zero, throw
  `UsersFileError("cannot remove the last admin")`. `user disable` and `user role ... user` are
  therefore protected automatically.

**3) Role model and phase boundary:**

- The `.strict()` schema gains two keys: `role` (`"user" | "admin"`, default `"user"`) and
  `must_change_password` (boolean, default `false`); **defaults are never persisted** (`user` /
  `false` write no field), so existing fixtures keep byte-identical YAML; `version: 1` is unchanged.
- **Privilege escalation goes through the CLI only:** `dsh-auth user role <name> <admin|user>` is the
  sole role channel, and `dsh-auth user add --admin` can create an administrator directly. **This
  phase opens no HTTP escalation surface.**
- **`must_change_password` is only a reserved field this phase:** the login path does not read it and
  no forced-change routing exists (see the alternatives in D22). Reserving it guarantees P2's admin
  surface only adds, never reworks.
- CLI change surface: `dsh-auth user passwd <name> [--password-stdin] [--file <path>]` (**a
  `--password` plaintext argument is strictly forbidden**; order = user exists → policy (with
  `sameAsOld` given the current hash) → `hashPassword` → `mutateUsersFile` write inside the lock →
  print `user <name> password changed`; a TOTP user gets the warning that changing the password does
  not affect their codes but does require signing in again). When reading the password, a pipe or
  `--password-stdin` must read both lines, the new password and the confirmation, **inside one
  `readline` session**: the old `readLine` created a new interface per call, so with
  `printf 'pw1\npw2\n' | node` the second line was always an empty string and the primary usage
  failed deterministically; a TTY uses hidden prompts twice, with the logic extracted into an
  injectable function to keep it thin; and a real subprocess integration test driven by `printf`
  covers the piped path. `user list` appends ` (admin)` to administrator rows; **the existing
  `user add` and `user disable` commands must go through `mutateUsersFile`** too, inheriting the
  lock, the CAS and the last-admin protection.
- **`dsh-auth user totp <enable|disable>` (`src/features/totp/cli.ts`) goes through `mutateUsersFile`
  as well**: the mutator **spreads the existing record** and changes only `totpSecret`. It used to
  call the lock-free `writeUsersFile` directly and rebuild the whole record by hand, so once the new
  schema landed a single `totp disable` would **silently wipe fields such as `role` and
  `must_change_password`** and disable the last-admin invariant with them.
- **CLI and panel password changes differ on purpose:** `dsh-auth user passwd <name>` is an offline
  operator channel that only rewrites the hash and **does not revoke that user's issued sessions**: a
  running server validates the new password on the next sign-in, while an old cookie stays valid
  until the session TTL expires (when an immediate sign-out everywhere is needed, use the
  self-service panel change, or the periodic revoke that `user disable` triggers). By contrast, a
  successful panel change revokes every session of that subject, including the current one. In
  addition, a successful panel change **clears** the `must_change_password` flag while the CLI
  `user passwd` **does not** (that semantics is reserved for P2's administrator reset flow).

## Context

Since M3, users.yaml has been the single user store for password mode (scrypt hash + TOTP secret +
disabled flag, strict schema, evolving under `version: 1`). Back then the only writer was the CLI:
one process, one command at a time. P1 adds a **write path inside a long-running server process**
(the self-service endpoint, see D22), so the same file now has two kinds of writers, requests inside
the plugin process and a CLI in an operator's shell, and the previously valid "single writer, no
concurrency" assumption no longer holds. A lock-free read-modify-write loses updates: a TOTP secret
a CLI just added can be overwritten by a concurrent endpoint write, and vice versa.

The password policy reached the same point. Self-service hands the choice of password back to the
user; if the server kept only M3's minimal length check, "changing a password" would easily become
"downgrading a strong password to `123456`". The policy therefore has to be one shared, testable,
machine-readable set of rules (both the endpoint's 400 `policy` `rules` array and the CLI error come
from the same implementation).

The feasibility evaluation (workspace file
`notes/tech/dsh-auth-gate/password-change-feasibility-2026-09-23.md`, key points 5 to 11 of §3)
verified two things: the tmp → rename write swaps the inode, so the lock must be a separate file;
and "the most expensive check last" plus "no trim / no NFKC" are hard constraints for compatibility
with existing hashes. The owner settled the role model, the lock approach and the phasing on
2026-09-23 16:49 (§6, items 1, 2, 4 and 5).

## Alternatives Considered

- **Replace scrypt with bcrypt / argon2** - rejected: `node:crypto` scrypt already meets the need at
  zero dependency cost, and storing parameters with the hash (D3) turns hardening into a rolling
  change (new hashes use new parameters, old hashes re-derive from the stored ones). Swapping the KDF
  would invalidate every existing hash for no proportionate gain.
- **Password history (refuse reuse of the last N passwords)** - rejected: it requires keeping a
  history list of hashes per user and touches the schema, the on-disk shape and migration. This phase
  keeps only the zero-cost `sameAsOld` rule; history waits for a real requirement.
- **A boolean `admin: true` instead of the `role` enum** - rejected: a boolean cannot express a third
  role (a read-only operator, say) and pushes semantics into field presence (`admin: false` is
  indistinguishable from absent). An enum is extensible and validatable, and leaving `role: "user"`
  unpersisted keeps existing files byte-identical.
- **Take the lock on `users.yaml` itself (flock on the same fd or path)** - rejected: the write is
  tmp → rename, so after a rename the path no longer points at the inode the lock covers; two writers
  would lock different inodes and write concurrently. The lock must be a separate `users.yaml.lock`.
- **Write without a lock (keep the status quo, trusting "few writers")** - rejected: a lost update is
  silent data corruption (a user demoted for no reason, a TOTP secret gone), and once the endpoint
  ships the race window goes from "almost never" to "whenever an operator runs the CLI". One `wx`
  open plus an mtime/size CAS is very cheap.
- **Add the lock but skip the pre-write CAS** - rejected: the lock only stops well-behaved writers
  (this plugin and the CLI). Hand-editing the YAML, an editor saving it, or restoring a backup all
  bypass the lock; comparing mtime/size before the write is what notices "someone changed it outside
  the lock", re-reads and re-runs, and errors out instead of overwriting once retries run out.
- **Introduce SQLite / a JSON store next to users.yaml** - rejected: new dependencies and migration
  cost for a user store that holds single digits to a few dozen accounts; atomic write + lock + backup
  already cover the consistency this needs.
- **Put forced-change routing (`must_change_password`) in effect now** - rejected: it would change the
  login success path and add a mandatory change-password page. This phase only reserves the field;
  administrator-initiated resets are "reset + revoke every session of the target + audit" (P2).
- **Expose role granting over HTTP (`POST /auth/users/role`)** - rejected: that adds a privilege
  escalation channel inside the authentication plugin, forcing the attack surface and audit
  requirements to be recomputed. The CLI is an offline channel where the operator's identity is
  already established by logging into the server; it is sufficient and smaller.

## Why

Both decisions share one criterion: **make "things that must not happen silently" explicit, testable
and machine-readable failures.**

The policy layer collapses the owner-visible failures into one enum (`rules`); the endpoint and the
CLI reuse the same implementation, so changing the password rules later happens in one place with its
tests. `sameAsOld` stays in the shared leaf layer through an injected comparator, satisfying both the
layering rule and the reuse of the production verification function. The lock layer turns concurrent
writes from "probably fine" into "either the lock is held and the CAS succeeds, or an operator-facing
`UsersFileError` is thrown". `.bak` plus the atomic write make any bad write recoverable, and the
last-admin invariant blocks the most expensive human accident, locking yourself out, before anything
reaches disk. Roles are an enum granted only through the CLI so that P2's admin surface
(`GET /auth/users`, `POST /auth/users/password`) can **add endpoints without touching the schema**;
the reserved `must_change_password` field serves the same purpose.

Scope discipline: P1 delivers only the policy, the lock, the CLI and the public surface the
self-service endpoint needs. No password history, no forced change, no database, no HTTP escalation
surface. Each of those is recorded above as "why not now" rather than left blank.
