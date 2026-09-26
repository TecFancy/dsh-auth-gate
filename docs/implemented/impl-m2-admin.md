# dsh-auth M2 admin plane (D25, 2026-09-24)

This file is the executable-spec slice for the P2 admin plane (D25, 2026-09-24: administrator
password reset and the forced-change login gate). The blocks below were moved verbatim out of
[impl-m2.md](./impl-m2.md), which keeps the baseline M2 contract and a pointer at each original
location; D25's full rationale lives in
[the D25 record](../decisions/implemented/2026-09-24-admin-password-reset.en.md).

## 4.5b Routing and endpoint amendments (D25, 2026-09-24)

**D25 amendment (2026-09-24):** password mode reaches 1 prefix + **6 exact** (adds `/auth/users`,
`allow: GET`, and `/auth/users/password`, `allow: POST`); `/auth/password` also answers `GET` with
the server-rendered, JavaScript-free change form (an unauthenticated `GET` is
`302 /auth/login?next=/auth/password`), so its `allow` becomes `GET, POST` and P1's `POST` is
superseded. Token mode keeps 3 exact and **never** registers the admin routes. An authenticated
`/auth/status` body stays additive (`name`, `role`, `disabled`, `totpEnabled`, `mustChangePassword`,
`sessionKind`); unauthenticated, subject-gone and users-file-read-failure return the two original
keys with an **equal key set**.

**Review-pass amendment (2026-09-24, after the implementation-phase review):** three tightenings
that do not change the route model or the denial order. (1) `validateNext` and `denyHttp`'s 302
share one predicate (`shared/auth-common.ts`) that also rejects C0 control characters and DEL:
browsers strip ASCII TAB/LF/CR before URL parsing, so `"/\t/evil.com"` would otherwise become the
protocol-relative `//evil.com`, and CR/LF/NUL make `writeHead` throw `ERR_INVALID_CHAR` (the host
webserver answers `400` instead of the intended `302`); the logout redirect consumes the same
predicate. (2) The admin reset's read-modify-write re-reads the **actor** from the lock-held
`users.yaml` snapshot before touching the target record; if the actor was demoted or disabled
between the authorization read and the write, it answers `403` + audit `forbidden` with no hash
write, no revocation and no rate-limit failure. (3) The audit `target` is stripped of C0/DEL and
then clipped to 64 characters (the business field keeps its raw value), and a denial with no
session stays at `info` level.

### 4.5b.1 `/auth/status` additive fields

**D25 (2026-09-24):** authenticated bodies append `name`, `role`, `disabled`, `totpEnabled`,
`mustChangePassword`, `sessionKind`; unauthenticated, subject-gone and users-file-read-failure all
keep exactly the two original keys (equal key set, never a `role: null` placeholder).

## 4.5c Client half (PR2)

