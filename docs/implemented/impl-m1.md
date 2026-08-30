# dsh-auth M1 Implementation Spec (executable spec)

> Reader: the coding agent that executes the implementation (expected deepseek v4 flash). This document is a **decision-complete spec**:
> every judgment point has already been closed in advance; the executor only translates, does not design.
> Design rationale is in `docs/specs/dsh-auth-plan.md`; engineering gates are in `docs/specs/development.md`; this file is the sole
> authoritative fine-grained ruleset of the two for the M1 scope — where they conflict, this file wins.
>
> All mount-point facts have been verified against the real source and type declarations of `@deepseek-ai/*@0.1.0-rc.6` / `@deepseek-ai/cordis@4.0.1`.
> **Do not explore the harness internal implementation on your own**: whenever you need a fact (field, signature, behavior) that does not
> appear in this file, stop and report it; do not guess.

---

## 1. Frozen Decision Table

| #   | Decision              | Frozen Value                                                                                                                                                                         |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | M1 gate behavior      | The guard pipeline (wrapping + 302/401/deny handshake) is fully implemented; `gate` is `noopGate` (allows everything). M2 only swaps the gate, does not touch the guard              |
| D2  | Plugin dependencies   | Hard dependency `inject: ["webServer"]`; `storageDomain` is soft-read via `ctx.get()`                                                                                                |
| D3  | storageDomain missing | `ctx.logger("dsh-auth").error(...)` then **continue mounting the guard** (the M1 gate is lazy; from M2 onward it changes to runtime deny-all fail-closed)                            |
| D4  | auth service          | `ctx.provide("auth", { sessions, gate })`; `gate` is a writable field (M2 swaps the stream, tests inject a fake gate); type augmentation `declare module "@deepseek-ai/cordis"`      |
| D5  | Guard marker          | `Symbol.for("dsh-auth.guarded")` is attached to the wrapped handler/method; repeated wrapping is idempotent (if marked, return as-is)                                                |
| D6  | Reversible lifecycle  | `ctx.effect` registers the restorer; the restorer runs in reverse: first uninstall the guard, then close the domain. Restore = restore the snapshot + the original method            |
| D7  | Deny response         | Browser navigation (GET and `Accept` contains `text/html`) → `302 /auth/login?next=<encoded pathname>`; other HTTP → `401` body `unauthorized`; both carry `cache-control: no-store` |
| D8  | WS deny               | Do not enter ws negotiation: `socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")` then `socket.destroy()`; the guard attaches no listeners to the socket         |
| D9  | Self-check failure    | Per-item `logger.error` then `throw new Error("dsh-auth: guard self-check failed: ...")` (fiber start failure = fail loud)                                                           |
| D10 | Session token         | `randomBytes(32).toString("base64url")` (43 chars, no padding); on-disk key = `sha256` hex lowercase (64 chars); **logs never output the full token**                                |
| D11 | Session TTL           | Default `604800` seconds (7 days), fixed expiration from creation, no sliding                                                                                                        |
| D12 | Logout semantics      | Revoke = delete the row (`delete`); `pruneExpired` scans the entire table and cleans up expired rows before every `create`                                                           |
| D13 | Cookie                | `buildSetCookie(name, token, maxAge)` outputs the exact format `<name>=<token>; Max-Age=<secs>; Path=/; HttpOnly; Secure; SameSite=Lax` (used by M2, frozen and tested by M1)        |
| D14 | Config                | schemastery (consistent with the harness); the record schema uses zod (the storage-domain division-of-labor convention)                                                              |
| D15 | Module system         | NodeNext; relative imports always use the `.js` suffix; `console.*` forbidden; logging goes through `ctx.logger("dsh-auth")`                                                         |
| D16 | Idempotent re-wrap    | A second `wrapServer` on the same server returns the same unwrap (recorded via `WeakMap`), no double guard                                                                           |

---

## 2. Authoritative Contracts (Mount-Point Facts)

### 2.1 `webServer` service (`@deepseek-ai/dsh-host-webserver@0.1.0-rc.6`)

Runtime facts (`private` is only a TS-level concern; everything is reachable at runtime):

