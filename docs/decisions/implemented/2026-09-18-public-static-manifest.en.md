# D13. The PWA manifest joins the unguarded public static paths

## Decision

`src/gate/guard.ts` gains the constant `PUBLIC_STATIC_PATHS = ["/manifest.webmanifest"]`
and the predicate `isPublicStaticPath(kind, pathname)` (**exact match**;
`kind === "upgrade"` is always false). `TokenGate` and `PasswordGate` each add one line
— `if (isPublicStaticPath(kind, pathname)) return "allow";` — after the `/auth` whitelist
check and before any credential lookup. The existing `/auth` and `/auth/*` expression and
the credential semantics of every other entry are untouched.

## Context

On the live deployment (`dsh.example.com`, dsh 0.1.5-rc.2 + Caddy + this gate) a logged-in
browser shows a permanent console error: `GET /manifest.webmanifest → 401`. Nothing is
misconfigured:

- Browsers fetch the Web App Manifest **without credentials** by specification. Chromium
  `blink/renderer/modules/manifest/manifest_fetcher.cc` calls
  `SetCredentialsMode(use_credentials ? kInclude : kOmit)`, and
  `manifest_manager.cc: ManifestUseCredentials()` is true only for
  `<link rel="manifest" crossorigin="use-credentials">`. The shipped
  `dsh-web-frontend/dist/index.html` manifest `<link>` has **no** `crossorigin`, so the
  fetch is always `omit` — a cookie gate can never recognize it.
- The gate whitelists only the `/auth` prefix (M4/P12), and the fallback seat
  (`dsh-host-frontend-static`) sits entirely behind the guard. The manifest file exists in
  dist and `.webmanifest` is already mapped to `application/manifest+json`, yet the request
  is still denied with 401.
- The repository's own entry matrix missed this row: `docs/deployed/entry-coverage-0.1.5-rc.2*.md`
  only added `/`, `/index.html` and `/favicon.ico`. The similar `/favicon.ico` 401 is by
  design and harmless (a document's favicon request carries cookies once logged in); the
  manifest failure is **functional**: PWA installation, `display: fullscreen` and icon
  metadata all break, for every deployment of this gate.

## Alternatives Considered

- **Answer it in Caddy (`respond`) or host the file with `file_server`** — fixes the
  deployment today, but duplicates the content, embeds a version-pinned path such as
  `dsh-015rc2` that rots on the next dsh upgrade, and leaves every other gate user at 401.
- **Add `crossorigin="use-credentials"` to the dist `<link>`** — semantically the cleanest,
  but it edits a vendor artifact that the next host upgrade overwrites (there is no dist
  patch mechanism here), and the gate must not depend on the host eventually doing that.
- **Whitelist whole static prefixes (`/assets`, `/favicon.ico`, ...)** — immediately makes
  the entire frontend bundle public and contradicts the existing "no application bytes
  without authentication" stance; favicon requests already carry cookies, so they need no
  exemption.
- **Add a `publicPaths: string[]` config option** — contradicts the frozen M4/P12 decision
  against a separate whitelist config, hands the security boundary to the operator, and
  still has to hard-code a default.
- **Do nothing** — accept a permanent 401 and a broken PWA surface.

## Why

One exact path is the **smallest** public surface that satisfies "must be reachable without
authentication": the manifest carries only `name` / `short_name` / `start_url` / `display`
and icon references — no workspace, session or path information — so it belongs to the same
class as `/auth` (the login page must be reachable). Exact matching (no prefix, no trailing
slash) plus the `upgrade` exclusion confines the added attack surface to one read-only GET;
keeping the constant in `guard.ts` and sharing the predicate between both gates leaves a
single place where the whitelist can drift.

Follow-up: during **installation** the browser also fetches the icons the manifest declares
(`/favicon.svg`); whether that fetch is likewise credential-less is unverified (automated
browsers fetch manifests and icons lazily, so it cannot be reproduced locally). If PWA
installation is pursued, gather evidence the same way and add one exact path if needed —
do not widen the whitelist preemptively.
