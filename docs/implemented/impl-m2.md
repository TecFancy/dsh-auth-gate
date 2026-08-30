# dsh-auth M2 Implementation Spec (executable spec)

> Readers: coding agents implementing this (expected deepseek v4 flash, **new session**). This document is a **decision-complete spec**:
> every decision point is pre-closed; the implementer only translates, no design.
> Baseline: `docs/implemented/impl-m1.md` (M1 delivered: guard wrapper, self-check, session store, auth service skeleton — M2 layers on top of it).
> Design rationale: `docs/specs/dsh-auth-plan.md` §5/§6 phase 1/§8; engineering gates: `docs/specs/development.md`.
> **This file is the sole authoritative spec for M2**; where it conflicts with plan/M1, this file wins.
>
> Environment and verification workflow: see `docs/handoff/handoff-m2.md` (a new session must read: server access, sandbox network limits,
> M1 pitfall checklist). **Do not explore harness internals yourself** — if you need facts outside this file, stop and report.

---

## 1. M2 Goals

Replace M1's lazy gate (`noopGate`, which allows everything) with a **shared-token gate**:

- Unauthenticated requests are rejected by the guard (HTML navigation → 302 login page; API/WS → 401/reject handshake — the M1 pipeline is ready);
- `GET /auth/login` self-contained login page + `POST /auth/login` submits a token → constant-time validation → issues a persistent session cookie;
- `Authorization: Bearer <token>` passes the guard directly (curl/script-friendly);
- `POST /auth/logout` revokes the session; `GET /auth/status` reports authentication state; all other `/auth/*` paths fall through to a 404
  (do not fall back to the SPA fallback).

All of M1's guard/session/self-check functionality is reused, **its behavior unchanged**; this milestone only swaps the gate and adds endpoints.

---

## 2. Frozen Decision Table (M2 increments; M1's D1–D16 unchanged)

