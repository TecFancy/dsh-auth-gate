# dsh-auth M2 handoff document (session handoff)

> Reader: the coding agent executing `docs/implemented/impl-m2.md` in a **new session**. This document carries the
> environment facts and process knowledge unique to this session — content that is not in the repo, would
> be costly to re-derive, or would trip you up.
> **Reading order: `AGENTS.md` → `docs/implemented/impl-m2.md` → this document**.

---

## 1. Status in one sentence

M1 (guard + persistent session + self-check) is delivered and **verified end-to-end on a real Ubuntu
server** (all four entry types guarded, 401/302 behavior correct); M2 (shared-token gate + login page +
Bearer) spec is frozen, awaiting implementation by the new session.

## 2. Repo and remote status snapshot (2026-08-14 evening)

- Branch: `development` (sole development branch; `main` only accepts merges; **never commit directly to
  main**).
- Remote `origin/development` is synced to `4b5f712` (all M1 commits pushed, CI **all green** for the
  latest commit); no open PRs.
- Local `development` includes the finalized M2 spec (`c184dbc` + `bbe39bd`) and the **M2 implementation
  commits** (unpushed); the working-tree state is per `git status`. Commit history: `02c6f73` (spec+skills
  baseline) → `eedfda9` (deps) → `168b41e` (M1 implementation) → `4b5f712` (spec fixes) → `c184dbc`/
  `bbe39bd` (M2 spec finalization) → M2 implementation commits.
- **Commit discipline** after M2 implementation: do not commit/push without user instruction; use
  Conventional Commits; commit `lib/` and `src/` in the same batch (CI has a parity gate).

## 3. Environment facts (required reading for the new session)

### 3.1 Sandbox network limits (critical!)

- **Local loopback is unreachable**: accessing `127.0.0.1:*` from the execution environment via
  `node fetch`/`curl --noproxy` times out; through the environment proxy (`http_proxy=127.0.0.1:7890`,
  Clash) it returns 502. **Do not start an instance locally and try to verify with curl**.
- Available channel: **SSH to the Ubuntu server** (`ssh ubuntu`, alias points to 49.232.250.16,
  passwordless) — loopback on the server is fine; all HTTP verification happens on the server side.
- `gh` CLI is available (GitHub auth works).

### 3.2 Ubuntu server (verification environment)

- `ssh ubuntu`: Linux VM, Node v24.19.0 (native TS strip support), npm 11.17.0.
- **dsh is installed globally**: `~/.npm-global/bin/dsh` (user-level prefix, version 0.1.0-rc.6, matching
  the deployment). Note it is not on PATH; use the full path or `export PATH="$HOME/.npm-global/bin:$PATH"`.
- **Smoke instance**: `~/dsh-smoke/` (standalone DSH_HOME) + `/tmp/dsh-auth-test/` (rsynced dsh-auth
  working tree + `probe.mjs` probe).
  - Start: `cd ~/dsh-smoke && DSH_HOME=~/dsh-smoke ~/.npm-global/bin/dsh --profile web --port 3081`
    (background: `nohup ... > ~/dsh-smoke/boot.log 2>&1 < /dev/null &`, wait ~25s).
  - Stop: `ssh ubuntu 'pkill -f "dsh --profile web --port 3081"'`.
  - The instance may have been stopped by the previous session — **check before each use**
    (`pgrep -f` / curl).
  - This instance is **unauthenticated** (the M1 gate is lazy) and public — only test data goes in.
- Overlay mechanism: `~/dsh-smoke/cordis.patch.yml` (the $DSH_HOME layer) → `- insert: { id, name }`
  lines. M1 smoke insert two lines: `dsh-auth` (name = `/tmp/dsh-auth-test/lib/index.js`) +
  `dsh-auth-smoke-probe` (probe: registers a `/__auth_probe` route + swaps `ctx.auth.gate` for a
  "reject only this path" gate, to verify the guard wrapping and rejection chain). M2 smoke edits this file
  (see §5).
