# 架构

[English](architecture.md)

源码树的形状，以及维持这个形状的规则。这一页描述「是什么」；每个结构选择背后的理由在 Agent Note 里，按需链接。

加 slice、在层之间移动文件、或写路由字面量之前，先读这一页。

## 分层

Feature-Sliced Design（D30）。host 半边用 FSD 六层里的下三层，放在 `src/host/` 下；入口和接线在 `src/` 根，与被分析的树并列。client 半边用它需要的层，放在 `src/client/` 下（没有 `app`：插件不拥有应用外壳），`index.tsx` 在它的根。

依据：[FSD 笔记](../.agents/notes/implemented/architecture/2026-10-12-fsd-host-and-client.zh.md)。

## 目录树

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

单元测试与源码同目录，在同一个 segment 里。

```
test/               # test code outside src (not compiled into lib, not in coverage)
├── integration/    #   integration.*.test.ts: real cordis/webserver/storage stack
│                   #   + integration-*-helpers.ts (enter src through slice or segment index.ts)
└── *-harness.ts    #   shared unit-test harnesses (not .test.ts, so vitest does not collect them)
lib/                # build output (host under lib/host/) - COMMITTED (see below), never hand-edited
```

分层由两道门禁执行。`npm run lint:fsd` 对每个半边各跑一次 Steiger（层序、同层隔离、经 `index.ts` 的公共 API、`@x` 跨引用、命名）。`npm run slice:check` 只管 Steiger 看不见的部分：client 与 host 半边互不 import；根文件只能经 slice 或 segment 的 `index.ts` 进入 `src/host`；`src/protocol/` 不 import 自身之外的任何东西，且只经它的 `index.ts` 被两个桥接点（`src/host/shared/protocol/index.ts`、`src/client/shared/api/protocol.ts`）进入；无法解析的相对 import 失败；`src/` 下每个文件要么是根文件，要么在 `src/protocol/`、`src/host/{shared,entities,features}/`、`src/client/index.tsx` 或 `src/client/index.test.tsx`、`src/client/{shared,entities,features,widgets,pages}/` 下。增删 slice 意味着更新这棵树。

`/auth/*` 端点的线上形状（status、用户列表、改密与管理员重置的请求/响应/错误体，加上 `UserRole`、`SessionKind`、`PasswordRule`）是 `src/protocol/payloads.ts` 里的纯类型，由 `src/protocol/index.ts` 再导出，经同样的两个桥接点到达。绝不在任一半边重新声明它们：host 侧用它标注写入方，`formField<Request>(params, name)` 用它读取；client 侧用它标注 `encodeForm` 的请求对象，并通过 `Unchecked<T>`（契约键、`unknown` 值、仍逐字段校验）读取响应体。`shared` 是最低层，所以 host 或 client 的每一层都能不经 `@x` 到达它们。

依据：[跨半边契约笔记](../.agents/notes/implemented/architecture/2026-10-16-cross-half-protocol.zh.md)。