| #   | Decision           | Frozen value                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | gate swap          | `apply` replaces `noopGate` with a `TokenGate` instance; the `AuthService.gate` field stays writable (for test injection, M3 gate-swap compatibility)                                                                                                                                                                                                                                                                                |
| M2  | token source       | config `tokenRef: string` = credentials reference name (environment variable name), default `"DSH_AUTH_TOKEN"`; **re-resolve via `ctx.credentials.resolve(tokenRef)` on every decide** (credentials service per-operation semantics, changing credentials requires no restart); credentials service missing → **on first resolve** `log.error` + gate **always denies** (fail-closed; warning triggers lazily — see §3.1 mount race) |
| M3  | validation         | constant-time comparison: `crypto.timingSafeEqual(sha256(input), sha256(stored))` (hash both sides then compare, equal length always; `safeEqual(input, stored)` exported, testable)                                                                                                                                                                                                                                                 |
| M4  | public paths       | `TokenGate` always allows `/auth` and `/auth/*` (constant `AUTH_PATH_PREFIX = "/auth"` in `guard.ts`); the fallback prefix + three exact endpoints registered via the **wrapped** `register` (wrapped by the guard but allowed by the gate — consistent with plan §5 whitelist, self-check has no gaps, self-heals on restart; no separate whitelist config item)                                                                    |
| M5  | endpoint set       | `GET /auth/login` (self-contained HTML), `POST /auth/login` (urlencoded: `token` + `next`), `POST /auth/logout`, `GET /auth/status` (JSON `{ authenticated: boolean }`). Routing model per M15 (3 exact + 1 prefix fallback); `/auth/status` **only honors cookies** (Bearer does not participate — the stateless channel creates no session, it is not "session state")                                                             |
| M6  | session semantics  | login success → `SessionStore.create("token", ttl)` (subject always `"token"`, plan §5; **every login is a new session**, session-fixation defense naturally satisfied); cookie output via `buildSetCookie`                                                                                                                                                                                                                          |
| M7  | cookieSecure       | config `cookieSecure: boolean` default `true`; when `false` the cookie omits `; Secure` (http testing/dev). `buildSetCookie` gains an optional 4th param `secure = true` (**backward compatible** with the M1 signature and tests)                                                                                                                                                                                                   |
| M8  | next validation    | must start with a single `/`, must not start with `//`, must not contain `\`; otherwise fall back to `/` (anti-open-redirect)                                                                                                                                                                                                                                                                                                        |
| M9  | Bearer             | `Authorization: Bearer <token>` passes on successful constant-time validation, **creates no session**; effective for both HTTP and upgrade (browser WebSockets cannot set custom headers, cookie is the browser channel — note in docs)                                                                                                                                                                                              |
| M10 | body parsing       | only accepts `application/x-www-form-urlencoded` (check: take the token before the first `;`, `trim().toLowerCase()` then **exact equality** — do not use startsWith, it would wrongly accept `...x` suffixes); size cap 16 KiB (over-limit 413, see M19); `URLSearchParams` parsing; non-matching 415                                                                                                                               |
| M11 | mode semantics     | `"token"` (default) activates TokenGate; `"password"` in M2 `apply` throws directly (fail loud; M3 implements it)                                                                                                                                                                                                                                                                                                                    |
| M12 | dependencies       | **zero new**: `node:crypto`/`URLSearchParams` builtin; credentials service used via structural type `ctx.get("credentials") as unknown as CredentialRefResolver` (no import of package types → no added dependency)                                                                                                                                                                                                                  |
| M13 | rate limiting      | M2 **does not do it** (token 256-bit entropy is sufficient; M3 password flow adds IP+account rate limiting)                                                                                                                                                                                                                                                                                                                          |
| M14 | CSRF               | M2 does no login/logout CSRF token (login CSRF impact is negligible, `SameSite=Lax` covers most; note in docs, M3 evaluates)                                                                                                                                                                                                                                                                                                         |
| M15 | routing model      | webserver has **no method routing** (the `exact` table keys only by pathname, duplicate paths throw — tested) → **3 exact routes** (`/auth/login`, `/auth/logout`, `/auth/status`) + **1 prefix fallback** (`/auth` → 404, to prevent unregistered `/auth/*` falling to the SPA fallback, M20); each exact handler dispatches internally by `req.method`, non-whitelisted method → `405` + `allow` header + `text/plain`             |
| M16 | session accessor   | `sessions` is always injected as an accessor `() => SessionStore                                                                                                                                                                                                                                                                                                                                                                     | undefined`(TokenGate and AuthEndpointsDeps are **isomorphic**); the`auth`object in`apply`is built **in one step**:`gate: new TokenGate({ ..., sessions: () => auth.sessions })`(closure self-reference, no await inside apply, no bare window);`noopGate` import removed (`gate.ts` export kept, for tests) |
| M17 | constant-time      | `timingSafeEqual` **only accepts Buffer/TypedArray** (hex string throws TypeError directly — verified locally) → `safeEqual` uses `createHash("sha256").update(x).digest()` (Buffer, both sides always 32 bytes), **do not** use `digest("hex")`                                                                                                                                                                                     |
| M18 | test credentials   | integration tests use a **structural fake provider** (`ctx.provide("credentials", { resolve })`, mounted before this plugin); the real `LocalCredentialProvider` is covered only in server smoke tests (DoD 4). **Zero new dependencies (including devDependencies)** — `dsh-credentials-local` and its 5 peer packages do not go into package.json                                                                                  |
| M19 | 413 handling       | over-limit: stop accumulating, `throw { status: 413 }`; endpoint writes `connection: close` + `413` + `res.end()`, **does not call `req.destroy()`** (verified: destroy kills keep-alive, subsequent requests socket hang up)                                                                                                                                                                                                        |
| M20 | whitelist fallback | the prefix `/auth` fallback route is registered via the **wrapped** register, handler always 404 (self-check counts coverage); `validateNext` also rejects `"/auth"` and `/auth/*` (fall back `/`) — prevent 302 loop after login; `GET /auth/login` always renders the login page (no session check, no redirect)                                                                                                                   |
| M21 | endpoint logging   | frozen log events: login failure `info` ("login rejected"), login success `info` ("session issued"), 503 `error`, logout `info` ("logout"); **any log never contains the token value/session token** (consumed by `AuthEndpointsDeps.logger`)                                                                                                                                                                                        |
| M22 | logout semantics   | `next` is taken **only from the query** (else `/`); **does not parse body, requires no content-type** (bare `curl -X POST` works); missing cookie still 302 + clears cookie (idempotent)                                                                                                                                                                                                                                             |

---

## 3. Authoritative Contracts (M2 additions; the rest per impl-m1.md §2)

### 3.1 credentials service (`@deepseek-ai/dsh-credentials@0.1.0-rc.6` + `dsh-credentials-local`)

- **Web composition includes it by default**: the `credentials` line of the `dsh-base` bundle = `@deepseek-ai/dsh-credentials-local` (reads
  `$DSH_HOME/.credentials.yaml`, env layer takes precedence over file layer; **re-read on every resolve**, changing the file requires no restart).
- **Mount race (verified)**: the harness **mounts lines in parallel** — the credentials line (dsh-base) may become ready only **after** this plugin (user layer)
  applies (server smoke tested: at apply time `ctx.get("credentials") === undefined`, visible a few seconds
  later). Therefore the resolver **lazily `ctx.get("credentials")` on every resolve** (§4.6 item 3); the missing warning is
  also triggered on first resolve — which is both M2's per-operation semantics and a natural avoidance of the race (M2 row frozen value already amended in sync).
- Service surface: `ctx.credentials.resolve(ref): Promise<{ value: string; source: string } | undefined>`
  (ref is a string in environment-variable name form; not configured → `undefined`). We **do not import package types**, we use a structural type:
  ```ts
  interface CredentialRefResolver {
    resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
  }
  ```
- This plugin is **read-only** for credentials; it does not set/unset. The `CredentialRefResolver` structural interface is declared in `src/index.ts`
  (private, not exported).
- `dsh-credentials-local` is a plugin-like package (named export `LocalCredentialProvider`, Config contains `path?`):
  the server smoke test directly reuses the web composition's built-in `credentials` line and writes `$DSH_HOME/.credentials.yaml`.
  **The file permissions must be 0600**: `assertOwnerOnly` throws at startup if the file exists and is group/other-readable
  (`chmod 600`). **Integration tests do not mount a real provider** (M18: zero new dependencies) — use a structural fake provider
  `ctx.provide("credentials", { resolve })` mounted before this plugin; the real provider's env-layer-precedence semantics
  (`process.env[tokenRef]` can be supplied directly for smoke tests) are verified server-side.
- Service missing (at first resolve `ctx.get("credentials") === undefined`, lazy): `log.error("credentials
service is unavailable: gate denies everything (fail-closed)")` once; `TokenGate`'s resolver
  returns `undefined` → all credential validations fail → always deny (but the whitelist `/auth/*` still passes, login page visible, login
  unavailable — diagnosable).

### 3.2 node builtins (static shape of this package, all available)

- `node:crypto`: `randomBytes` (already used in M1), `createHash("sha256")`, `timingSafeEqual`.
- `URLSearchParams` (global, Node ≥ 22): parses the urlencoded body and builds the query.
- `req` stream reading: `for await (const chunk of req)` accumulates, breaks on over-limit (413, M19).
- `timingSafeEqual(a, b)` accepts only Buffer/TypedArray/DataView — a hex string throws TypeError directly (verified
  locally); inside `safeEqual` always `digest()` (Buffer, M17), do not use `digest("hex")`.

---

## 4. File Blueprints

Each file ≤250 lines, function ≤80 lines, complexity ≤15 (ESLint error). M1 files change in only three places: `session-store.ts`
(`buildSetCookie` gains a param), `guard.ts` (only adds the `AUTH_PATH_PREFIX` constant, behavior unchanged), `src/index.ts`
(assembly). **gate/self-check unchanged** (`noopGate` in `gate.ts` keeps its export — tests still use it; `GuardKind`/`Gate` unchanged).

### 4.1 `src/cookie.ts` — Request Cookie header parsing

```ts
/** Parse a named value from a Cookie header; the name is matched, first occurrence wins. No header/no such name → undefined. */
export function parseCookieHeader(header: string | undefined, name: string): string | undefined;
```

Behavior contract: `split(";")` → each segment `trim()` → split on first `"="` → exact name match. Value is not unquoted (token has no quotes).
Empty value returns `""` (caller decides). Pure function, exported for testing.

### 4.2 `src/token-gate.ts` — Shared token gate

```ts
import type { IncomingMessage } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Gate, GuardKind } from "./gate.js";
import type { SessionStore } from "./session-store.js";
import { AUTH_PATH_PREFIX } from "./guard.js";
import { parseCookieHeader } from "./cookie.js";