- Server-side curl sequence (used for M1, extended the same way for M2):
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/__auth_probe -H "Accept: application/json"   # 401
  curl -s -i http://127.0.0.1:3081/__auth_probe -H "Accept: text/html" | head -3                              # 302 + location
  curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3081/                                            # 200
  ```
  Startup evidence is in `boot.log`: the `[smoke-probe-late]` line lists the guard status of the four entry
  types (G=guarded).

### 3.3 Local machine (source-repo machine)

- dsh install: `/Users/randal/.volta/tools/image/node/24.13.1/lib/node_modules/@deepseek-ai/dsh/`;
  package source/types are in `node_modules/@deepseek-ai/*` (0.1.0-rc.6) — all authoritative facts of M1
  spec §2 come from here, **the spec already covers them, do not re-explore**.
- npm registry: local `NPM_CONFIG_REGISTRY` points at an internal mirror — **installation must explicitly
  use `--registry=https://registry.npmjs.org/`** (AGENTS.md rule, `lock:check` verifies it).
- Source repo: `/Users/randal/source/dsh-auth/` (requires Node ≥ 22.19; local is 24.x).

### 3.4 Dynamic-plugin environment limits (why M2 verification does not go through create mode)

Measured this session: in dynamic plugins (cordis_define/cordis_run), **function-type property reads on a
service instance are wrapped** (each read returns a new bound copy) → `fallback` assignment does not take
effect, function identity markers cannot be read back → full guard (fallback + method replacement +
self-check) **cannot run in the dynamic-plugin form**; and a failed run does not roll back table wrapping.
**All M2 verification goes through local integration tests + server end-to-end; do not use dynamic
plugins.**

## 4. M1 implementation gotcha checklist (the new session should avoid these directly)

1. **cordis `ctx.effect` callbacks run immediately**: the effect callback executes synchronously when
   registered and returns a disposer — when writing the fake-ctx tests you must invoke the callback rather
   than just storing the array (M1 had 4 fake test failures because of this).
2. **domain-name constraint**: `DomainSpec.name`/table name must match `/^[a-z][a-z0-9_]*$/`
   (**no hyphens**); `dsh_auth_sessions` (underscore). Violations throw at `defineDomain` module load.
3. **split the async open promise**: `opening = storageDomain.open(spec)` and
   `ready = opening.then(...)` must be separate — after `.then` is attached, `ready` resolves to `void`,
   and the disposer must take the domain from the original `opening` to close (otherwise it leaks).
4. **schemastery callable types**: `Config({})` fills defaults at runtime, but the TS signature requires a
   complete shape — use `{} as AuthConfig` in tests.
5. **lint friction** (strictest preset):
   - Functions without an await should not be marked `async` (require-await error);
   - method references separated from the call → `unbound-method`: work around with `.bind(obj)`
     (interface methods) or `Reflect.get`;
   - `Function` type is forbidden (`no-unsafe-function-type`) → `(...args: never[]) => unknown`;
   - `max-lines-per-function` 80 lines → split large tests into multiple `describe`s; file ≤250 lines;
   - `noPropertyAccessFromIndexSignature`: `obj["key"]` rather than `obj.key` (Record types).
6. **fakes must preserve faithful promise semantics**: the `open` fake implementation should use
   `Promise.resolve/reject` (synchronous throws/values would surface as sync errors, unlike the real
   behavior).
7. **integration-test storage stack mounting order**: `Storage` → `storage-json` → `storage-domain` →
   `WebServer` → this plugin; dispose in reverse. The real WebServer listens once mounted
   (`ctx.plugin(WebServer, {host, port: 0})`).

## 5. M2 server end-to-end smoke workflow (DoD item 4)

On top of §3.2:

1. Sync new code: `rsync -az --exclude node_modules --exclude .git /Users/randal/source/dsh-auth/ ubuntu:/tmp/dsh-auth-test/`
   (then on the server `cd /tmp/dsh-auth-test && npm install --registry=... && npm run build` — lib must be
   rebuilt).
2. Write test credentials: on the server `mkdir -p ~/dsh-smoke && cat > ~/dsh-smoke/.credentials.yaml <<EOF
DSH_AUTH_TOKEN: <random test value>
EOF
chmod 600 ~/dsh-smoke/.credentials.yaml`
   (`dsh-credentials-local`'s `assertOwnerOnly` requires 0600, otherwise startup throws!).
3. Add config to the overlay's `dsh-auth` line:
   ```yaml
   - insert:
       - id: dsh-auth
         name: "/tmp/dsh-auth-test/lib/index.js"
         config:
           cookieSecure: false # http test environment; production defaults true
   ```
   **The remaining M1 probe line must be deleted** (M2 verified: `probe.mjs` sets
   `ctx.auth.gate = its own gate` — keeping it means `/__auth_probe` tests the probe gate rather than the
   real TokenGate, so the smoke run is all fake). The `/__auth_probe` path itself is still testable (no
   route → fallback → guarded → 302/401; with cookie → SPA 200).
4. Restart the instance (§3.2), verification sequence (on the server, maintain the cookie with
   `curl -c jar -b jar`):
   - `GET /__auth_probe` no cookie: HTML accept → 302; JSON accept → 401 (**this time it is the real guard,
     not the probe gate**);
   - `GET /auth/login` → 200 HTML; `GET /auth/whatever` → 404 (fallback, not SPA fallback);
     `DELETE /auth/login` → 405;
   - `POST /auth/login` wrong token → 401; right token (`-d "token=<v>" -c jar`) → 302 + `set-cookie`;
   - with cookie `GET /__auth_probe` again (`-b jar`) → 200;
   - `Authorization: Bearer <token>` → 200;
   - WS channel: `curl --http1.1 -s -i --max-time 2 -H "Connection: Upgrade" -H "Upgrade: websocket"
-H "Sec-WebSocket-Key: $(openssl rand -base64 16)" -H "Sec-WebSocket-Version: 13"
http://127.0.0.1:3081/api/events.host`: no cookie → first line `HTTP/1.1 401`; `-b jar` →
     first line `HTTP/1.1 101` (timing out via `--max-time` is normal; just look at the first line);
   - `POST /auth/logout?next=/` (`-X POST -b jar`, no body/content-type needed) → 302 + `Max-Age=0`;
     with the old cookie `GET /__auth_probe` again → 401.
5. Wrap up: kill the instance or leave it running (report status).

**M2 smoke debugging tips (verified effective)**:

- `dsh --profile web --dump-config` to see the final composited tree (line ids, config, order) — no need
  to guess.
- Mount diagnostic plugins/routes **under the `/auth/*` prefix** (e.g. `/auth/__diag`) to bypass the gate
  and curl directly — the gate's allowlist passes `/auth/*`, exact beats the catch-all prefix.
- `console.log` inside a plugin goes to `boot.log` (`ctx.logger` output is not guaranteed to be written to
  disk) — prefer console.log for diagnostics.

## 6. M2-specific execution notes (reminders beyond the spec)

- **Credentials never appear in logs**: token values and session tokens appear only in responses and
  memory; `resolveToken` failures record only the message.
- The credentials service in the web composite is provided by the `dsh-base` bundle (the `credentials`
  line) — **do not mount your own**; **integration tests do not mount a real provider** (spec M18: zero new
  dependencies) — use a structural fake provider `ctx.provide("credentials", { resolve })` mounted before
  this plugin; the real provider is only covered by the server smoke run (§5.2's `.credentials.yaml`,
  remember 0600; the env layer takes precedence — `process.env.DSH_AUTH_TOKEN` can also be fed directly to
  the smoke run).
- **Mount race (M2 smoke verified, must read)**: the harness **mounts lines in parallel** — the
  `credentials` line (dsh-base) may become ready only **after** dsh-auth (user layer) applies. **Do not
  read `ctx.get("credentials")` at apply time** — the resolver must lazily fetch fresh each resolve (spec
  §3.1/§4.6 already frozen); otherwise in a real composite login is always 401 and Bearer always rejected,
  while integration tests (sequential mount) are all green — only smoke exposes this. `storageDomain` has no
  such race (same bundle as webServer; inject guarantees visibility).
- `mode: "password"` throws in M2 (fail loud) — spec M11, do not treat it as a bug.
- **The integration-test login flow must mount the real storage stack** (Storage → storage-json →
  storage-domain, see `integration.auth.test.ts`): with only WebServer mounted, `auth.sessions` is always
  undefined → login is always 503 (fail-closed, not a bug) — hit on the first implementation.
- **lint line-count traps**: `max-lines` counts **skipBlankLines** (after formatting/reformatting the
  file can be pushed past the 250 cap; prettier first, then count); `max-lines-per-function` counts the
  whole describe callback as one function — large suites must be split per describe (the auth-endpoints
  tests were therefore split into three files).
- **`KvTable` real interface has more members than enumerated in impl-m1 §2.2**: you must also implement
  `keys()` and `update()`, otherwise `implements KvTable` in tests is a direct type error (base MemTable on
  session-store.test.ts).
- **eslint type-narrowing degradation**: `Array.isArray(x) ? x[0] : x` followed by a chained
  `?.split()[0]` is judged `any` (no-unsafe-* errors) — narrow with `typeof x === "string"`
  (form-body.ts hit this).
- **Server process management**: `pkill -f "dsh --profile web --port 3081"` matches the invoking shell
  itself (its command line contains the same string) → self-kill + exit 255. Use
  `pkill -f "[d]sh --profile web --port 3081"` (the bracket trick), and do the kill and start as two
  separate ssh calls (the nohup line of the start command would otherwise also match pkill).
- Next step candidates after M2: production `cordis.patch.yml` (name uses the npm package name rather than
  a path) + a deployment acceptance checklist (plan §8: auth line health checks, TLS prerequisite,
  `--trusted-host` orthogonality note).

## 7. Open questions / pending

- No blocking items. Candidate follow-ups: login-page UX polish, `/auth/status` wiring to the GUI logout
  button (client side), M3 spec.
