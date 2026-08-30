# dsh-auth M3 Implementation Spec (executable spec)

> Reader: the coding agent implementing this (expected deepseek v4 flash, **new session**). This document is a
> **decision-complete spec**: all decision points are already closed; the executor only translates, it does not
> design.
> Baseline: `docs/implemented/impl-m2.md` (M2 delivered: guard + TokenGate + /auth endpoints + persistent sessions — M3 stacks
> on top of it).
> Design basis: `docs/specs/dsh-auth-plan.md` §5/§6 phase 2/§8; engineering gates: `docs/specs/development.md`.
> **This file is the sole authority for M3 details**; where it conflicts with plan/M1/M2, this file wins.
>
> Environment and verification workflow: see `docs/handoff/handoff-m2.md` (mandatory reading for a new session: server
> access, sandbox network limits, M1/M2 pitfalls list — the §3/§4/§5 environment facts remain valid for M3).
> **Do not explore the harness internals yourself** — if you need a fact not present in this file, stop and report.
>
> Two directional decisions already confirmed by the user (2026-08-15): password hashing uses **`node:crypto`
> scrypt** (zero new native dependencies); in password mode **Bearer = session token** (not a shared token, not
> Basic).

---

## 1. M3 Goals

Bring phase 2's "real login" to life: `mode: "password"` moves from throwing an error to a complete, usable
password flow:

- `$DSH_HOME/auth/users.yaml` maintains administrator credentials (scrypt hashes, **plaintext passwords never
  appear in the file**);
- `POST /auth/login` accepts `username` + `password`, constant-time verification → issues a persistent session
  cookie (subject = username, for auditing); wrong password / unknown user / disabled user all uniformly return
  401 (anti-enumeration);
- login rate limiting: dual buckets counted by IP + account, exponential backoff on failure, lockout returns
  `429 + retry-after`;
- `Authorization: Bearer <session token>` passes the guard directly (session lookup validation, zero per-request
  KDF);
- accompanying CLI: `dsh-auth user add/list/disable` (generates hashes, atomically edits users.yaml);
- `mode: "token"` (M2 behavior) **stays 100% unchanged** and remains usable as the default flow.

Guard/session/self-check all reuse M1/M2, **their behavior is not changed**; this milestone only adds the password
flow + CLI.

---

## 2. Frozen decision table (M3 increments; M1's D1–D16 and M2's M1–M22 unchanged)

