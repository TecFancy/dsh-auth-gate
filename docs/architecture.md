# Architecture

[中文](architecture_zh.md)

The shape of the source tree and the rules that keep it that way. This page
describes what is; the reasoning behind each structural choice lives in an
Agent Note, linked where it applies.

Read this before adding a slice, moving a file between layers, or writing a
route literal.

## Layers

Feature-Sliced Design (D30). The host half uses the lower three of FSD's six
layers under `src/host/`; the entry points and wiring sit at the `src/` root,
beside the analysed tree. The client half uses the layers it needs of the five
under `src/client/` (no `app`: a plugin owns no application shell), with
`index.tsx` at the root of its tree.

Rationale: [the FSD note](../.agents/notes/implemented/architecture/2026-10-12-fsd-host-and-client.md).

## The tree

```
src/
├── index.ts               # plugin entry + auth service wiring (mode picks the password or token flow)
├── cli.ts                 # dsh-auth user-management CLI (bin entry)
├── cli-usage.ts           # dsh-auth usage text (kept out of cli.ts for the file-length cap)
├── proxy-cli.ts           # dsh-auth-proxy (bin entry)
├── auth-routes.ts         # root-side mount of the /auth endpoint table (passkey + password/token groups)
├── admin-wiring.ts        # root-side assembly of the admin routes
├── bootstrap-wiring.ts    # root-side assembly of the first-run routes (/auth/bootstrap, /auth/setup, /auth/continue)
├── endpoints-wiring.ts    # root-side assembly of the /auth endpoint registration
├── telemetry-wiring.ts    # root-side assembly of the anonymous ping (config fragment -> guard admit hook)
├── passkey-wiring.ts      # passkey config fragment, WebAuthn self-check and endpoint wiring
├── rebridge-wiring.ts     # post-admit host-cookie rebridge hook (guard-side half: `guard/rebridge.ts`)
├── host-auth-wiring.ts    # route-auth model bridge: session -> owner Peer for host `required` routes,
│                          # plus the SPA fallback auth adapter (0.2.3-alpha.2 and later)
├── token-resolver.ts      # shared-token credential resolver (token mode)
├── launch-token-bridge.ts # reads dsh's launch token: post-login /?token= bridge and bootstrap comparison
├── cli-skill.ts           # `dsh-auth skill install`
├── *.test.ts              # root tests: entry points, CLI, manifest checks (host-corridor, manifest-*)
├── protocol/              # cross-half contract: /auth paths, login URL builders (index.ts) and
│                          # request/response/error payload types (payloads.ts); imports nothing
├── host/                  # host half: three FSD layers, analysed by Steiger (`npm run lint:fsd`)
│   ├── shared/            #   layer without slices: segments only, each with its own index.ts
│   │   ├── guard/         #     Gate vocabulary, webServer wrapping and deny pipeline, cross-site bounce,
│   │   │                  #     post-admit rebridge, caller-admitted resource reads, startup self-check,
│   │   │                  #     host route-auth rule mirror (`host-auth.ts`) and entry wrappers (`wrap-routes.ts`)
│   │   ├── http/          #     cookie / form body (+ typed `formField`) / Origin / Host / client IP / `next` /
│   │   │                  #     login redirect / `Permissions-Policy`, plus the session-independent authCatchAll,
│   │   │                  #     queryOf, methodNotAllowed and the launch-token bootstrap shape probe
│   │   ├── login-page/    #     self-contained login page (token, password, TOTP challenge and passkey variants)
│   │   ├── protocol/      #     bridge to src/protocol: the host half's only way in
│   │   ├── rate-limit/    #     two-bucket login rate limiter
│   │   ├── skill/         #     `dsh-auth skill install`
│   │   ├── telemetry/     #     anonymous usage ping (lazy, after an admitted request; no timer)
│   │   └── lib/           #     leaf helpers (`dshHomeDir`, `SELF_VERSION`)
│   ├── entities/
│   │   ├── session/       #     model/ session-store + session-request (shared cookie/Bearer lookup);
│   │   │                  #     api/ logout and /auth/status (AuthHttpDeps)
│   │   └── user/          #     model/ users-file (users.yaml), atomic write, password policy, passkey records;
│   │                      #     @x/session.ts exposes only `UsersLoadResult` to the session entity
│   └── features/          #     slices never import each other; cross-slice goes through index.ts
│       ├── token/         #       api/ /auth endpoints; model/ TokenGate
│       ├── password/      #       api/ endpoints + password change; model/ gate, login (including the
│       │                  #       passkey-only refusal), session issue, restricted session, challenge cookie,
│       │                  #       disabled-user sweeper, login notice; lib/ scrypt;
│       │                  #       ui/ server-rendered failure and password-change pages
│       ├── passkey/       #       api/ login, registration, management and settings endpoints; model/ ceremony
│       │                  #       store and cookie, WebAuthn parameter resolution, counter policy;
│       │                  #       cli/ list and remove
│       ├── totp/          #       lib/ RFC 6238; model/ replay guard; cli/ enable and disable subcommands
│       ├── bootstrap/     #       api/ /auth/bootstrap, /auth/setup, /auth/continue; model/ configured probe
│       │                  #       and the server-rendered setup page
│       ├── admin/         #       api/ endpoints and responses; model/ audit, reset steps, user list, deps
│       └── proxy/         #       model/ local reverse proxy and header filtering
└── client/                # client half: five FSD layers, analysed by Steiger, never imports the host half
    ├── index.tsx                 # bundle entry (tsdown) and host slot wiring; root of the analysed tree
    ├── shared/                   # segments only, each with its own index.ts
    │   ├── api/                  # `AuthContext` (local mirror of the host slot context, types only),
    │   │                         # `protocol.ts` (the client half's bridge to src/protocol) and
    │   │                         # `encodeForm` (form body from a contract-typed request object)
    │   ├── i18n/                 # account copy: keys, zh/en dictionaries, translate helpers
    │   └── ui/                   # shared inline styles and the account icon paths
    ├── entities/
    │   └── account/              # api/ `useAccountStatus` and the `AccountStatusView` it parses into
    ├── features/                 # slices never import each other; cross-slice goes through index.ts
    │   ├── change-password/      # ui/ form and fields; model/ validation and submit; lib/ redirect
    │   ├── admin-users/          # api/ list and reset requests; model/ form and result types;
    │   │                         # lib/ copy and failure mapping; ui/ form
    │   ├── passkey/              # api/ status, list and mutations; model/ form, actions and copy;
    │   │                         # ui/ add form, credential table and settings toggle
    │   ├── logout/               # ui/ logout settings action
    │   └── nav-icon/             # ui/ settings-nav icon shim (DOM)
    └── widgets/
        └── account-section/      # ui/ the "Account security" section; composes password change,
                                  # user management, the passkey block and the version/star footer
```

