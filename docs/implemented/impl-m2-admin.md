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

## 5b Test matrix additions (D25, 2026-09-24)

1. **D25 (2026-09-24):** password mode registers 7 routes (1 prefix + 6 exact); the snapshot asserts
   the six paths **and their `allow` values** (`/auth/password` = `GET, POST`, `/auth/users` =
   `GET`, `/auth/users/password` = `POST`), and token mode still asserts 3 exact with no admin path.