- Tables: `server.exact: Map<string, WebRoute>`, `server.prefixes: Map<string, WebRoute>`,
  `server.upgrades: Map<string, WebUpgradeRoute>`; `server.fallback: handler | undefined`.
- `WebRoute = { kind: "exact" | "prefix"; path: string; handler: (req, res) => void | Promise<void> }`;
  `WebUpgradeRoute = { path: string; handler: (req, socket: Duplex, head: Buffer) => void | Promise<void> }`.
- Registration methods: `register(route)` (throws on duplicate `(kind, path)`), `registerUpgrade(route)` (throws on duplicate path),
  `registerFallback(handler)` (the second one throws). **All three return disposers**, and the disposer deletes the table entry by path —
  replacing a table entry in place does not break the semantics of disposers already emitted.
- Dispatch (table lookup at request time): `match(pathname)` = exact hit in the exact table → otherwise longest prefix (`pathname === prefix` or
  `pathname.startsWith(prefix + "/")`) → otherwise fallback → otherwise 404.
- Upgrade dispatch: in the `upgrade` event, `this.upgrades.get(new URL(req.url ?? "/", "http://x").pathname)`,
  destroy the socket on a miss.
- Error handling: errors thrown by async handlers are caught uniformly by the webserver: `ctx.logger.warn` + 400 if headers not sent / destroy if already sent.
  The guard **must not swallow handler errors** (throw them upward directly, let them take this path).
- Service shape: `WebServer extends Service`, registered via `super(ctx, "webServer")`; `static Config` is
  schemastery (`host: "127.0.0.1" | "0.0.0.0"`, `port: z.natural().max(65535)`, port 0 = OS-assigned).
  The listen takes effect immediately on mount (`[Service.init]`), and `instance.port` is the final listening port.

### 2.2 storage domain (`@deepseek-ai/dsh-storage-domain@0.1.0-rc.6`)

- Module exports: `defineDomain(spec)`, `domainTable(zodSchema)`; `ctx.storageDomain: DomainFacility`.
- `DomainFacility.open(spec): Promise<Domain<S>>` — **the caller owns the returned handle** and must itself
  `await domain.close()` in the effect disposer (idempotent).
- `Domain<S>`: `domain.table(name): KvTable<K, V>` (the handle is stable, can be fetched repeatedly); `domain.close(): Promise<void>`.
- `KvTable`: `get(key): V | undefined` (synchronous in-memory read), `put(key, value): Promise<void>`,
  `delete(key): Promise<boolean>`, `entries(): IterableIterator<[K, V]>` (snapshot iteration), `size: number`.
  Writes persist to the medium first, then mutate memory; the returned record is the stored object itself and **must not be mutated in place**.
- `DomainSpec = { name: string; version: number; global?: ...; tables: Record<string, DomainTableSpec> }`.
  The spec's record schema uses **zod** (`z.infer` derives the type; do not hand-write a duplicate type).
- **Name constraint (verified by measurement)**: `DomainSpec.name` and the table name must both match
  `UNIT_NAME_RE = /^[a-z][a-z0-9_]*$/` (exported by `@deepseek-ai/dsh-storage`) — **hyphens forbidden**,
  otherwise `defineDomain` throws at module load time. Hence this plugin's domain name is `dsh_auth_sessions` (underscores).
- Backend: `dsh-storage-json` registers with `backend: "json"`, one `<unit>.json` file per unit under root;
  file format (verified by measurement): `{ unit: { name, version }, global, tables: { <table>: { <key>: record } } }`,
  pretty-printed + trailing newline. `dsh-storage-domain`'s Config is `{ backend: "json" }` (the local web profile is already configured this way).
- In the real web composition, the `storage-domain` line is at the bundle layer (`dsh-web-app`), and our line is mounted only after the profile layer,
  so `ctx.get("storageDomain")` is normally visible at apply time; in integration tests, mount the storage stack first, then this plugin.

### 2.3 cordis Context (`@deepseek-ai/cordis@4.0.1`)

- Object plugin shape: `{ name, inject, apply, Config }`; apply only executes after the services declared by `inject` are available.
- `ctx.get(name)` is a soft read; `ctx.provide(name, value)` provides a service (automatically unregistered with the fiber).
- `ctx.effect(callback, label)`: callback returns a disposer (sync or async), and on fiber unload the disposers
  execute **in reverse registration order**. Mounting: `ctx.plugin(plugin, ...config)` returns `Fiber & PromiseLike<Fiber>`,
  `Fiber.dispose(): Promise<void>` uninstalls.