Frozen client contract for the admin block inside the Settings panel's Account security section
(`CONTRACT-pr2.md` §3 and its §9 corrections are the authority; PR2 adds **no** route, config item,
schema change, dependency or CSS file, and does not touch the plugin's host half).

- **Render gate:** the block renders only when `role === "admin"` **and** `disabled === false` **and**
  `sessionKind === "full"` **and** `typeof name === "string"`. Any field missing or carrying another
  value (an older server, a restricted session, a partial payload) renders nothing and sends **zero
  admin requests**; the `?? "full"` fallback of the first draft is gone, so a payload without
  `sessionKind` does not qualify.
- **No probing:** a non-admin client never requests `/auth/users` (no "fetch it and see the 403"),
  and no admin request is sent before `/auth/status` resolves (no flicker). `status === null` keeps
  rendering the loading hint, and the self-service form's existing behaviour is untouched.
- **List:** the server's order is preserved (the server sorts by name); each row shows `name`,
  `role`, `disabled`, `mustChangePassword` and `totpEnabled` (read-only badges) and the actor's own
  row is marked "You". The state badge is **mutually exclusive** with the priority
  `disabled` > `mustChangePassword` > normal, and an unknown `role` renders as raw text without a new
  dictionary key.
- **Target dropdown:** excludes the actor (their own password goes through the self-service form
  above) and says so in the block; it starts **empty** (`EMPTY_ADMIN_RESET.target === ""`), renders a
  placeholder option with `value=""`, and never preselects the first row (a preselection would make
  "no target chosen" unreachable and one stray click would reset the wrong account). When nothing is
  left, `admin.empty` replaces the form.
- **Local validation (closed set, four states):** empty target → `admin.targetRequired`; empty
  password → `admin.passwordRequired`; `password !== confirm` (including an empty confirm) →
  `admin.mismatch`; `actorTotpEnabled && code.trim() === ""` → `admin.codeRequired`. Nothing else
  blocks a submit.
- **Conditional re-authentication:** the `code` field renders only when `actorTotpEnabled === true`.
  Both password inputs carry `autocomplete="new-password"`; the POST body sends `target`/`password`
  plus `code` **only** when the actor has TOTP (**the `code` key is omitted**, not sent empty,
  otherwise) and never sends `confirm`.
- **Failure mapping:** a list response of **403 silently drops the block** (degrade, no error
  noise), while a list **401 renders `admin.unauthorized` and no list or form** (a 401 means the
  page's session is gone; staying silent would leave the form above claiming "signed in"). A
  503/network/parse failure shows `admin.unavailable` and renders no form. Submit failures are a
  **total function** of `status` plus the `error` literal (content-type where needed): 400
  `bad_target`/`policy` (rules translated through the existing `ruleText`, no new rule copy), 401
  `invalid_totp`/`unauthorized`, 403 `forbidden`, 404 `not_found`, 429 `locked` with the
  interpolated `retryAfter`, 413/415/503 generic. **Every unlisted combination falls back to
  `admin.generic`**, a missing or non-boolean `sessionsRevoked` counts as `false`, and 403 is only
  recognised as `{error:"forbidden"}` (a self-reset is rejected with the same literal). The client
  never writes `Origin` and never asks for an exemption.
- **Success:** the four field values are cleared in the DOM, a success line appears in place and
  **no navigation happens** (the acting admin's own session is untouched); the client then
  **re-fetches `/auth/users`** (same abort rule) so `mustChangePassword` badges are not stale, while
  a failed submit leaves the rows unchanged. `sessionsRevoked === false` is a **security failure,
  not a success variant**: it renders `admin.successKept` with `role="alert"` +
  `aria-live="assertive"` and the error colour token (never the success green).
- **DOM ids:** `dsh-auth-gate-admin-{target|password|confirm|code}` plus
  `dsh-auth-gate-admin-status` (prefix `dsh-auth-gate-admin`).
- **Copy and styling:** all text comes from the frozen `ADMIN_KEYS` dictionary with **equal zh/en
  key sets** (`CONTRACT-pr2.md` §4 table plus the two §9 keys `admin.codeRequired` and
  `admin.targetPlaceholder` is the key authority); `admin.intro` and `admin.successKept` use the
  revised §9 wording, and `admin.selfHint` states the product boundary (your own password belongs to
  the form above, the admin plane cannot reset yourself, and a forgotten own password goes through
  the CLI). Styles use only `--dsw-*` tokens, with no CSS file, no hard-coded colour and no new
  dependency.
- **Lifecycle:** the host's `close` prop is not consumed; unmount aborts the in-flight request and
  no state is set after unmount; errors are not swallowed (they land on `admin.generic`).
- **Bundle:** the client half stays a **single-file CJS bundle** (`tsdown`
  `codeSplitting: false`, pinned by `verify-bundle.mjs`), and the existing constants in
  `account-styles.ts` keep their values so the self-service page stays pixel-stable.

## 5b Test matrix additions (D25, 2026-09-24)

1. **D25 (2026-09-24):** password mode registers 7 routes (1 prefix + 6 exact); the snapshot asserts
   the six paths **and their `allow` values** (`/auth/password` = `GET, POST`, `/auth/users` =
   `GET`, `/auth/users/password` = `POST`), and token mode still asserts 3 exact with no admin path.

## 5c Test matrix additions (PR2)

1. **jsdom, four groups.** (a) **api**: a 200 response keeps the server order and drops malformed
   rows; the list's 403 → `denied` and its **401 → `unauthorized`** (two distinct outcomes); 503,
   malformed JSON and network errors → `failure`; abort → `aborted`; the request pathname, method,
   headers and body are asserted (`code` present only when the actor has TOTP, `confirm` never);
   `sessionsRevoked:false` is passed through and a missing/non-boolean value counts as `false`; an
   unlisted status+error combination lands on `admin.generic`; every mapped error code asserts its
   copy key one by one; the zh/en key sets are equal. (b) **view**: loading hint; row count, role and
   state badges (mutual exclusion and `disabled > mustChangePassword > normal` priority) and the
   "You" row; the dropdown excludes the actor, starts empty and carries a `value=""` placeholder
   (no row preselected); actor-only → `empty`; both password inputs expose
   `autocomplete="new-password"` through `getAttribute`; `code` appears only when
   `actorTotpEnabled`; after a successful submit the four input values are empty, the success copy
   shows **and the list is re-fetched** (`mustChangePassword` badges refresh) while a failed submit
   leaves the rows untouched; `successKept` and `successRevoked` differ and the revoked-failure hint
   asserts `role="alert"` plus `aria-live="assertive"` and the error colour token; a 400 policy
   response translates the rules one by one; 429 interpolates the seconds; 403 shows forbidden; and
   the **four** local validation states (no target, empty password, mismatch, missing code when the
   actor has TOTP) are covered. (c) **wiring**: an authenticated non-admin renders only the
   self-service form with the **pathname set** exactly `{"/auth/status"}` (**never** `/auth/users`);
   an admin on a full session shows the block; an admin on a restricted session, on a payload with
   `role` but no `sessionKind`, and on a payload whose `disabled` is not `false` all render nothing
   and send no admin request; an older server without the additive fields renders no block and
   throws nothing; the loading state keeps its existing behaviour. (d) **integration** (lead-owned
   `src/client/admin-integration.test.tsx`): the real section plus the real block with a mocked
   fetch, an admin reset reaching 200, no `/auth/users` request for a non-admin, and the fields
   cleared after success.

   Assertion discipline (§9 A11): fetches are asserted as **pathname sets, never call counts**
   (React StrictMode double-invokes and the first call may be `aborted`), so an admin success may
   legitimately contain `/auth/users` twice; `autocomplete` is read with `getAttribute`; `aria-live`
   asserts attributes and text, not real speech. Extra cases: unmount abort leads to **zero**
   state updates, a double submit sends one request, and a hostile `name` such as
   `<img onerror=...>` renders as plain text (`textContent` contains no tags).

2. **Gate:** `npm run verify` stays green with the coverage floor intact, and `lib/client.js` is
   still a single file.
3. **Real-instance E2E:** `CONTRACT-pr2.md` §8 (admin lists users, resets `dsh_verify_p2`, the
   target's old session dies immediately, the target's next sign-in gets only the restricted
   session, the SSR change form is submitted successfully and the target then signs in normally; the
   target's TOTP bytes are unchanged and two audit lines exist; a non-admin sees no block while a
   direct `GET /auth/users` with that cookie answers 403; curl without `Origin` gets 403 and with a
   valid `Origin` gets 200).