/**
 * Constant-time comparison: timingSafeEqual on the sha256 Buffer digest of both sides (M17: timingSafeEqual only accepts
 * Buffer/TypedArray — a hex string throws TypeError directly; Buffer digests on both sides are always 32 bytes, no length side channel).
 */
export function safeEqual(input: string, stored: string): boolean;

export interface TokenGateOptions {
  /** Credential resolver called on every decide (index.ts injects the credentials.resolve closure). */
  resolveToken: () => Promise<string | undefined>;
  /** Session accessor (M16): fetched fresh on every decide — the domain is async-ready; undefined = cookie channel unavailable. */
  sessions: () => SessionStore | undefined;
  cookieName: string;
}

export class TokenGate implements Gate {
  constructor(options: TokenGateOptions);
  decide(req: IncomingMessage, kind: GuardKind, pathname: string): Promise<"allow" | "deny">;
}
```

`decide` order (implement in this order):

1. `pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")` → `"allow"`.
2. cookie: `parseCookieHeader(req.headers.cookie, this.cookieName)` → non-empty
   (`!== undefined && !== ""`) and `this.sessions()?.getByToken(token) !== undefined` → `"allow"`
   (if `sessions()` returns undefined, skip this channel).
3. Bearer: `req.headers.authorization` matches `/^Bearer\s+(.+)$/i` → `await this.resolveToken()` →
   exists and `safeEqual(bearer, stored)` → `"allow"`.