- `ctx.logger` itself is a logger instance; `ctx.logger("dsh-auth")` returns a named logger (`error/warn/info`).
- `new Context()` ships with built-in services (logger/registry/reflect).

---

## 3. Dependency Changes (`package.json`)

```jsonc
{
  "dependencies": {
    "@deepseek-ai/dsh-storage-domain": "^0.1.0-rc.6", // new: src runtime import (defineDomain/domainTable)
    "@deepseek-ai/schemastery": "^3.18.1", // existing
    "zod": "^4.4.3", // existing
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1", // moved out of dependencies (the host provides the instance)
  },
  "devDependencies": {
    // new (test/type only):
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-host-webserver": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-storage": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-storage-json": "^0.1.0-rc.6",
    // the rest stays unchanged
  },
}
```

- The install must use `npm install --registry=https://registry.npmjs.org/` (AGENTS.md lockfile rule; all packages have been
  verified to exist on the public npm, versions exact).
- src **must not** import `dsh-host-webserver`/`dsh-storage`/`dsh-storage-json` (they appear only in tests);
  src uses custom structural types for the webserver (§4.2).

---

## 4. File Blueprints

Each file: responsibility, exported signatures, behavior conventions, line budget (file ≤250 lines, function ≤80 lines, complexity ≤15; all
ESLint errors, violating any of them is red).

### 4.1 `src/gate.ts` — gate decision vocabulary and lazy gate

```ts
import type { IncomingMessage } from "node:http";

/** The wrapped-entry category reported during a Guard decision. */
export type GuardKind = "exact" | "prefix" | "upgrade" | "fallback";

/** allow = let the original handler through; deny = the guard executes the 302/401/deny handshake (§D7/D8). */
export type GateDecision = "allow" | "deny";

export interface Gate {
  decide(
    req: IncomingMessage,
    kind: GuardKind,
    pathname: string,
  ): GateDecision | Promise<GateDecision>;
}

/** M1 lazy gate: always allows. M2 replaces it wholesale with the token/password gate. */
export const noopGate: Gate = { decide: () => "allow" };
```

Behavior convention: `GuardKind` is defined here (`guard.ts` depends on it, direction is one-way, no circular import).

### 4.2 `src/guard.ts` — wrapping mechanism and deny pipeline (core risk file)

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Gate, GuardKind } from "./gate.js";

export const GUARDED: unique symbol = Symbol.for("dsh-auth.guarded");
export const LOGIN_PATH = "/auth/login";

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
export type UpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void | Promise<void>;

export interface WrappableRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
}
export interface WrappableUpgradeRoute {
  path: string;
  handler: UpgradeHandler;
}

/** Structural mirror of the webServer runtime shape (§2.1); the real instance satisfies it at runtime. */
export interface WrappableServer {
  exact: Map<string, WrappableRoute>;
  prefixes: Map<string, WrappableRoute>;
  upgrades: Map<string, WrappableUpgradeRoute>;
  fallback: HttpHandler | undefined;
  register(route: WrappableRoute): () => void;
  registerUpgrade(route: WrappableUpgradeRoute): () => void;
  registerFallback(handler: HttpHandler): () => void;
}

export type GuardLog = { error(message: unknown): void };