Unit tests live next to their source file, inside the same segment.

```
test/               # test code outside src (not compiled into lib, not in coverage)
├── integration/    #   integration.*.test.ts: real cordis/webserver/storage stack
│                   #   + integration-*-helpers.ts (enter src through slice or segment index.ts)
└── *-harness.ts    #   shared unit-test harnesses (not .test.ts, so vitest does not collect them)
lib/                # build output (host under lib/host/) - COMMITTED (see below), never hand-edited
```

Layering is enforced by two gates. `npm run lint:fsd` runs Steiger once per half, over `src/host` and over `src/client` (layer
order, same-layer isolation, public API through `index.ts`, `@x` cross-imports, naming).
`npm run slice:check` keeps only what Steiger cannot see: the client and host halves never
import each other, root files enter `src/host` only through a slice or segment `index.ts`,
`src/protocol/` imports nothing outside itself and is entered only through its `index.ts` by
the two bridges (`src/host/shared/protocol/index.ts`, `src/client/shared/api/protocol.ts`),
unresolvable relative imports fail, and every file under `src/` is a root file, under
`src/protocol/`, under `src/host/{shared,entities,features}/`, `src/client/index.tsx` or `src/client/index.test.tsx`,
or under `src/client/{shared,entities,features,widgets,pages}/`. Adding or removing a slice
means updating this tree.

The wire shapes of the `/auth/*` endpoints (status, user list, password change and admin reset
request, response and error bodies, plus `UserRole`, `SessionKind` and `PasswordRule`) are pure
types in `src/protocol/payloads.ts`, re-exported by `src/protocol/index.ts` and reached through the
same two bridges. Never redeclare one of them in either half: the host types its writers and
`formField<Request>(params, name)` reads with them, the client annotates its request objects for
`encodeForm` and reads response bodies through `Unchecked<T>` (contract keys, `unknown` values,
still validated field by field). `shared` is the lowest layer, so every host or client layer reaches
them without an `@x` import.

Rationale: [the cross-half contract note](../.agents/notes/implemented/architecture/2026-10-16-cross-half-protocol.md).