| #   | Decision               | Frozen value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Password hash          | `node:crypto` **scrypt** (`promisify(scrypt)`), parameters **N=65536, r=8, p=1, keylen=32**, salt = `randomBytes(16)`, **explicit `maxmem: 128 * 1024 * 1024`** (measured on this machine: N=2¹⁵ already exceeds the default 32 MiB maxmem and throws RangeError directly, so it must be passed explicitly). Stored as a single string `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`. Single derivation ~150 ms, acceptable for low-frequency login                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P2  | Verification semantics | `verifyPassword(password, stored)` parses N/r/p/salt/hash from stored, then re-derives using the **stored** parameters (current value is P1; when tuning parameters in the future, old hashes still validate); N ≤ 2¹⁷, r ≤ 32, p ≤ 4 (prevents malicious parameters in a users file from amplifying memory), salt segment decodes to 16 bytes, hash segment to 32 bytes, invalid segment count/prefix/numbers → `false` (**no throw**). Constant-time: `timingSafeEqual` (both sides always 32-byte Buffers)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3  | DUMMY_HASH             | Frozen literal: `scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k` (salt = 16 bytes of 0x7a; the password `dsh-auth-dummy-password-for-timing-uniformity` appears only in test assertions and is **not a secret**). For an unknown user login, run one real verification against this constant (timing uniformity, anti-username-enumeration)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4  | Users file format      | `$DSH_HOME/auth/users.yaml`: top level `{ version: 1, users: { <name>: { passwordHash, totpSecret?, disabled? } } }`. zod strict validation: both the top level and user entries use `.strict()` — unknown key / `version` not 1 / invalid username / missing `passwordHash` → file unusable (503). `totpSecret` (optional string) is **parsed but not used** in M3 (M4); `disabled` defaults to `false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P5  | username constraint    | `USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/` (users file validation + CLI enforcement); matching is **case-sensitive**, no normalization performed. Username is only a key and an audit subject, not an identity boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P6  | File path              | config adds `usersFile: string`, default `""`. When `""`, resolve inside apply: `process.env.DSH_HOME` exists → `path.join(env, "auth", "users.yaml")`; otherwise `path.join(os.homedir(), ".dsh", "auth", "users.yaml")` (consistent with the deploy-side `DSH_HOME=~/dsh-smoke` startup, handoff §3.2). An explicit config is used as-is. The resolution rule is this plugin's own; note it in the README                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P7  | Read semantics         | **Re-read the file on every login attempt** (per-operation, CLI changes take effect immediately, no restart needed — consistent with the M2 credentials semantics); **no caching**. YAML syntax error / schema error / overly permissive permissions → login 503 `"user store unavailable"` + `log.error` (logged on every failure — login is low-frequency, operator signal); file absent → **empty user set** + one in-process `log.warn` on first occurrence (flag prevents flooding) + login takes the 401 path                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P8  | File permissions       | Consistent with the 0600 discipline of credentials: on POSIX, at load time `(stat.mode & 0o077) !== 0` → file unusable (503); **win32 skips the check** (permissions are meaningless there; CI has windows-latest). CLI always writes 0600 (P19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P9  | Auth result            | Unknown user → verify against DUMMY_HASH then 401; wrong password → 401; `disabled: true` → **still run one real verification** (timing uniformity) then 401. All three share the response body `"invalid credentials"` + `logger.info("login rejected")` (**no username** — anti-enumeration, log discipline P23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P10 | Login rate limiting    | In-memory `LoginRateLimiter` (**reset on restart**, note in README). Constants: `maxFailures=5`, `baseDelaySeconds=30`, `maxDelaySeconds=900`, `windowSeconds=600`; the nth (n≥5) failure → lock for `min(30 * 2^(n-5), 900)` seconds. Request during the lock period → **429** + `retry-after: <seconds>` + text/plain `"too many attempts"` + `logger.info("rate limit exceeded")`, **does not increment counters, does not verify**; on lock expiry the entry is cleared and counted from zero; **failure count decays to zero if no failure occurs for 10 minutes** (sliding window, `windowSeconds`); success clears both buckets. IP is taken from `req.socket.remoteAddress ?? ""`, **XFF is not read** (forgeable); `username === ""` only counts the IP bucket; entry cap 10000, when exceeded delete the earliest inserted                                                                                                                             |
| P11 | mode semantics         | `mode: "password"` activates PasswordGate + password endpoints (**no longer throws**); `mode: "token"` is the default and behaves **byte-for-byte** the same as M2 (`token-gate.ts` zero changes, credentials wiring zero changes). The two modes are **mutually exclusive, never simultaneous**; password mode does not read the credentials service, and the `tokenRef` configuration is ignored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P12 | PasswordGate           | `decide` order: 1) whitelist `/auth`, `/auth/*` → allow; 2) cookie: `parseCookieHeader` non-empty and `sessions()?.getByToken(...)` hits → allow; 3) **Bearer = session token**: `Authorization` matches `/^Bearer\s+(.+)$/i` then `sessions()?.getByToken(value)` hits → allow (**no comparison against the shared token, no hash derivation**); 4) deny. Synchronous return (no await). HTTP and upgrade share the same `decide` (guard side unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P13 | Login page             | `login-page.ts` adds `passwordLoginPageHtml(next, error?)`: username (`<input type="text" name="username" autocomplete="username" required>`) + password (`<input type="password" name="password" autocomplete="current-password" required autofocus>`) + hidden next (escaped) + the same inline styles. `loginPageHtml` (token version) is preserved as-is. `GET /auth/login` always renders (no session check, no redirect, consistent with M20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P14 | Login endpoint         | `POST /auth/login` (password mode) accepts fields `username`/`password`/`next`, reuses `parseFormBody` (415/413 semantics exactly like M2). Success → `store.create(username, ttl*1000)` + `buildSetCookie` 4 args + 302 next + `info("session issued")`. Failure → 401 `"invalid credentials"`; `loadUsers` failure → 503 `"user store unavailable"` + `error`; `sessions()` undefined → 503 `"session store unavailable"` + `error` (M2 wording). 429 see P10. no-store throughout                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P15 | Session semantics      | subject = **username** (auditing: logs know which credential produced the session; not an isolation boundary). **Disabled users only block new logins**: already-issued sessions remain valid within their TTL (note the limitation in README; `revokeBySubject` is left for M4 evaluation, written as `TODO(auth-m4):`). Every login is a new session (anti-fixation, M6 semantics continue)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P16 | Route model            | password mode registers **the same 4** (prefix `/auth` 404 fallback + 3 exact), assembled by `index.ts` as a choice of one based on mode (never register two identical paths — webserver would throw on duplicates). logout/status behavior is **exactly identical** to M2: logout is POST-only, next is query-only, invokable without body idempotently, `Max-Age=0`; status is GET-only, **only recognizes the cookie** (Bearer session token does not participate — a stateless channel does not create sessions)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P17 | validateNext           | Extracted to a new file `src/auth-common.ts` and exported; `auth-endpoints.ts` removes the private implementation and changes to import (**behavior unchanged**, guarded by M2 tests); `password-endpoints.ts` imports it as well. M8/M20 validation rules preserved verbatim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P18 | CLI                    | `package.json` adds `"bin": { "dsh-auth": "lib/cli.js" }`; `src/cli.ts` has a shebang first line (tsc preserves it as-is). Command surface: `user add <name> [--password-stdin] [--disabled]` / `user list` / `user disable <name>`; global `--file <path>` (default `defaultUsersFilePath()`). `add` **requires `--password-stdin`** (reads one line from stdin, strips trailing `\r\n`; missing flag → usage + exit 1); name not matching USERNAME_RE / already exists → stderr error + exit 1; success `out("user <name> added")`. `list` outputs `<name>` / `<name> (disabled)` sorted by username (**never outputs hashes**). `disable` is idempotent (succeeds even if already disabled). Unknown command/argument → usage to stderr + exit 1. Success exit 0. `main(argv, io): Promise<number>` with injectable io (`out`/`err`/`readLine`) — **`console.*` forbidden**, default io uses `process.stdout/stderr.write` + `node:readline` to read one line |
| P19 | CLI file writing       | Via `writeUsersFile`: `yaml.stringify` rewrites the **whole file** (comments are not preserved — note in README that the file is managed by the CLI, don't hand-write comments) + write to `<path>.tmp` in the same directory + `fs.rename` atomic replace + mode `0o600`; `mkdir -p` if the directory does not exist. On serialization, users are ordered lexicographically by username (**explicit comparator** — eslint rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P20 | Dependency changes     | runtime adds **`yaml@^2.9.0`** (this machine's lockfile already has 2.9.0 as a transitive dependency, public npm source, `lock:check` passes); **no other dependency changes** (devDependencies untouched; scrypt is built-in). Install must use `npm install --registry=https://registry.npmjs.org/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P21 | CSRF evaluation        | **M3 still does not add a login CSRF token.** Evaluation conclusion: the single-gate model has no inter-user isolation — the only impact of login CSRF is that the session subject audit value is polluted (victim uses the same shared instance as the attacker), no permission boundary is lost; `SameSite=Lax` plus modern-browser third-party Set-Cookie restrictions narrow it further; note the residual risk in the README, re-evaluate in M4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P22 | Config surface         | The only new M3 config = `usersFile` (P6). Rate-limit constants are **not configurable** (`rate-limit.ts` module constants); scrypt parameters are not configurable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P23 | Log discipline         | Continuation of M21: **never log** passwords/usernames (login-related logs)/hashes/session tokens. Password-mode log events: `login rejected`, `rate limit exceeded`, `session issued`, `logout` (info); `user store unavailable: <error.message>`, `session store unavailable` (error); `users file not found: <path>` (warn, once per process). DUMMY_HASH and the DUMMY password are public constants, not restricted; CLI output (list, add confirmation) is not logging                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P24 | Line budget            | `password-login.ts` (login handler logic, ≤250) and `password-endpoints.ts` (route skeleton + logout/status + 405, ≤250) split into two files. Tests split into three files following the M2 lesson (matrix §5). `cli.ts` is a single file ≤250 (usage text as an in-file constant)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P25 | Test parameters        | Unit/integration tests all use **real scrypt parameters** (no weakening, no fake injected parameters); the password-class suites budget ≤10 derivations (each ~150 ms). 429 lockout (from 30s) pollutes subsequent logins on the same instance — **429 scenarios use a standalone ctx/port instance** (integration tests start a new stack in a separate describe), unit tests use an injected clock `now`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P26 | Assembly order         | Inside `apply`: log → mode branch (token: `makeTokenResolver` + TokenGate; password: PasswordGate + `usersPath` resolution + `new LoginRateLimiter()` + `loadUsers`/`verify` closures) → auth object formed in one step (`sessions: () => auth.sessions` closure self-reference) + `provide` → storage soft-wiring (M1 logic unchanged) → `wrapServer` → endpoint registration (choose one of two by mode, using the wrapped `server.register`) → self-check (last). No await inside apply; password mode **does not access the credentials service**                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 3. Authoritative contracts (new M3 facts; the rest see impl-m1.md §2 / impl-m2.md §3)

### 3.1 `node:crypto` scrypt (measured on this machine with Node 24.13.1)

- `scrypt(password, salt, keylen, options)` is callback-based; use `promisify(scrypt)`.
- **maxmem measured**: default maxmem = 32 MiB; N=32768/r=8 already throws
  `RangeError: Invalid scrypt params ... memory limit exceeded` — **must pass explicit `maxmem`** (P1 freezes
  128 MiB; N=65536/r=8 needs 64 MiB working memory, leaving headroom).
- N=65536/r=8/p=1/keylen=32 measured ~150 ms/op.
- `timingSafeEqual` only accepts Buffer/TypedArray (already frozen in M2; scrypt output is a Buffer, both sides
  always 32 bytes).
- base64url lengths: 16-byte salt → 22 characters; 32-byte hash → 43 characters. The stored string's total length
  is fixed; shape regex `/^scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/` (for asserting the shape
  under current parameters).

### 3.2 `yaml` package (v2.9.0, public npm, already a transitive dependency in this repo's lockfile)

- `import { parse, stringify } from "yaml"`; `parse` returns `unknown` (do not trust input, always pass through
  zod validation); `stringify` defaults to 2-space indent, LF. Use only these two APIs, not schema/anchor advanced
  features.
- `parse` **throws an error by default on duplicate keys** (YAML 1.2 default) — exactly the strict behavior we
  want (duplicate username = file unusable); covered by tests.

### 3.3 Paths and process environment

- `process.env.DSH_HOME`: the deploy side starts with `DSH_HOME=~/dsh-smoke <dsh>` (mechanism verified in handoff
  §3.2); this plugin **only reads** this variable to resolve the P6 default path, and does not explore or depend on
  any other harness environment fact.
- `os.homedir()` fallback (cross-platform); CLI and the plugin share the same `defaultUsersFilePath()`
  implementation (`users-file.ts`), guaranteeing the CLI's default `--file` and the plugin's default path match.

### 3.4 No exploration

Following the M1/M2 discipline: if you need a fact not present in this file (field, signature, behavior) → stop
and report; do not guess.

---

## 4. File blueprints

Each file ≤250 lines, function ≤80 lines, complexity ≤15 (ESLint error). M2 file changes are only in three places:
`auth-endpoints.ts` (P17 import), `login-page.ts` (one new export), `index.ts` (P26 assembly).
`token-gate.ts` / `cookie.ts` / `form-body.ts` / `guard.ts` / `gate.ts` / `session-store.ts` /
`self-check.ts` **zero changes**.

### 4.1 `src/password.ts` — scrypt hashing and constant-time verification

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
export const SCRYPT_N = 65536;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 32;
export const SCRYPT_MAXMEM = 128 * 1024 * 1024;
/** Placeholder hash for unknown-user logins (P3): a fixed constant with salt=16×0x7a, verification cost equal to a real user. */
export const DUMMY_HASH =
  "scrypt$65536$8$1$enp6enp6enp6enp6enp6eg$qhquFN2piwx7cxC6jYN4yREJCPln_GQTzBbLmm4bj1k";

/** Generate `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>` (salt is 16 random bytes). */
export async function hashPassword(password: string): Promise<string>;

/** Constant-time verification: parse stored parameters and re-derive (P2); invalid format/params → false, no throw. */
export async function verifyPassword(password: string, stored: string): Promise<boolean>;
```

Behavior contract: `hashPassword` first does `randomBytes(16)` then `scrypt`, concatenating with the current
constant parameters. `verifyPassword` first does `stored.split("$")`: 6 segments, segment 0 === `"scrypt"`, N/r/p
are positive integers with N ≤ 2¹⁷, r ≤ 32, p ≤ 4, the salt/hash segments decode from base64url to 16/32
bytes — any failure → `false`; then with the **parsed** parameters run
`scrypt(password, salt, 32, { N, r, p, maxmem: SCRYPT_MAXMEM })` followed by `timingSafeEqual`. A derivation
exception (e.g. out of memory) → catch and return `false`.

### 4.2 `src/rate-limit.ts` — dual-bucket login rate limiting

```ts
export interface RateLimitOptions {
  maxFailures?: number; // default 5
  baseDelaySeconds?: number; // default 30
  maxDelaySeconds?: number; // default 900
  windowSeconds?: number; // default 600: failure-count decay window (see below)
  now?: () => number; // default Date.now; injected in tests
}

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class LoginRateLimiter {
  constructor(options?: RateLimitOptions);
  check(ip: string, account: string | undefined): RateLimitCheck;
  recordFailure(ip: string, account: string | undefined): void;
  recordSuccess(ip: string, account: string | undefined): void;
}
```

Behavior contract:

- Internally two `Map<string, { failures: number; lockUntil: number; lastFailureAt: number }>`
  (`byIp` / `byAccount`); when `account === undefined || account === ""` only the IP bucket is touched.
- `check`: if either bucket has `lockUntil > now` → `{ allowed: false, retryAfterSeconds: max(1, ceil((lockUntil-now)/1000)) }`
  (take the max of the two buckets); when `lockUntil <= now` and failures > 0 → clear (lock expiry naturally
  retries); **failure decay**: failures > 0 and `now - lastFailureAt > windowSeconds * 1000` → clear (1–4 failures
  with no further failure for 10 minutes are forgotten, preventing slow leakage); simultaneously prune: delete
  entries with `failures === 0`; if total entries > 10000 → delete the **earliest inserted** (Map iteration order)
  until ≤ 10000.
- `recordFailure`: increment `failures` for the bucket, `lastFailureAt = now`; if `failures >= maxFailures` →
  `lockUntil = now + min(baseDelay * 2 ** (failures - maxFailures), maxDelay) * 1000`.
- `recordSuccess`: delete the bucket entry.
- The endpoint does **not** call `recordFailure` during the lock period (429 short-circuit, P10) — the lock duration
  is determined by the failure sequence and is not extended.

### 4.3 `src/users-file.ts` — users.yaml load/validate/atomic write

```ts
import { z } from "zod";
import { parse as parseYaml, stringify } from "yaml";

export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface UserRecord {
  passwordHash: string;
  totpSecret?: string; // parsed in M3 but not used (M4)
  disabled: boolean;
}

export interface UsersSnapshot {
  users: Map<string, UserRecord>;
}

/** The users file is unusable (syntax/schema/permissions). message is operator-facing, safe to log. */
export class UsersFileError extends Error {}

/** Load result: `missing` distinguishes "file absent" from "file present but no users" (for warn-once, P7). */
export interface UsersLoadResult {
  snapshot: UsersSnapshot;
  missing: boolean; // ENOENT → true (snapshot empty); parse/permission failure → throw, does not go through this channel
}

/** P6: DSH_HOME env → ~/.dsh/auth/users.yaml. */
export function defaultUsersFilePath(): string;

/** Read fresh on every login (P7). ENOENT → `{ snapshot: empty, missing: true }` (no throw); otherwise P7/P8 failure semantics. */
export async function loadUsersFile(path: string): Promise<UsersLoadResult>;

/** CLI use: full serialization + atomic replace + 0600 (P19). */
export async function writeUsersFile(path: string, snapshot: UsersSnapshot): Promise<void>;
```

Behavior contract:

- `loadUsersFile`: `fs.stat` → ENOENT → return `{ snapshot: empty snapshot, missing: true }` (**no throw**);
  POSIX and `(mode & 0o077) !== 0` →
  throw `UsersFileError("users file has insecure permissions: <path>")`; win32 skips the permission check.
  `readFile("utf8")` → `parseYaml` → zod validation. zod schema (v4, `z.object({...}).strict()` strict at both
  top level and user entries):
  ```ts
  const userRecordSchema = z
    .object({
      passwordHash: z.string().min(1),
      totpSecret: z.string().optional(),
      disabled: z.boolean().optional(),
    })
    .strict();
  const usersFileSchema = z
    .object({
      version: z.literal(1),
      users: z.record(z.string(), userRecordSchema),
    })
    .strict();
  ```
  Parse/validation failure → throw `UsersFileError(<prefix "invalid users file" from the yaml or zod message>)`;
  each username validated against `USERNAME_RE` one by one (`superRefine` or a loop after load) — invalid → throw.
  On success, build a `Map` (fill in `false` for `disabled`), return `{ snapshot, missing: false }`. A yaml parse
  error (including duplicate keys) → likewise wrapped as `UsersFileError`.
- `writeUsersFile`: `mkdir(dirname, { recursive: true })` → `stringify({ version: 1, users: object })`
  (users in lexicographic order by username, **explicit comparator** `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`) →
  `writeFile(path + ".tmp", text, { mode: 0o600 })` → `rename` → target path. Idempotent, repeatable.

### 4.4 `src/password-gate.ts` — password-mode gate

```ts
import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "./gate.js";
import type { SessionStore } from "./session-store.js";
import { AUTH_PATH_PREFIX } from "./guard.js";
import { parseCookieHeader } from "./cookie.js";

export interface PasswordGateOptions {
  sessions: () => SessionStore | undefined; // M16-shaped accessor
  cookieName: string;
}

export class PasswordGate implements Gate {
  constructor(options: PasswordGateOptions);
  decide(req: IncomingMessage, kind: GuardKind, pathname: string): "allow" | "deny";
}
```

`decide` order implements P12 (whitelist → cookie session → Bearer session token → deny); **synchronous return**,
no async, no KDF, no file IO. When `sessions()` returns undefined, both the cookie and bearer channels are skipped
→ deny (consistent with M2: when the session layer is unavailable the gate always denies, except the whitelist).
The `kind` parameter follows the `Gate` interface (not used by the password gate, signature consistent).

### 4.5 `src/auth-common.ts` — pure functions shared by endpoints

```ts
/** M8+M20 preserved verbatim: starts with a single `/`, not `//`, no `\`, not /auth*; otherwise fall back to `/`. */
export function validateNext(next: string): string;
```

Only this one export. `auth-endpoints.ts` removes its private implementation (L176–187) and changes to
`import { validateNext } from "./auth-common.js"`; `queryOf`/`methodNotAllowed` stay in their own files (not
extracted). This file has no standalone test file — covered by both endpoint suites (coverage reaching the target
is enough).

### 4.6 `src/login-page.ts` — new password variant

```ts
/** password-mode login page: username + password two fields (P13); all next/error HTML-escaped. */
export function passwordLoginPageHtml(next: string, error?: string): string;
```

Reuses the in-file `escapeHtml` and the same style block (an in-file private template function may be extracted,
but only this one export is added). The token version `loginPageHtml` is **preserved as-is**. Title and button
text `Sign in` (distinct from the token version's `Unlock`).

### 4.7 `src/password-login.ts` — POST /auth/login handler logic

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionStore } from "./session-store.js";
import type { UsersLoadResult, UsersSnapshot } from "./users-file.js";
import type { LoginRateLimiter } from "./rate-limit.js";

export interface PasswordLoginDeps {
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number; // seconds
  usersPath: string; // only used for the "file missing" warn message (P23)
  loadUsers: () => Promise<UsersLoadResult>; // index.ts injects the loadUsersFile(usersPath) closure
  verify: (password: string, storedHash: string) => Promise<boolean>; // same shape as verifyPassword, injected directly by index.ts
  limiter: LoginRateLimiter;
  logger: {
    error(message: unknown): void;
    info(message: unknown): void;
    warn(message: unknown): void;
  };
}

/** POST /auth/login (password mode). Completes the entire response write (including 415/413/401/429/503/302). */
export async function handlePasswordLogin(
  deps: PasswordLoginDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void>;
```

Flow implements this exactly (order frozen, must not be rearranged):

1. `parseFormBody(req)` — error carrying `status` (415/413) → write the corresponding response (for 413 first
   `res.setHeader("connection", "close")`, replicating M19); **an exception without `status` propagates upward**.
2. `username = params.get("username") ?? ""`; `password = params.get("password") ?? ""`;
   `next = validateNext(params.get("next") ?? "/")`; `ip = req.socket.remoteAddress ?? ""`.
3. `const check = deps.limiter.check(ip, username === "" ? undefined : username)`;
   locked → `429` + `retry-after: <check.retryAfterSeconds>` + text/plain `"too many attempts"` +
   no-store + `info("rate limit exceeded")`; **return (no verify, no counter increment)**.
4. `let users: UsersSnapshot; let missing = false;` `try { const loaded = await deps.loadUsers(); users = loaded.snapshot; missing = loaded.missing; } catch (error) {`
   → 503 `"user store unavailable"` + no-store +
   `error("user store unavailable: " + (error instanceof Error ? error.message : String(error)))`;
   **return (system error does not count as a failure)**. `}`
   `if (missing && !warnedMissing) { warnedMissing = true; deps.logger.warn("users file not found: " + deps.usersPath + " (all password logins rejected)"); }`
   (`warnedMissing` is a module-level flag of `handlePasswordLogin` — the plugin is a single instance, equivalent
   to once per process; P7/P23.)
5. `const user = users.users.get(username);`
   `const ok = await deps.verify(password, user?.passwordHash ?? DUMMY_HASH);` (DUMMY_HASH imported from
   `./password.js` — timing-uniform for unknown users, P3. **Note the argument order is the same shape as
   `verifyPassword` `(password, storedHash)`** — TS structural compatibility does not check argument names;
   reversed order would always 401 on the real path, which was hit and corrected during implementation).
6. `if (!ok || user === undefined || user.disabled) { deps.limiter.recordFailure(ip, username === "" ? undefined : username);`
   → 401 `"invalid credentials"` + no-store + `info("login rejected")`; return. `}`.
7. `deps.limiter.recordSuccess(ip, username === "" ? undefined : username);`
8. `const store = deps.sessions();` undefined → 503 `"session store unavailable"` + no-store +
   `error("login failed: session store unavailable")`; return.
9. `const { token: sessionToken } = await store.create(username, deps.sessionTtl * 1000);` →
   `set-cookie` (`buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure)`)
   - 302 `{ location: next }` + no-store + `info("session issued")`.

### 4.8 `src/password-endpoints.ts` — password-mode route skeleton

```ts
import { AUTH_PATH_PREFIX, type HttpHandler } from "./guard.js";
import { buildSetCookie, type SessionStore } from "./session-store.js";
import { parseCookieHeader } from "./cookie.js";
import { passwordLoginPageHtml } from "./login-page.js";
import { validateNext } from "./auth-common.js";
import { handlePasswordLogin, type PasswordLoginDeps } from "./password-login.js";

export interface PasswordEndpointsDeps extends PasswordLoginDeps {
  /** Register routes (index.ts passes the wrapped server.register; wrapped by the guard but let through by the gate whitelist). */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
}

/** Register prefix `/auth` fallback + three exact endpoints (password mode); return a merged disposer. */
export function registerPasswordEndpoints(deps: PasswordEndpointsDeps): () => void;
```

Structure follows `auth-endpoints.ts` (merged disposer, track collection): 4 routes —

- prefix `/auth` → always 404 `"not found"` + no-store (P16).
- exact `/auth/login`: GET → `validateNext(query.get("next") ?? "/")` + 200 text/html +
  `passwordLoginPageHtml(next)` (always renders); POST → `handlePasswordLogin(deps, req, res)`;
  others → 405 + `allow: GET, POST`.
- exact `/auth/logout`: POST-only (others 405 + `allow: POST`) — logic verbatim identical to M2 `logout`
  (next query-only, revoke idempotent, `buildSetCookie(name, "", 0, cookieSecure)` clears the cookie, 302,
  `info("logout")`).
- exact `/auth/status`: GET-only (others 405 + `allow: GET`) — logic verbatim identical to M2 `handleStatus`
  (cookie only, Bearer does not participate).

`methodNotAllowed`/`queryOf`/the catch-all handler are implemented inside this file (**content-identical to the
corresponding functions in `auth-endpoints.ts` but each is private** — ~35 duplicated lines accepted: the token
flow is frozen and the two flows' lifecycles are independent; merge only if M4 needs it). All responses no-store.

### 4.9 `src/cli.ts` — dsh-auth user management CLI

```ts
#!/usr/bin/env node
import { pathToFileURL } from "node:url";
// users-file / password module imports follow the same src convention (relative `.js` suffix)

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readLine(): Promise<string>; // one stdin line, trailing \r\n stripped; EOF → ""
}

/** Return the process exit code. All arguments/IO go through argv/io injection (testable, console.* forbidden). */
export async function main(argv: string[], io: CliIo): Promise<number>;

// Entry point at the file bottom (kept last):
// if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
//   void main(process.argv.slice(2), defaultIo).then((code) => { process.exitCode = code; });
// }
```

Behavior contract:

- Usage text (frozen, one shared constant for both usage sites):
  ```
  Usage:
    dsh-auth user add <name> --password-stdin [--disabled] [--file <path>]
    dsh-auth user list [--file <path>]
    dsh-auth user disable <name> [--file <path>]
  ```
- Argument parsing: `--file` takes one value (used as-is, no path expansion); `--disabled`, `--password-stdin`
  are boolean flags; unrecognized token / non-`user` subcommand / unknown subcommand → err(usage) + return 1.
- `add`: name must match `USERNAME_RE` (otherwise err + 1); `--password-stdin` missing → err(usage) + 1;
  `(await loadUsersFile(file)).snapshot` → same name already exists → err(`user <name> already exists`) + 1;
  `readLine()` empty → err(`empty password`) + 1; `hashPassword(pw)` → add to snapshot (`disabled` per
  flag, default false) → `writeUsersFile` → out(`user <name> added`).
- `list`: `(await loadUsersFile(file)).snapshot` → in lexicographic order by username (explicit comparator),
  one line each via out(`<name>` / `<name> (disabled)`). File missing (`missing: true`) → no output, exit 0.
- `disable`: `(await loadUsersFile(file)).snapshot` → not exist → err(`user not found`) + 1;
  set `disabled: true` → `writeUsersFile` → out(`user <name> disabled`) (same output when already disabled,
  idempotent).
- Any `loadUsersFile`/`writeUsersFile` throw (`UsersFileError` or IO) → err(message) + 1.
- `defaultIo`: `out = (l) => process.stdout.write(l + "\n")`, err likewise to stderr, `readLine` uses
  `node:readline` against `process.stdin`, reads one line then closes.

### 4.10 `src/index.ts` — assembly changes (P26; other M1/M2 logic unchanged)

1. `AuthConfig` adds `usersFile: string` (comment: `""` = resolve default path per P6; password-mode only,
   ignored in token mode); `Config` adds `usersFile: z.string().default("")`. `mode`'s JSDoc updated to
   "token (M2) / password (M3)".
2. **Remove** the `mode === "password" → throw` at the start of apply (M2's L99–101).
3. `resolveToken` is only constructed in token mode (not constructed, not accessing credentials, in password mode):
   ```ts
   const resolveToken = config.mode === "token" ? makeTokenResolver(ctx, config, log) : undefined;
   ```
4. password-branch-specific constants (also computed in token mode, harmless — `usersPath`/`limiter` are both
   referenced by step 6's ternary, so not unused variables; `makeTokenResolver` lazily fetches the service and is
   never called in password mode):
   ```ts
   const usersPath = config.usersFile === "" ? defaultUsersFilePath() : config.usersFile;
   const limiter = new LoginRateLimiter();
   ```
5. `auth` formed in one step (P26; the self-referential closure is evaluated only at `decide` time):
   ```ts
   const auth: AuthService = {
     sessions: undefined,
     gate:
       config.mode === "password"
         ? new PasswordGate({ sessions: () => auth.sessions, cookieName: config.cookieName })
         : new TokenGate({
             // in token mode makeTokenResolver must return a function; the `??` fallback only aligns types
             // (unreachable and fail-closed)
             resolveToken: resolveToken ?? (async () => undefined),
             sessions: () => auth.sessions,
             cookieName: config.cookieName,
           }),
   };
   ctx.provide("auth", auth);
   ```
6. Endpoint registration chooses one of two by mode (self-check still runs **after** endpoint registration; the
   token branch's `validateToken` closure likewise uses the `resolveToken ?? (async () => undefined)` fallback):
   ```ts
   ctx.effect(
     () =>
       config.mode === "password"
         ? registerPasswordEndpoints({
             register: (route) => server.register(route),
             sessions: () => auth.sessions,
             cookieName: config.cookieName,
             cookieSecure: config.cookieSecure,
             sessionTtl: config.sessionTtl,
             usersPath,
             loadUsers: () => loadUsersFile(usersPath),
             verify: verifyPassword,
             limiter,
             logger: log,
           })
         : registerAuthEndpoints({
             // M2 params preserved verbatim: register/sessions/cookieName/cookieSecure/sessionTtl/logger as above
             validateToken: async (token) => {
               const stored = await (resolveToken ?? (async () => undefined))();
               return stored !== undefined && safeEqual(token, stored);
             },
           }),
     "dsh-auth: auth endpoints",
   );
   ```
7. storage soft-wiring, `wrapServer`, self-check: **zero changes** (order preserved: storage → wrap → endpoints →
   self-check).

### 4.11 `package.json` / documentation

- `dependencies` adds `"yaml": "^2.9.0"` (ordered by the existing alphabetical order); the top level adds
  `"bin": { "dsh-auth": "lib/cli.js" }`. `files: ["lib"]` already includes the CLI output; `main`/`exports`
  unchanged.
- `README.md` adds a section (consumer contract): `mode: "password"` configuration, users file format and
  permissions (0600, managed by the CLI), CLI usage, token → password migration notes, known limitations
  (rate limiting is in-memory and resets on restart; disabled users do not revoke already-issued sessions; residual
  risk without a CSRF token; Bearer session token semantics; XFF is not trusted).
- `docs/specs/development.md`'s `## Structure` tree updated per the §4 new files.
- `AGENTS.md` adds two-pointer lines: the M3 spec `docs/implemented/impl-m3.md` + the handoff `docs/handoff/handoff-m3.md` (the latter
  written by the execution session when wrapping up; see DoD 6).

---

## 5. Test matrix

M1/M2 tests **all preserved and must stay green unchanged** (`auth-endpoints*.test.ts` does not change as a result
of P17 — validateNext behavior is unchanged). `src/index.test.ts` adapts per §4.10. New tests (all explicit vitest
imports; large suites split into files by describe, each ≤250 lines):

**`src/password.test.ts`** —

1. `hashPassword` output matches `/^scrypt\$65536\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/`;
   two calls produce different salts (strings unequal).
2. roundtrip: `verifyPassword(pw, await hashPassword(pw)) === true`.
3. wrong password → false; empty-string password hashes/verifies normally (`hash("")` is verifiable).
4. `verifyPassword` all bad-input branches: not 6 segments, wrong prefix, N/r/p not numeric, N > 2¹⁷, wrong salt
   segment length, invalid base64url → all false and no throw.
5. DUMMY_HASH known vector: `verifyPassword("dsh-auth-dummy-password-for-timing-uniformity", DUMMY_HASH) === true`;
   other passwords → false (the DUMMY password literal is not a secret, allowed in assertions).
6. parameter-evolution compatibility: manually construct a valid old-parameter hash (`scryptSync` generated at
   N=2¹⁴, assembled as `scrypt$16384$8$1$<salt>$<hash>`) → `verifyPassword` still succeeds under the module constant
   N=2¹⁶ (proving verification uses the **parameters carried by stored** rather than the current constants; note
   that scrypt's N participates in derivation, so **changing the N segment requires re-deriving at the same time**
   for validity — the original "replace the N segment" approach was wrong and was corrected in implementation to the
   construction method above).

**`src/rate-limit.test.ts`** (injected `now`) —

1. First 4 failures → check always allowed.
2. After the 5th failure check → locked, `retryAfterSeconds === 30`.
3. After the 6th failure → 60; grows to cap at 900 (call a few more times to assert the cap).
4. During the lock period check is locked (no further `recordFailure`).
5. Clock passes `lockUntil` → check allowed and counters cleared (failures restart from 1).
6. After `recordSuccess` check allowed, counters cleared.
7. IP bucket and account bucket are independent: different accounts failing on the same IP do not lock each other;
   the same account on different IPs is locked by the account bucket.
8. `account: undefined`/`""` only touches the IP bucket.
9. decay and pruning: injected now — after 3 failures advance the clock 10 minutes → check clears and the entry is
   deleted (the count is not observable on subsequent checks); when the entry count exceeds 10000 the earliest is
   deleted — the cap is a module constant not exported, so use 10001 **distinct keys**, each `recordFailure` once
   (failures=1, so ordinary pruning will not delete them), then call `check` once and assert the Map size falls
   back to 10000 and the earliest-inserted key has been evicted (each a few ms, feasible).

**`src/users-file.test.ts`** (`mkdtemp` temp directory; cases with `it.skipIf(process.platform === "win32")` use
vitest conditional skip) —

1. `defaultUsersFilePath`: `vi.stubEnv("DSH_HOME", tmp)` → assembles `<tmp>/auth/users.yaml`;
   no env → `path.join(os.homedir(), ".dsh", "auth", "users.yaml")` (assert homedir prefix; afterwards
   `vi.unstubAllEnvs()`).
2. load: a valid file (two users, one with totpSecret/disabled) → Map contents correct, `disabled` defaults to
   false.
3. File absent → `{ snapshot: empty Map, missing: true }` (no throw); present and valid → `missing: false`.
4. Bad YAML (syntax) → `UsersFileError`; duplicate-key YAML → `UsersFileError`.
5. schema errors: version not 1, unknown top-level key, unknown user field, missing passwordHash, invalid
   username, totpSecret not a string → all `UsersFileError`.
6. overly permissive permissions (`writeFileSync` then `chmodSync(0o644)`) → `UsersFileError` (POSIX only).
7. write: snapshot → file contents exact (yaml structure, lexicographic usernames, `disabled: true` explicit);
   mode 0600 (`statSync` assert, POSIX only); no `.tmp` residual; directory auto-created when absent.

**`src/password-gate.test.ts`** (fake req headers + fake sessions (reusing the MemTable idea)) —

1. whitelist: `/auth`, `/auth/login`, `/auth/whatever` → allow (no credentials).
2. cookie channel: valid session → allow; unknown/expired/revoked token → deny; cookie header absent → deny.
3. Bearer channel: `Authorization: Bearer <session token>` → allow; unknown token → deny; lowercase `bearer`
   prefix acceptable; malformed prefix format → deny.
4. `sessions: () => undefined`: both cookie and bearer skipped → deny (except the whitelist).
5. no credentials → deny. Return value is the synchronous `"allow" | "deny"` (not a Promise).

**`src/password-endpoints.test.ts`** (fake register/limiter/loadUsers/verify/sessions; split into three files by
line count: `password-endpoints.test.ts` for registration shape/GET login/logout/status,
`password-endpoints.login.test.ts` for POST login, `password-endpoints.methods.test.ts` for
405/fallback/415/413/page escaping — the matrix below is the merged description) —

1. registration shape: 4 — prefix `/auth`, exact `/auth/login`, `/auth/logout`, `/auth/status`.
2. GET login: 200 + HTML containing `<form`, `name="username"`, `name="password"`; hidden next escaped
   (`next="/x?a=1&b=2"` → `&amp;`); with an existing valid session it still always renders 200 (consistent with
   M20).
3. POST login success: fake verify true → 302 location=next + exact set-cookie string (both secure=true/false
   states) + `sessions().create` called (subject = username, ttl = sessionTtl*1000) +
   `limiter.recordSuccess` called + `info("session issued")`.
4. POST login failure: verify false → 401 `"invalid credentials"` + `info("login rejected")` +
   `recordFailure` called, no session created; unknown user (loadUsers does not contain the name) → verify receives
   **DUMMY_HASH** → 401; disabled user → verify receives that user's real hash + 401 (P9: three states unified).
5. POST login 429: limiter preset locked → 429 + numeric `retry-after` + `info("rate limit exceeded")`;
   **verify not called** (no verification during the lock period).
6. POST login 503: fake loadUsers rejects → 503 `"user store unavailable"` + error log + no failure counted;
   `sessions()` undefined → 503 `"session store unavailable"`.
   6b. POST login file missing: fake loadUsers returns `{ snapshot: empty, missing: true }` → 401
   `"invalid credentials"` (empty user set) + `warn("users file not found: ...")` **once, on the first time**;
   the second login does not repeat the warn (module-level flag).
7. POST login next validation: `//evil.com` → `/`; `/ok/path` → as-is; `/auth/login`, `/auth/x` → `/`
   (M20 loopback protection carried over).
8. POST login empty username: only the IP bucket is touched (fake limiter asserts the account argument is
   undefined); on the success path with a non-empty username → the account argument = username.
9. POST logout: revoke called + set-cookie contains `Max-Age=0` + 302; next is query-only; no-body/no
   content-type usable; 302 idempotent even without a cookie (replicating M22).
10. GET status: valid cookie → `{"authenticated":true}`; none → false; an `Authorization: Bearer`
    header has no effect (cookie only, M5).
11. method dispatch: `DELETE /auth/login` → 405 + `allow: GET, POST`; `GET /auth/logout` → 405;
    `POST /auth/status` → 405.
12. prefix fallback: `/auth/whatever` → 404 + no-store.
13. 415/413: not urlencoded → 415; over 16 KiB → 413 + `connection: close` + `req.destroy` not called
    (replicating M19).
14. `passwordLoginPageHtml`: directly assert the HTML contains both fields and escaping (in this file or in the
    login-page-related file).

**`src/cli.test.ts`** (fake `CliIo`: `out/err` collected into arrays, `readLine` returns preset lines) —

1. `add` full flow: mkdtemp file path + `--password-stdin` → exit 0, out contains `user alice added`,
   the file exists with mode 0600 (POSIX only), then re-reading via `loadUsersFile` contains alice; use
   `verifyPassword` to confirm the hash in the file verifies that password (one real scrypt).
2. `add` failure branches: missing `--password-stdin` → exit 1 + usage; invalid name (with a space / starts with a
   digit) → exit 1; same name already exists → exit 1 + `already exists`; empty stdin line → exit 1.
3. `add --disabled` → reading back yields `disabled: true`.
4. `list`: preset two users (one disabled) → two output lines, lexicographic, `(disabled)` marker; empty file →
   no output, exit 0.
5. `disable`: → exit 0 + `user alice disabled` + reading back shows disabled; not exist → exit 1 + `not found`;
   disabling again → idempotent exit 0.
6. unknown subcommand/unknown flag → exit 1 + usage to err.
7. `--file` pointing at a nonexistent directory → auto-created (writeUsersFile semantics).

**`src/index.test.ts` adaptation** (all existing cases preserved, new additions/modifications) —

1. `mode: "password"` **no longer throws** (delete M2's throw test case); the gate is a `PasswordGate` instance.
2. `mode: "token"` (default) gate is still `TokenGate`; the fake ctx records that `get("credentials")` was accessed.
3. password mode: the fake ctx asserts `get("credentials")` was **not accessed**; endpoint registration goes through
   the password version (fake register records 4 routes, same shape as the token version).
4. `usersFile` default resolution: under `vi.stubEnv("DSH_HOME", tmp)`, mount password mode with `vi.mock("./password-endpoints.js")`
   capturing the deps `registerPasswordEndpoints` receives → assert `deps.usersPath === path.join(tmp, "auth", "users.yaml")`;
   explicit `usersFile: "/x.yaml"` → `deps.usersPath === "/x.yaml"`. Afterwards `vi.unstubAllEnvs()`.
5. Config defaults: `{}` → contains `usersFile: ""`.
6. existing logout/self-check/both-missing cases stay green (token branch).

**`src/integration.password.test.ts`** (real entry path) — real cordis + **real storage stack**
(Storage → storage-json → storage-domain, mount order same as `integration.auth.test.ts`) + real
WebServer + real users file (`mkdtemp` root; `beforeAll` uses `hashPassword` + `writeUsersFile`
to preset `admin` (password `<test-password>`) and `disableduser` (`disabled: true`)) + this plugin
`config { mode: "password", cookieSecure: false, usersFile: <tmp>/users.yaml }`:

1. full flow: `GET /auth/login` → 200 containing `name="username"`; wrong password → 401; correct → 302 +
   set-cookie + location; with cookie `GET /__probe` → 200; without cookie → 302 (HTML accept) / 401 (JSON
   accept); `Authorization: Bearer <session token from the cookie>` → 200; wrong Bearer → 401;
   `POST /auth/logout?next=/` with cookie → 302 + Max-Age=0; the original cookie then → 401.
2. subject audit: after a successful login, `ctx.get("auth")!.sessions!.getByToken(<cookie token>)!.subject === "admin"`.
3. disabled/unknown users: disableduser → 401; `ghost` → 401 (identical `invalid credentials` response body).
4. file unusable: rewrite users.yaml as bad YAML → login 503; restore → normal 401. File missing (pointing at a
   nonexistent path, standalone instance) → login 401 (empty user set).
5. WS channel: upgrade with a session cookie → 101; upgrade with `Authorization: Bearer <session token>` →
   101; no credentials → 401 rejects the handshake (reusing the M1 `requestUpgradeStatus` pattern + header
   variants).
6. 429 rate limiting: **separate describe + new ctx/port** (P25 — do not pollute the shared instance's limiter):
   5 consecutive failures → the 6th is 429 + `retry-after` header; then even the correct password is 429 (locked).
7. token-mode regression is covered by the existing `integration.auth.test.ts` (unchanged, must stay green).

---

## 6. Implementation order (keep `npm run verify` green at every step)

1. `package.json` (yaml + bin) + `npm install --registry=https://registry.npmjs.org/`.
2. `src/password.ts` + `src/password.test.ts`.
3. `src/rate-limit.ts` + `src/rate-limit.test.ts`.
4. `src/users-file.ts` + `src/users-file.test.ts`.
5. `src/auth-common.ts` (extract validateNext) + change `auth-endpoints.ts` to import — **immediately run
   `npm run test -- src/auth-endpoints.test.ts src/auth-endpoints.login.test.ts src/auth-endpoints.methods.test.ts`
   to prove M2 behavior is unchanged**.
6. `src/password-gate.ts` + `src/password-gate.test.ts`.
7. `src/login-page.ts` increment (`passwordLoginPageHtml`, covered by tests in steps 8/9).
8. `src/password-login.ts` (line-count split piece, tested via step 9).
9. `src/password-endpoints.ts` + three test files (`password-endpoints.test.ts` /
   `password-endpoints.login.test.ts` / `password-endpoints.methods.test.ts`).
10. `src/cli.ts` + `src/cli.test.ts`.
11. `src/index.ts` assembly + `src/index.test.ts` adaptation.
12. `src/integration.password.test.ts`.
13. Documentation: `docs/specs/development.md` Structure tree, `README.md` (password mode/CLI/users file contract),
    `AGENTS.md` (M3 pointers).
14. `npm run build` + `lib/` in the same batch as `src/`; `git diff --exit-code -- lib` passes.
15. Server end-to-end smoke test (DoD 4).
16. Wrap up by writing `docs/handoff/handoff-m3.md` (DoD 6).

---

## 7. Definition of Done

1. `npm run verify` fully green (format/lint/type-check/coverage ≥80%/lock:check).
2. `npm run build` + `lib/` in the same batch as `src/`; `git diff --exit-code -- lib` passes.
3. `npm run test -- src/integration.password.test.ts src/integration.auth.test.ts src/integration.guard.test.ts src/integration.session.test.ts` passes when run alone (token-mode regression + password real path).
4. **Server end-to-end smoke test** (environment facts see handoff §3; **this machine's loopback is unreachable,
   always verify on the server**):
   1. sync: `rsync -az --exclude node_modules --exclude .git /Users/randal/source/dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
      → on the server `cd /tmp/dsh-auth-test && npm install --registry=https://registry.npmjs.org/ && npm run build`.
   2. create a user (real CLI path):
      ```bash
      ssh ubuntu 'printf "%s\n" "<test-password>" | node /tmp/dsh-auth-test/lib/cli.js user add admin --password-stdin --file ~/dsh-smoke/auth/users.yaml'
      ssh ubuntu 'node /tmp/dsh-auth-test/lib/cli.js user list --file ~/dsh-smoke/auth/users.yaml'
      ssh ubuntu 'stat -c "%a" ~/dsh-smoke/auth/users.yaml'   # expect 600
      ```
   3. overlay `~/dsh-smoke/cordis.patch.yml`: change the `dsh-auth` line's config to
      `{ mode: "password", cookieSecure: false }` (confirm the M1 probe line is gone — handoff §5.3); restart the
      instance (`pkill -f "[d]sh --profile web --port 3081"` and startup are **two separate ssh calls**, handoff
      §6 lesson; `nohup ... > ~/dsh-smoke/boot.log 2>&1 < /dev/null &`, wait ~25s).
   4. verification sequence (**run the correct-password full flow first, the 429 sequence last** — the 30s lock
      only affects the login endpoint):
      - `curl -s http://127.0.0.1:3081/auth/login | grep -o 'name="username"'` → hit; status 200;
      - `curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" http://127.0.0.1:3081/auth/login` → 401;
      - `curl -s -i -d "username=admin&password=<test-password>" -c jar http://127.0.0.1:3081/auth/login | head -3` → 302 + `set-cookie`;
      - `curl -s -o /dev/null -w "%{http_code}\n" -b jar http://127.0.0.1:3081/__auth_probe` → 200;
        without cookie: `-H "Accept: application/json"` → 401, `-H "Accept: text/html"` → 302;
      - Bearer session token: `TOK=$(awk '$6=="dsh_auth" {print $7}' jar)` →
        `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOK" http://127.0.0.1:3081/__auth_probe` → 200; a wrong token → 401;
      - `curl -s http://127.0.0.1:3081/auth/status -b jar` → `{"authenticated":true}`;
      - WS: upgrade without a cookie → first line `HTTP/1.1 401`; `-b jar` → `HTTP/1.1 101` (the
        curl command from handoff §5.4 + the `-b jar` / `-H "Authorization: Bearer $TOK"` variants);
      - `curl -s -i -X POST "http://127.0.0.1:3081/auth/logout?next=/" -b jar | head -3` → 302 +
        `Max-Age=0`; the original cookie then `GET /__auth_probe` → 401;
      - `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/auth/whatever` → 404;
      - last: send the wrong password 6 times (`for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -d "username=admin&password=wrong" http://127.0.0.1:3081/auth/login; done`)
        → first 5 are 401, the 6th is 429; `curl -s -i -d "username=admin&password=<test-password>" http://127.0.0.1:3081/auth/login | head -5` → 429 + `retry-after` header.
   5. wrap up: kill or keep the instance (report status); `boot.log` has no `password flow requires M3`-style error.
5. Report: changed files, P1–P26 landing points, coverage numbers, deviations from this document (should be zero).
6. **Write `docs/handoff/handoff-m3.md`** (for the M4 handoff): environment-fact increments (e.g. measured scrypt time,
   the CLI's actual path on the server), M3 smoke-test real results, an M3 pitfalls list, M4 (TOTP) starting-point
   hints. Commit/push only when instructed by the user.

---

## 8. Forbidden-zone checklist

- **Do not explore the harness internals** (same as M1/M2); users file, scrypt, yaml all go only through the facts
  in §3.
- **Only add `yaml` as a dependency**: scrypt/CLI argument parsing/readline are all built-in; devDependencies
  unchanged; do not touch any harness package such as `dsh-credentials-local`.
- **Do not change token-mode behavior**: `token-gate.ts`/`cookie.ts`/`form-body.ts`/`guard.ts`/`gate.ts`/
  `session-store.ts`/`self-check.ts` zero changes; `auth-endpoints.ts` only the one mechanical P17 import change;
  `integration.auth.test.ts` must stay green unchanged.
- **Do not weaken security parameters**: scrypt N/r/p/maxmem frozen (P1); tests must not swap in weak parameters
  (P25); rate-limit constants not configurable (P22).
- **Do not log sensitive values**: passwords/usernames (login logs)/hashes/session tokens never enter logs and
  test snapshots (P23); DUMMY constants are the exception (not secret).
- **Do not swallow auth failures**: unknown user/wrong password/disabled all uniformly 401; file unusable 503;
  credential/file errors are not silently passed through.
- **Do not change the gates**: eslint/tsconfig/vitest/coverage thresholds unchanged; no `eslint-disable` (except
  allowed items already present in a file).
- **Branch discipline**: `development`; no commit/push without instruction; `lib/` in the same batch as `src/`.
- M4 (TOTP two-step, `revokeBySubject`, CSRF token, rate-limit persistence) **is not done** — when needed, only
  write a `TODO(auth-m4):` comment (with a stable tag).

---

## 9. Explicitly not done (outside M3 scope)

- TOTP two-step login, using `totpSecret`, replay protection (M4).
- Immediately revoking already-issued sessions of disabled users (P15 limitation, evaluate `revokeBySubject` in M4).
- token + password dual-mode coexistence (mode is one of two, P11).
- Rate-limit persistence/across processes (in-memory, P10).
- CSRF token (P21 evaluation conclusion: not in M3, re-evaluate in M4).
- Login page beautification/internationalization, the client-side sign-out button (GUI components).
- Deploy-side deliverables: a production `cordis.patch.yml`, the deployment acceptance checklist (done separately
  after the M3 smoke test passes, handoff §6).