// Signature note: `Function` is banned by lint (no-unsafe-function-type); the arbitrary-function
// form `(...args: never[]) => unknown` expresses "accept any callable".
export function isGuarded(target: (...args: never[]) => unknown): boolean;
export function guardHttp(gate: () => Gate, kind: GuardKind, handler: HttpHandler): HttpHandler;
export function guardUpgrade(gate: () => Gate, handler: UpgradeHandler): UpgradeHandler;
export function denyHttp(req: IncomingMessage, res: ServerResponse): void;
export function denyUpgrade(socket: Duplex): void;
export function wrapServer(server: WrappableServer, gate: () => Gate, log: GuardLog): () => void;
```

Implementation conventions (execute each of these, no deviation):

- `guardHttp`: if `handler[GUARDED] === true`, return as-is (D5 idempotency). Otherwise return a marked
  `async (req, res) => { const pathname = new URL(req.url ?? "/", "http://x").pathname; const d = await gate().decide(req, kind, pathname); if (d === "allow") { await handler(req, res); return; } denyHttp(req, res); }`.
  Errors are not caught (§2.1 the webserver handles them uniformly).
- `guardUpgrade`: isomorphic; the deny branch calls `denyUpgrade(socket)`, does not call the original handler, attaches no socket listeners.
- `denyHttp`: `res.setHeader("cache-control", "no-store")`; `req.method === "GET"` and
  `String(req.headers.accept ?? "").includes("text/html")` → `res.writeHead(302, { location: `${LOGIN_PATH}?next=${encodeURIComponent(pathname)}` }); res.end();`;
  otherwise `res.writeHead(401, { "content-type": "text/plain" }); res.end("unauthorized");`.
  Header names are lowercase (node normalizes to lowercase).
- `denyUpgrade`: first `socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n")` then
  `socket.destroy()`.
- `wrapServer`:
  1. A module-level `const unwrappers = new WeakMap<WrappableServer, () => void>()`; if it already exists, return the existing unwrap (D16).
  2. Capture `orig = { register: server.register.bind(server), registerUpgrade: ..., registerFallback: ... }`
     and the snapshot `{ exact: new Map(server.exact), prefixes: ..., upgrades: ..., fallback: server.fallback }`.
  3. Replace the existing entries in place: `for (const [p, r] of server.exact) server.exact.set(p, { ...r, handler: guardHttp(gate, "exact", r.handler) })`;
     same for prefixes (kind uses `r.kind`); upgrades use `guardUpgrade`; if `fallback` exists,
     `server.fallback = guardHttp(gate, "fallback", server.fallback)`.
  4. Replace the instance methods (incremental insurance, apply-order-independent):
     `server.register = (route) => orig.register({ ...route, handler: guardHttp(gate, route.kind, route.handler) })`;
     `registerUpgrade` uses `guardUpgrade`; `registerFallback = (h) => orig.registerFallback(guardHttp(gate, "fallback", h))`.
     All three replaced functions set `[GUARDED] = true` (for self-check, §4.4).
  5. Return the unwrap (and store it in the WeakMap): clear the four tables and refill from the snapshot (`server.exact.clear()` then set each snapshot entry one by one),
     `server.fallback = snapshot.fallback`, restore the three methods to `orig.*`. Registrations added during the post-wrap period are discarded on restore
     (disposers still operate on the current table by path, so semantics are safe — restore is an overall rollback).
- `gate: () => Gate` is an accessor rather than a value: the closure reads the latest gate on each request (M2 swaps the stream and tests inject a fake gate, both relying on this).

### 4.3 `src/session-store.ts` — persistent sessions (storage domain)

```ts
import { defineDomain, domainTable, type KvTable } from "@deepseek-ai/dsh-storage-domain";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const COOKIE_FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function buildSetCookie(cookieName: string, token: string, maxAgeSeconds: number): string;
// Exact output: `${cookieName}=${token}; Max-Age=${maxAgeSeconds}; ${COOKIE_FLAGS}`

export function digestToken(token: string): string; // createHash("sha256").update(token).digest("hex")

export interface Session {
  subject: string; // for audit: the credential identity that produced this session (M1 is always "token", M2 is the username)
  createdAt: number; // epoch ms
  expiresAt: number; // epoch ms
  revoked: boolean;
}

export interface IssuedSession {
  token: string;
  session: Session;
}

const sessionRowSchema = z.object({
  subject: z.string(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  revoked: z.boolean(),
});
// key = digest (64-char hex lowercase), not stored in the row; the row stores only the four fields above.

export const sessionDomainSpec = defineDomain({
  name: "dsh_auth_sessions", // must match UNIT_NAME_RE (no hyphens, see §2.2)
  version: 0,
  tables: { sessions: domainTable(sessionRowSchema) },
});

export class SessionStore {
  constructor(table: KvTable<string, Session>);
  create(subject: string, ttlMs: number): Promise<IssuedSession>;
  getByToken(token: string): Session | undefined; // synchronous: hash → memory read → validate
  revokeByToken(token: string): Promise<boolean>; // the return value of delete passed through directly
  pruneExpired(now?: number): Promise<number>; // delete all expired rows, return the number deleted
}
```