4. Otherwise `"deny"`.

Error semantics (fail-closed): `resolveToken` throws → this gate catches and returns `"deny"` (does not rethrow, does not log;
index.ts's resolver already catches and logs itself — the production path will not throw to here, this catch is a defensive second line).

### 4.3 `src/form-body.ts` — urlencoded form body reader

```ts
import type { IncomingMessage } from "node:http";

export const FORM_BODY_LIMIT = 16 * 1024;

/** Read and parse a urlencoded request body. Throws an error carrying a status on 415 (content-type mismatch) / 413 (over limit). */
export async function parseFormBody(req: IncomingMessage): Promise<URLSearchParams>;
```

Behavior contract: the `content-type` check takes the token before the first `;`, `trim().toLowerCase()` then **exact equality**
with `application/x-www-form-urlencoded` (M10: do not use startsWith, it would wrongly accept `...x` suffixes); on mismatch
`throw Object.assign(new Error("unsupported media type"), { status: 415 })`;
`for await` accumulates chunks; when the total exceeds `FORM_BODY_LIMIT`, stop accumulating and
`throw ... { status: 413 }` (**do not call `req.destroy()`**, M19); parse via `new URLSearchParams(decoded)`.
The error object carries a `status` field — auth-endpoints writes the response from it; **stream exceptions without a `status` (abort, etc.) are not caught, but
rethrown** (webserver uniformly warns + 400, consistent with guard discipline).

### 4.4 `src/login-page.ts` — Self-contained login page

```ts
/** Render a self-contained login page (inline styles, zero third-party resources). next/error are all HTML-escaped. */
export function loginPageHtml(next: string, error?: string): string;
```

Behavior contract: `<!doctype html>` + `lang="en"`; inline `<style>` (basic centered card style, light is enough, no external fonts);
`<form method="post" action="/auth/login">`; hidden `next` (escaped); `<input type="password" name="token"
autocomplete="current-password" required autofocus>`; `<button type="submit">Unlock</button>`;
render `<p class="error">` when `error` is non-empty (escaped). The HTML-escape helper is private to this file
(five characters `& < > " '`); only `loginPageHtml` is exported.

### 4.5 `src/auth-endpoints.ts` — /auth fallback + three endpoints

```ts
import { AUTH_PATH_PREFIX, type HttpHandler } from "./guard.js";
import { buildSetCookie, type SessionStore } from "./session-store.js";
import { parseFormBody } from "./form-body.js";
import { loginPageHtml } from "./login-page.js";
import { parseCookieHeader } from "./cookie.js";

export interface AuthEndpointsDeps {
  /** Route registration (index.ts passes the wrapped server.register; wrapped by the guard but allowed by the gate whitelist). */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
  /** Session accessor (M16): the domain is async-ready, fetched fresh inside the endpoints. */
  sessions: () => SessionStore | undefined;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtl: number; // seconds
  validateToken: (token: string) => Promise<boolean>; // constant-time validation (index.ts injects the safeEqual closure)
  logger: { error(message: unknown): void; info(message: unknown): void };
}

/** Register the prefix `/auth` fallback + three exact endpoints; returns a combined disposer (collects each register's disposer internally). */
export function registerAuthEndpoints(deps: AuthEndpointsDeps): () => void;
```

Routing model (M15: webserver has no method routing — the `exact` table keys only by pathname, duplicate paths throw, so
GET/POST `/auth/login` **cannot** register two exact routes):

- **prefix `AUTH_PATH_PREFIX` (= `"/auth"`, fallback, M20)**: always `404` + `content-type: text/plain` +
  no-store — unregistered `/auth/*` must not fall to the SPA fallback (exact takes precedence over prefix, does not shadow the three endpoints below).
  The route path uses the `AUTH_PATH_PREFIX` constant (the sole consumer of this import in this section).
- **exact `/auth/login`**: handler dispatches by `req.method`:
  - `GET`: `next = validateNext(query.get("next") ?? "/")` → `200` +
    `content-type: text/html; charset=utf-8` + `cache-control: no-store` + `loginPageHtml(next)`.
    **Always renders the login page** (no session check, no redirect — M20).
  - `POST`: `parseFormBody(req)` — error with a `status` → the corresponding status + `text/plain` message
    (for 413 first additionally `res.setHeader("connection", "close")`, M19); **exceptions without a `status` are rethrown**
    (webserver uniformly warns + 400); `token = params.get("token") ?? ""`;
    `next = validateNext(params.get("next") ?? "/")`;
    `await deps.validateToken(token)` fails → `401` + `text/plain` `"invalid token"` +
    `cache-control: no-store` + `logger.info("login rejected")`;
    success → `const store = deps.sessions(); store === undefined` → `503` + `text/plain`
    `"session store unavailable"` + no-store + `logger.error("login failed: session store unavailable")`
    (fail-closed, does not silently allow); otherwise
    `const { token: sessionToken } = await store.create("token", deps.sessionTtl * 1000)`;
    `res.setHeader("set-cookie", buildSetCookie(deps.cookieName, sessionToken, deps.sessionTtl, deps.cookieSecure))`;
    `res.writeHead(302, { location: next }); res.end();` + `logger.info("session issued")`
    (no-store throughout).
  - Any other method → `405` + `allow: GET, POST` + `text/plain` (no-store).
- **exact `/auth/logout`**: `POST` only (any other → `405` + `allow: POST`):
  `next = validateNext(query.get("next") ?? "/")` (M22: `next` is taken only from the query;
  **does not parse body, requires no content-type** — bare `curl -X POST` works);
  `const store = deps.sessions(); const token = parseCookieHeader(req.headers.cookie, deps.cookieName);`
  `token` non-empty (`!== undefined && !== ""`) and `store !== undefined` →
  `await store.revokeByToken(token)` (no session/no cookie silently succeeds);
  `res.setHeader("set-cookie", buildSetCookie(deps.cookieName, "", 0, deps.cookieSecure))` (Max-Age=0 clears);
  `res.writeHead(302, { location: next }); res.end();` + `logger.info("logout")`; no-store.
- **exact `/auth/status`**: `GET` only (any other → `405` + `allow: GET`):
  only honours cookies (M5: Bearer does not participate — the stateless channel creates no session, it is not "session state"):
  `const store = deps.sessions(); const token = parseCookieHeader(req.headers.cookie, deps.cookieName);`
  `const authenticated = store !== undefined && token !== undefined && token !== "" &&
store.getByToken(token) !== undefined;`
  → `200` + `application/json` + `JSON.stringify({ authenticated })` + no-store.

`validateNext` is a private export of this file: `next` starts with a single `/`
(`next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")`) **and**
`next !== "/auth"`, `!next.startsWith("/auth/")` (M20: reject /auth* to prevent a 302 loop after login) → return as-is; otherwise `"/"`.
The `req.url` query is parsed with `new URL(req.url ?? "/", "http://x")` (consistent with the guard).
All endpoint responses carry `cache-control: no-store`; log events per M21 (any log **never** contains the token value/session token).

### 4.6 `src/index.ts` — assembly changes (remaining M1 logic unchanged)

1. `Config` gains two fields (defaults go into schemastery):
   ```ts
   tokenRef: z.string().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/).default("DSH_AUTH_TOKEN"),
   cookieSecure: z.boolean().default(true),
   ```
   (the `pattern` matches dsh-credentials' credential-ref pattern and also blocks empty strings.)
   `AuthConfig` interface updated in sync (`mode`/`sessionTtl`/`cookieName` unchanged).
2. At the start of `apply`: `if (config.mode === "password") throw new Error("dsh-auth: password flow requires M3 (not implemented in M2)");` (at `void config`, change to actually using config).
3. credentials resolver (replaces M1's `void config`) — **fetch the service lazily** (§3.1 mount race: the credentials line
   may become ready only after this line applies; fetch `ctx.get("credentials")` fresh on every resolve):
   ```ts
   /** Structural mirror of the credentials service (§3.1); private to this file, not exported. */
   interface CredentialRefResolver {
     resolve(ref: string): Promise<{ value: string; source: string } | undefined>;
   }
   /** Returns resolveToken; the missing-service warning fires only once on first resolve (fail-closed, diagnosable). */
   function makeTokenResolver(
     ctx: Context,
     config: AuthConfig,
     log: { error(message: unknown): void },
   ): () => Promise<string | undefined> {
     let warnedMissing = false;
     return async () => {
       const credentials = ctx.get("credentials") as unknown as CredentialRefResolver | undefined;
       if (credentials === undefined) {
         if (!warnedMissing) {
           warnedMissing = true;
           log.error("credentials service is unavailable: gate denies everything (fail-closed)");
         }
         return undefined;
       }
       try {
         const resolved = await credentials.resolve(config.tokenRef);
         return resolved?.value;
       } catch (error) {
         log.error(
           `token resolution failed: ${error instanceof Error ? error.message : String(error)}`,
         );
         return undefined; // fail-closed: resolution failure = no credentials
       }
     };
   }
   ```
4. Gate assembly (M16): replace M1 step 3's `{ sessions: undefined, gate: noopGate }`; the `auth` object is built **in one step**:
   ```ts
   const auth: AuthService = {
     sessions: undefined,
     gate: new TokenGate({
       resolveToken,
       sessions: () => auth.sessions, // accessor closure self-references auth (assigned by the open callback once the domain is async-ready)
       cookieName: config.cookieName,
     }),
   };
   ctx.provide("auth", auth);
   ```
   Order: log → credentials/resolveToken → auth → provide; no await inside apply, no bare window. The closure self-reference is valid
   (only evaluated at `decide` time). Remove the `noopGate` import (`gate.ts` export kept, for tests).
5. Endpoint registration (between wrapServer and self-check; `safeEqual` imported from `./token-gate.js`):
   ```ts
   ctx.effect(
     () =>
       registerAuthEndpoints({
         register: (route) => server.register(route), // wrapped register (incremental insurance path)
         sessions: () => auth.sessions,
         cookieName: config.cookieName,
         cookieSecure: config.cookieSecure,
         sessionTtl: config.sessionTtl,
         validateToken: async (token) => {
           const stored = await resolveToken();
           return stored !== undefined && safeEqual(token, stored);
         },
         logger: log,
       }),
     "dsh-auth: auth endpoints",
   );
   ```
   The self-check runs **after** endpoint registration (the endpoints also count toward coverage).
6. Remove the `noopGate` import (the gate.ts export is kept, for tests).

### 4.7 `src/session-store.ts` — one backward-compatible change

`buildSetCookie` gains a 4th param: `secure: boolean = true`; when `false` the output omits `; Secure`:
`${cookieName}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; ${secure ? "Secure; " : ""}SameSite=Lax`
(note the spacing: `Path=/; HttpOnly; Secure; SameSite=Lax` and `Path=/; HttpOnly; SameSite=Lax` must both be exact).

---

## 5. Test Matrix

All M1 tests **kept**; `src/index.test.ts` adapted per §4.6 (gate is a TokenGate instance, mode=password throws,
credentials missing → resolver always undefined + error log, both storageDomain and credentials missing → 2
error logs, Config defaults add `tokenRef`/`cookieSecure`, fake ctx adds a `credentials` branch). Additions:

**`src/cookie.test.ts`** — no header → undefined; single cookie; multiple cookies, first occurrence of the matching name; value containing `=`; tolerance for spaces/quotes; name not present → undefined.

**`src/token-gate.test.ts`** — fake req (headers) + fake sessions (reuse the MemTable approach) + fake resolver:

1. Whitelist: `/auth`, `/auth/login`, `/auth/whatever` → allow (with no credentials at all).
2. cookie channel: `sessions()` returns a valid session → allow; unknown/expired/revoked → continue to bearer or deny.
3. bearer channel: `Authorization: Bearer <correct token>` → allow; wrong token → deny; lowercase `bearer` prefix accepted; with `sessions: () => undefined` the cookie channel is skipped but bearer still works.
4. No credentials at all → deny.
5. fail-closed: resolver throws → deny (does not rethrow).
6. `safeEqual` known vectors: `safeEqual("abc", "abc") === true`, `safeEqual("abc", "abd") === false`, empty string vs non-empty → false.

**`src/form-body.test.ts`** — normal parse (`token=x&next=%2F`); no content-type → 415; non-urlencoded → 415;
`application/x-www-form-urlencoded; charset=UTF-8` → normal (parameters after the semicolon ignored);
`application/x-www-form-urlencodedx` → 415 (exact-equality check, M10); over 16 KiB → 413 and **does not call
`req.destroy()`** (fake req records destroy call count, M19).

**`src/auth-endpoints.test.ts`** (split into three files to honor the per-file line cap: `auth-endpoints.test.ts` covers registration shape/
GET login/logout/status, `auth-endpoints.login.test.ts` covers POST login, `auth-endpoints.methods.test.ts`
covers 405/fallback/loginPageHtml — test matrix described together) — fake register (records routes + returns disposers) + fake
sessions (accessor form) + fake validateToken:

1. Registration shape: 4 routes — prefix `/auth`, exact `/auth/login`, `/auth/logout`, `/auth/status` (M15).
2. GET login: 200 + HTML contains `<form`, hidden next is escaped (`next="/x?a=1&b=2"` → `&amp;` in HTML); the authenticated state (`sessions()` has a valid session) also always 200 renders (no redirect, M20).
3. POST login success: validateToken true → 302 location=next + exact set-cookie string (secure=true and false) + `sessions().create` called (subject "token", ttl = sessionTtl*1000) + `logger.info("session issued")`.
4. POST login failure: validateToken false → 401 "invalid token" + `logger.info("login rejected")`; no session created.
5. POST login next validation: `next="//evil.com"` → 302 location "/"; `next="/ok/path"` → 302 "/ok/path"; **`next="/auth/login"` and `/auth/x` → "/" (M20)**.
6. POST login `sessions()` undefined → 503 + `text/plain` + `logger.error`.
7. POST logout: revoke called + set-cookie contains `Max-Age=0` + 302; next from the query (`?next=/x` → location `/x`); no body/no content-type works; missing cookie still 302 (idempotent, M22).
8. GET status: valid cookie → `{"authenticated":true}`; none → false; an `Authorization: Bearer` header does not affect the result (only honors cookie, M5).
9. Method dispatch: `DELETE /auth/login` → 405 + `allow: GET, POST`; `GET /auth/logout` → 405; `POST /auth/status` → 405.
10. prefix `/auth` fallback: `/auth/whatever` → 404 + no-store (M20).
11. 413: body over limit → 413 + `connection: close` header + not calling `req.destroy` (M19).

**`src/integration.auth.test.ts`** (real entry path) — real cordis + **real storage stack**
(Storage → storage-json → storage-domain, mount order same as M1 `integration.session.test.ts`; otherwise
`sessions` is always undefined → login always 503) + real WebServer + **structural fake
credentials provider** (M18: `ctx.provide("credentials", { resolve: async (ref) => ref === "DSH_AUTH_TOKEN" ? { value: TEST_TOKEN, source: "test" } : undefined })`,
**mounted before this plugin**; `TEST_TOKEN` randomly generated, never enters snapshots) + this plugin (config `{ cookieSecure: false }`, http no TLS):

1. Full flow: `GET /auth/login` → 200; `POST /auth/login` wrong token → 401; correct token →
   302 + `set-cookie` header + `location`; with cookie `GET /__probe` (an exact route registered after auth) → 200;
   without cookie `GET /__probe` → 302 (HTML accept) / 401 (JSON accept); `Authorization: Bearer correct` → 200;
   Bearer wrong → 401; `POST /auth/logout?next=/` (with cookie, no body) → 302 + Max-Age=0; the same cookie accessing `/__probe` again → 401.
2. Whitelist fallback: `GET /auth/whatever` → 404 (not SPA fallback); `DELETE /auth/login` → 405.
3. credentials missing (no provider mounted) → login 401 (resolver undefined) + startup log error.
4. WS channel: upgrade with a session cookie → 101 (upgrade event); upgrade with `Authorization: Bearer <correct>` → 101; no credentials upgrade → 401 reject handshake (reuse M1 `requestUpgradeStatus` pattern, add cookie/authorization header variants).
5. Session persistence already covered in M1 `integration.session.test.ts` (reused).

---

## 6. Implementation Order (keep `npm run verify` green at every step)

1. `session-store.ts` — `buildSetCookie` gains the param + `session-store.test.ts` adds cases: `secure=false` exact string
   `dsh_auth=tok; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax`, default 4th param → the original exact string unchanged (backward compatible).
2. `src/cookie.ts` + tests.
3. `src/token-gate.ts` + tests.
4. `src/form-body.ts` + tests.
5. `src/login-page.ts` (pure rendering, covered by the auth-endpoints tests; may be written before tests).
6. `src/auth-endpoints.ts` + tests.
7. `src/index.ts` assembly + `src/index.test.ts` adaptation (mode=password throws, credentials missing fail-closed, gate is a TokenGate instance).
8. `src/integration.auth.test.ts`.
9. `docs/specs/development.md` Structure tree updated to:
   ```
   src/
   ├── index.ts           # plugin entry + auth service wiring + credentials resolver (M2 changed assembly)
   ├── guard.ts           # guard wrapping/reject pipeline + AUTH_PATH_PREFIX (M2 added constant)
   ├── gate.ts            # Gate vocabulary + noopGate (M2 swapped real gate)
   ├── token-gate.ts      # TokenGate: whitelist/cookie/Bearer + safeEqual (M2 added)
   ├── cookie.ts          # Cookie header parsing (M2 added)
   ├── form-body.ts       # urlencoded body reading (M2 added)
   ├── login-page.ts      # self-contained login page (M2 added)
   ├── auth-endpoints.ts  # /auth fallback prefix + three exact endpoints (M2 added)
   ├── session-store.ts   # storage-domain session persistence (buildSetCookie param added)
   ├── self-check.ts      # wrapped-coverage self-check (fail loud)
   ├── *.test.ts          # unit tests (explicit vitest imports)
   └── integration.*.test.ts  # real cordis/webserver/storage stack integration tests
   ```
   `docs/handoff/handoff-m2.md` status snapshot (§2) and §5.4 smoke sequence updated in sync.

---

## 7. Definition of Done

1. `npm run verify` all green (format/lint/type-check/coverage ≥80%/lock:check).
2. `npm run build` + `lib/` in the same change as `src/`; `git diff --exit-code -- lib` passes.
3. `npm run test -- src/integration.auth.test.ts src/integration.guard.test.ts src/integration.session.test.ts` runs green standalone.
4. **Server end-to-end smoke** (handoff doc §5 workflow, real LocalCredentialProvider): overlay adds
   `config: { cookieSecure: false }` + `$DSH_HOME/.credentials.yaml` writes `DSH_AUTH_TOKEN: <test value>`
   (`chmod 600`) → restart instance → curl verification: unauthenticated `/__auth_probe` → 302/401; POST login → Set-Cookie;
   with cookie → 200; Bearer → 200; `GET /auth/whatever` → 404 (fallback); WS upgrade with cookie → 101 /
   no credentials → 401.
5. Report: changed files, M1–M22 landing points, coverage numbers, deviation from this document (should be zero).

---

## 8. Forbidden List

- **Do not explore harness internals** (same as M1); the credentials service is only accessed via §3.1's structural type.
- **Zero new dependencies** (M18): neither runtime nor devDependencies change — `node:crypto`/`URLSearchParams` suffice;
  body parsing/HTML rendering/cookie parsing are all handwritten; integration tests use a structural fake credentials provider, **do not introduce**
  `dsh-credentials-local`.
- **Do not put credentials into logs/snapshots**: token values, session tokens never enter logs/test snapshots; `resolveToken` failure logs only the error message.
- **Do not swallow auth failures**: login failure must be 401 (not silent allow); credentials missing must deny (fail-closed).
- **Do not touch M1 guard behavior**: `guard.ts` only adds the `AUTH_PATH_PREFIX` constant (behavior unchanged); `gate.ts`/`self-check.ts`
  unchanged (`noopGate` keeps its export).
- **Do not change gates/tsconfig/eslint/vitest config**; no package.json changes beyond dependencies.
- **Branch discipline**: `development`; no commit/push without instruction.
- M3/M4 (users.yaml, argon2id, rate limiting, TOTP, `dsh-auth user` CLI) **not done** — when needed, only write `TODO(auth-m3):` comments.

---

## 9. Explicitly Not Done (Out of M2 Scope)

- users.yaml / multiple credentials / password login / argon2id / login rate limiting (M3).
- TOTP two-step login (M4).
- Login page beautification / internationalization / client-side logout button (GUI components).
- CSRF token (noted in M14, M3 evaluates).
- Deployment-side deliverables (official `cordis.patch.yml` production patch, deployment acceptance checklist) — done separately after M2 code verification.