Behavior conventions:

- `create`: first `await this.pruneExpired()`; `token = randomBytes(32).toString("base64url")`;
  `now = Date.now()`; `put(digest, { subject, createdAt: now, expiresAt: now + ttlMs, revoked: false })`;
  returns `{ token, session: the same row }`.
- `getByToken`: `const row = table.get(digestToken(token))`; `row === undefined || row.revoked || row.expiresAt <= Date.now()` → `undefined`; otherwise return the row (**do not modify the row**).
- `pruneExpired(now = Date.now())`: iterate `entries()`, `await table.delete(key)` for everything with `expiresAt <= now`, return the count.
- This module does **not** open/close the domain (that is `index.ts`'s wiring responsibility); the class programs against `KvTable`,
  unit tests use an in-memory fake table, integration tests use the real stack.

### 4.4 `src/self-check.ts` — startup self-check

```ts
import type { WrappableServer } from "./guard.js";

/** Returns the list of entries not covered by the guard marker, shaped like "exact /api", "fallback", "method register". Empty = passed. */
export function assertGuarded(server: WrappableServer): string[];
```

Behavior conventions: check every handler in all four tables, `fallback`, and the three registration methods (the replaced methods carry the `[GUARDED]` marker) one by one;
add unmarked entries to the list. This file **only reports; it does not fix or throw** (throwing is decided by `index.ts`).

### 4.5 `src/index.ts` — plugin entry and wiring

```ts
import type { Context } from "@deepseek-ai/cordis";
import type { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import z from "@deepseek-ai/schemastery";
import { noopGate, type Gate } from "./gate.js";
import { assertGuarded } from "./self-check.js";
import { wrapServer, type WrappableServer } from "./guard.js";
import { sessionDomainSpec, SessionStore } from "./session-store.js";

export const name = "dsh-auth";
export const inject = ["webServer"] as const;

export interface AuthConfig {
  mode: "token" | "password"; // M1 only enters the schema; the token gate takes effect in M2
  sessionTtl: number;          // seconds; default 604800 (7 days)
  cookieName: string;          // default "dsh_auth"
}

export const Config: z<AuthConfig> = z.object({
  mode: z.union([z.const("token"), z.const("password")]).default("token"),
  sessionTtl: z.natural().default(604800),
  cookieName: z.string().default("dsh_auth"),
});

export interface AuthService {
  sessions: SessionStore | undefined; // undefined when storageDomain is missing (D3)
  gate: Gate;                         // writable: M2 swaps the stream, tests inject a fake gate
}

declare module "@deepseek-ai/cordis" {
  interface Context { auth?: AuthService; }
}

export function apply(ctx: Context, config: AuthConfig): void { ... }
```

`apply` wiring skeleton (implement per this, don't change the order):

1. `const server = ctx.get("webServer") as unknown as WrappableServer | undefined;` if `undefined`, `return` (inject already guarantees existence; defensive short-circuit).
2. `const log = ctx.logger("dsh-auth");`
3. `const auth: AuthService = { sessions: undefined, gate: noopGate }; ctx.provide("auth", auth);`
4. Session layer (soft-connect storageDomain):
   `const storageDomain = ctx.get("storageDomain") as unknown as DomainFacility | undefined;`
   - Missing: `log.error("storage-domain is unavailable: session persistence is disabled (guards stay mounted)");`
   - Present: `ctx.effect(() => { let closed = false; const opening = storageDomain.open(sessionDomainSpec); const ready = opening.then((domain) => { if (closed) { void domain.close(); return; } auth.sessions = new SessionStore(domain.table("sessions")); log.info("session domain opened: dsh_auth_sessions"); }, (error: unknown) => { log.error(`session domain open failed: ${error instanceof Error ? error.message : String(error)}`); }); return async () => { closed = true; await ready.catch(() => undefined); const domain = await opening.catch(() => undefined); await domain?.close(); }; }, "dsh-auth: session domain");`
     (note: `ready` resolves to `void` after `.then` is attached; the disposer must take the domain from the **original** `opening` promise to close it, otherwise the domain leaks.)
5. Guard: `const unwrap = wrapServer(server, () => auth.gate, log); ctx.effect(() => unwrap, "dsh-auth: guard unwrap");`
   (the effect's reverse-registration unload guarantees: uninstall the guard first, then close the domain.)
6. Self-check: `const failures = assertGuarded(server); if (failures.length > 0) { for (const f of failures) log.error("unwrapped entry: " + f); throw new Error("dsh-auth: guard self-check failed: " + failures.join(", ")); }`

Other conventions: do not log/output any sensitive value in the config (M1's config has no sensitive values, but the logs only print event names and paths, never tokens). The exported `AuthService`/`AuthConfig` types reference only their own definitions and `SessionStore`/`Gate` (self-contained types), not leaking storage-domain/webserver package types into the public d.ts.

---

## 5. Test Matrix

All tests use Vitest with explicit imports (`import { describe, expect, it, beforeAll, afterAll } from "vitest"`),
environment node. The existing `src/index.test.ts` is **rewritten wholesale** into the cases below. The coverage red line of 80% (branches/functions/
lines/statements) applies as usual.

### 5.1 Unit Tests

**`src/gate.test.ts`** — `noopGate.decide` returns `"allow"` for arbitrary arguments (1 case).

**`src/guard.test.ts`** — define `makeFakeServer(): WrappableServer` inside this file (Map tables + register/registerUpgrade/registerFallback that count invocations, returning disposal disposers); fake `req/res/socket` are minimal objects
(`res: { headersSent, setHeader, writeHead, end }`, `socket: { write, destroy }` recording calls). Cases:

1. Existing-entry wrapping: the handlers of all four tables + fallback are all replaced (references unequal) and `isGuarded` is true; on allow the original handler is invoked with the original arguments.
2. Incremental wrapping: after wrap, a handler registered by `server.register(route)` carries the guard; on deny the original handler is not invoked and a 401 is received.
3. Idempotency: call `wrapServer` twice, the handler is wrapped only one layer (the second call returns the same unwrap); after unwrap, the four tables/methods/fallback are reference-equal to before wrapping.
4. Deny-HTTP: `GET` + `Accept: text/html` → `writeHead(302)` and `location === "/auth/login?next=%2Fsome%2Fpath"`, `cache-control: no-store`; non-navigation (`Accept: application/json` or `POST`) → `writeHead(401)`, body `unauthorized`.
5. Deny-upgrade: deny → `socket.write` receives content starting with `HTTP/1.1 401 Unauthorized`, `socket.destroy` is called, the original handler is not called; allow → the original handler receives `(req, socket, head)`.
6. Error propagation: when the original handler rejects, the guard does not catch it (`await expect(...).rejects.toThrow`).
7. Gate accessor: deny gate first → 401; swap the gate to allow → the 200 path (proves the swap of the gate at runtime takes effect).

**`src/session-store.test.ts`** — `class MemTable implements KvTable<string, Session>` inside the file (Map implementation). Cases:

1. `digestToken` known vector: `digestToken("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
2. `create`: token matches `/^[A-Za-z0-9_-]{43}$/`; the row has been `put`, key = digest, `createdAt/expiresAt` difference = ttlMs, `revoked === false`, `subject` passed through.
3. `getByToken`: valid token → returns the row; unknown token → `undefined`; expired (`expiresAt <= Date.now()`) → `undefined`; `revoked: true` → `undefined`.
4. `revokeByToken`: exists → `true` and the row is deleted; does not exist → `false`.
5. `pruneExpired`: mixed valid/expired rows, deletes only the expired, returns the exact count, valid rows preserved as-is.
6. `buildSetCookie` exact string: `buildSetCookie("dsh_auth", "tok", 604800) === "dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax"`.

**`src/self-check.test.ts`** — reuse guard.test.ts's fake (extract into a shared test helper or copy the implementation; **must not** create a src runtime helper only for tests). Cases:

1. Fully wrapped server → `[]`.
2. Some exact entry unwrapped → contains `"exact <path>"`; fallback unwrapped → `"fallback"`; method unreplaced → `"method register"`.

**`src/index.test.ts`** — fake ctx (`{ get, provide, logger, effect }` recording calls, effect stores the disposer). Cases:

1. Shape: `name === "dsh-auth"`; `inject` includes `"webServer"`.
2. No webServer: `apply` silently returns (does not throw, does not provide).
3. webServer present + no storageDomain: the guard takes effect (fake server is wrapped), `auth.sessions === undefined`, `log.error` is called once, does not throw.
4. webServer present + storageDomain present (fake `{ open }`, open returns a fake Domain with `table/close`, delayed resolution): after apply returns and microtasks flush, `ctx.get("auth").sessions` is a `SessionStore` instance.
5. Self-check failure propagation: the wrapped scenario is broken (e.g., the fake server's register method still lacks the marker after wrap — mutate it straight back to the original method) → apply throws `dsh-auth: guard self-check failed` and `log.error` includes the entry name.
6. Uninstall: invoke the effect disposers one by one (reverse order), the guard is restored (fake server table entries revert to the original handler references), `domain.close` is called.
7. Config defaults: `Config` validates `{}` → `{ mode: "token", sessionTtl: 604800, cookieName: "dsh_auth" }` (schemastery's `Config(...)` validation call; the test fails if it fails).

### 5.2 Integration Tests (real entry path — the foundation of the §7 regression discipline)

**`src/integration.guard.test.ts`** — real cordis + real WebServer + real HTTP:

```ts
import { Context } from "@deepseek-ai/cordis";
import WebServer from "@deepseek-ai/dsh-host-webserver";
import { apply, inject, name, Config } from "./index.js";
import type { Gate } from "./gate.js";
```

1. setup: `new Context()`; `const wsFiber = await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 })`;
   get `const server = ctx.get("webServer")` (assert it exists, narrow the type with `as unknown as`); register
   exact `/probe` (200 `"probe"`), prefix `/pfx` (200 `"pfx"`), fallback (200 `"spa"`);
   then `const authFiber = await ctx.plugin({ name, inject, apply, Config }, {})`;
   `const port = server.port`.
2. NoopGate allows: `fetch(http://127.0.0.1:${port}/probe)` → 200 `probe`; `/pfx/x` → 200 `pfx`; `/` → 200 `spa`.
3. Swap in a deny gate: `const denyGate: Gate = { decide: () => "deny" }; ctx.get("auth")!.gate = denyGate;`
   - `fetch("/probe", { headers: { accept: "text/html" } })` → 302, `location === "/auth/login?next=%2Fprobe"`;
   - `fetch("/probe", { headers: { accept: "application/json" } })` → 401, body `unauthorized`;
   - `fetch("/pfx/x")` → 401 (the prefix route is also guarded);
   - `fetch("/")` → 302 (the fallback is guarded).
4. WS deny: `node:http`'s `request({ port, host: "127.0.0.1", path: "/api/events.host", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==", "Sec-WebSocket-Version": "13" } })`:
   expect the `response` event, status 401, and the `upgrade` event is **not** emitted (the guard denies before ws negotiation).
5. Apply-order-independent: mount dsh-auth **then** `server.register({ kind: "exact", path: "/late", handler })` → immediately guarded (fetch → 401/302).
6. teardown: after `await authFiber.dispose(); await wsFiber.dispose();`, requests to the port are refused (can assert fetch rejects).

**`src/integration.session.test.ts`** — real storage stack + persistence across restarts:

```ts
import Storage from "@deepseek-ai/dsh-storage";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
```

1. `mkdtemp` creates a temp root; ctx1: in order `ctx.plugin(Storage)`, `ctx.plugin(storageJson, { root })`,
   `ctx.plugin(storageDomain, { backend: "json" })`, then mount this plugin (a webserver is optional too — `inject` only contains
   webServer, so ctx1 also mounts WebServer `{ host: "127.0.0.1", port: 0 }`), keep all Fibers.
2. `await` a small poll (≤5s, 50ms interval) until `ctx1.get("auth")!.sessions !== undefined`.
3. `const { token } = await store.create("token", 60_000)`; assert `getByToken(token)` returns a row; assert
   `<root>/dsh_auth_sessions.json` exists and its content contains the digest key (read the file, `JSON.parse`,
   assert `doc.tables.sessions[digest]` exists — file structure see §2.2).
4. Dispose all ctx1 Fibers in reverse order.
5. ctx2: same root, same stack, same wait for sessions ready; `getByToken(token)` returns the same `subject` and
   `expiresAt` (persistence across "restart" holds).
6. teardown: dispose + `rmSync(root, { recursive: true, force: true })`.

> If a test fails and the failure cause is some harness package behavior that does not match this file: **stop and report the discrepancy**, do not change the test to accommodate it.

---

## 6. Implementation Order (execute in order, keep `npm run verify` green at every step)

1. `package.json` dependency changes + `npm install --registry=https://registry.npmjs.org/`.
2. `src/gate.ts` → `src/gate.test.ts` (green first).
3. `src/guard.ts` → `src/guard.test.ts`.
4. `src/session-store.ts` → `src/session-store.test.ts`.
5. `src/self-check.ts` → `src/self-check.test.ts`.
6. `src/index.ts` (rewrite, replacing the existing skeleton) → `src/index.test.ts` (rewrite).
7. The two integration test files (write last: they depend on the stability of the previous five steps).
8. Update the `## Structure` tree in `docs/specs/development.md` to:
   ```
   src/
   ├── index.ts          # plugin entry: name / inject / Config / apply + auth service wiring
   ├── guard.ts          # webServer route/upgrade/fallback wrapping and deny pipeline
   ├── gate.ts           # Gate vocabulary + noopGate (M2 swaps in the real gate)
   ├── session-store.ts  # storage-domain session persistence
   ├── self-check.ts     # wrapping-coverage self-check (fail loud)
   ├── *.test.ts         # unit tests (explicit vitest imports)
   └── integration.*.test.ts  # real cordis/webserver/storage stack integration tests
   ```

---

## 7. Definition of Done (the task is complete only when all are satisfied)

1. `npm run verify` fully green (format:check + lint + type-check + test:coverage ≥80% + lock:check).
2. `npm run build` succeeds and `lib/` is regenerated; in `git status`, `src/` and `lib/` are in the same batch of changes (AGENTS.md commit discipline; **do not commit or push** without an instruction).
3. `npm run test -- src/integration.guard.test.ts src/integration.session.test.ts` run alone is also green.
4. The report lists: the changed-file inventory, the landing file of each frozen decision (D1–D16), the coverage numbers, and any inconsistency with this document (there should be none; if there is, it counts as incomplete).

---

## 8. Forbidden-Zone List (violating = redo)

- **Do not explore the harness internals**: trust only the facts in §2 of this document. Need a new fact → stop and report.
- **Do not invent APIs**: `webServer` has no middleware/event hooks; storage has only the interfaces listed in §2.2.
- **Do not swallow errors**: handler errors are thrown upward; on `open` failure, go through the `log.error` branch then the guard stays mounted (D3).
- **Do not leave side effects**: every registration (wrap, domain, provide, which are auto-unregistered by the fiber) must have a corresponding effect/disposer.
- **Do not write `console.*`** (lint reports error in src); logging uniformly via `ctx.logger("dsh-auth")`.
- **Do not put sensitive values into logs/test snapshots**: tokens appear only in memory and in responses; test assertions use known vectors, do not print real random tokens.
- **Do not change the gates**: must not lower the coverage threshold, must not add eslint-disable (except existing per-file allowances), must not change tsconfig/eslint/vitest config.
- **Do not change package.json fields beyond dependencies** (version is owned by release-please; don't touch scripts/files/exports).
- **Do not touch other milestones**: M2+ (token validation, login page, users.yaml, TOTP, CLI, `cordis.patch.yml`/profile-line documentation) is not in M1. When writing code that needs a reference, only write a TODO comment with a stable tag (e.g., `TODO(auth-token-gate):`).
- **Branch discipline**: keep all changes on `development`, do not touch `main`, do not commit/push without an instruction.

---

## 9. Explicitly Not Done (outside M1 scope, do not implement)

- Login page and `/auth/*` endpoints, Bearer/token validation, credentials references (M2).
- users.yaml / argon2id / rate limiting / `dsh-auth user` CLI (M3).
- TOTP two-stage login (M4).
- Deployment-side deliverables: `cordis.patch.yml` production patch, profile-line documentation, deployment acceptance checklist (done separately after M1 code delivery).
- The client half (logout button and other GUI components).
