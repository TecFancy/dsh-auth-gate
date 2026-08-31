# GUI sign-out entry (client half) implementation spec

> Scope: the client half of dsh-auth-gate (browser plugin). The sign-out entry was originally placed at the
> top-right of the session header (`conversation.session.header.utilities`) and as a floating element at the
> top-right of the new-conversation page (`shell.overlay`); after two redesigns (sidebar footer row → this
> version) it finally lands in the **settings panel**: a centered, prominent "退出登录 / Sign out" button at the
> bottom of the Settings → General Settings page, whose copy uses dsh's existing locale mechanism (follows the
> UI language switch). The server-side endpoints (`POST /auth/logout`, `GET /auth/status`) were already frozen
> and released in M2/M3; this spec only touches the rendering layer, the packaging layer and docs.

---

## 1. Background & Goals

Close the sign-out loop: one-click sign-out inside the GUI after authentication. History: 0.6.5 placed it at the
top-right (session header + floating icon on the new-conversation page) → 0.7.1 first revision moved it to the
sidebar footer row → the user fell back to "tucking it into the settings panel", finally settling on a centered
danger-style button at the very bottom of the Settings → General Settings page (avoids high-frequency occupancy
at the top-right/sidebar, and also sidesteps the shell ordering issue where "footer action renders above the
settings trigger row").

Mount-point contracts (dsh 0.1.0-rc.7, same version on the local harness and in production) have been verified by
actual testing:

- **Mount point `settings.general.item`** (declared by the General page of ui-settings-general, root scope,
  **list** slot, `replaceRisk: none`): an appendable row on the Settings → General Settings page, in the same
  list as the Agent presets (-25), permissions (-20), language (0), appearance (10) and Enter behavior (20);
  `order: 30` puts it last → at the very bottom of the page. Registration contract `{ id, order, label? }` +
  `locale` (injecting a `t` seat); owner props are empty (`SettingsGeneralItemOwnerProps {}`) — everything inside
  the row (icon / copy / behavior / accessible name) is drawn by this plugin itself.
- **Remove the three old mount points**: `conversation.session.header.utilities`, `shell.overlay`
  (the two top-right spots) and `sidebar.footer.action` (the sidebar footer row). After this, neither the
  top-right nor the sidebar footer has a sign-out entry anymore.
- **i18n**: copy registers an `auth` namespace dictionary (bilingual zh/en) via `ctx.locale` (LocaleRuntime of
  `dsh-client-locale`); slot registration carries `locale: "auth"` → the renderer injects a `t` seat into the
  component (the same mechanism as the language switch in Settings; lookup chain = namespace → common → the key
  itself). When the language switches, the ledger version is bumped and `t` follows the active language
  immediately.
- **Endpoint constraints (unchanged)**: `POST /auth/logout?next=/` (GET → 405; M22: `next` is read only from
  the query and validated with fallback to `/`); `GET /auth/status` → `{"authenticated":true|false}`
  (cookie-only).

## 2. Frozen Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Single-point registration: `settings.general.item`, id `dsh-auth-gate-logout`, `order: 30` (last row on the General page), `locale: "auth"`, `label` is a thunk (`() => t("logout")`). **Remove** the old three: `conversation.session.header.utilities`, `shell.overlay`, `sidebar.footer.action`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D2  | Sign-out still uses the native `<form method="post" action="/auth/logout?next=/">` (zero JS dependency; 302 fallback to `/` → gate → login page)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D3  | Session state: `fetch("/auth/status")` once when the component mounts; render only when `authenticated: true`, otherwise render null (no leftover UI)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D4  | Visual: a centered, prominent CTA inside the settings panel (no longer a 32px circular icon, no longer a list row) — a 16px square+arrow SVG (viewBox 24 unchanged, only width/height 16) + localized text; container `display:flex; justify-content:center; padding:20px 0 4px`; button `inline-flex; gap:8px; padding:10px 24px; border-radius:12px`, fill `--dsw-alias-state-error-primary` (danger-action semantics) + text `--dsw-alias-label-primary-inverted` (inverted label), hover `filter: brightness(1.08)` (theme-adaptive, no hardcoded color values). Inline style, no CSS file, no primitives (minimal dependencies). The dialog/panel structure is provided by the settings shell; this entry occupies no single slot |
| D5  | i18n: inside `apply`, `ctx.effect(() => [ctx.locale.register("auth","zh",{logout:"退出登录"}), ctx.locale.register("auth","en",{logout:"Sign out"})], ...)` (bilingual dictionaries cascade on fiber unload); slot registration `locale: "auth"` injects the `t` seat; button text and `aria-label`/`title` all use `t("logout")`. No new language-switch UI (the switch already exists in Settings — the Language row in General)                                                                                                                                                                                                                                                                                                     |
| D6  | Types: continue the local structure mirror (`src/client/context.ts`, `AuthLocaleService` + `effect` facet, registration option `locale`), import no `@deepseek-ai/*` runtime values; manifest inject unchanged; service-side inject is `["slots", "locale"]` (locale is a built-in dsh client service, same source as the language row on the settings page)                                                                                                                                                                                                                                                                                                                                                                           |
| D7  | Build: unchanged (tsdown single entry `src/client/index.tsx` → `lib/client.js`, ModuleLoader id = package name; the client declaration channel generates `lib/client/index.d.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D8  | Tests: jsdom (`@vitest-environment jsdom`) unit tests covering apply registration (new `settings.general.item`, bilingual dictionary registration, `locale`/`order`/thunk label) and component branches (authenticated true/false, text labels zh/en, form action/method, accessible name, hover highlight); fetch mock. The HeroLogoutAction / SidebarLogoutAction tests have been removed, unified into `SettingsLogoutAction`.                                                                                                                                                                                                                                                                                                      |
| D9  | Out of scope: re-adding the top-right/sidebar entries, a sign-out confirmation dialog, polling `/auth/status` (once on mount only), seamless refresh inside the SPA after client sign-out (302 full-page redirect), any new i18n beyond the button text. No changes to server endpoints/gate/session semantics.                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 3. File Blueprint

| File                                                            | Action         | Description                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client/context.ts`                                         | Modify         | Mirror adds `AuthLocaleService` (register/bind) and `AuthContext.effect`; `AuthSlotRegisterOptions` gains `locale?: string`                                                                                                                                                                             |
| `src/client/logout-action.tsx`                                  | Modify         | `SettingsLogoutAction` (`{ t? }`): `useAuthenticated` gate + `<form>` + centered danger CTA (16px icon + `t("logout")` text, hover highlight)                                                                                                                                                           |
| `src/client/index.tsx`                                          | Modify         | Register dictionaries (zh/en, zh = 退出登录) → single-point registration via `ctx.slots.inject("settings.general.item", ...)` (`locale`/`order:30`/thunk label); remove the three old registrations; `inject = ["slots","locale"]`                                                                      |
| `src/client/logout-action.test.tsx`                             | Modify         | apply assertions: bilingual dictionary registration + single-slot registration; component assertions: zh/en text, hidden when unauthenticated, hover highlight (see D8)                                                                                                                                 |
| `docs/implemented/impl-client-logout.md`                        | Modify         | This spec (i.e., this file)                                                                                                                                                                                                                                                                             |
| `docs/deployed/deployment.md` / `_zh`, `README`, `README.zh.md` | Modify         | "Sign-out at the top-right/sidebar bottom" description → prominent sign-out button in the settings panel; delete outdated screenshots `docs/demo/logout-hero-blank.png`, `logout-conversation-en.png`; design previews `docs/design/**` are historical reference only, no longer linked from the README |
| `lib/client.js`, `lib/client/index.d.ts`                        | Build artifact | Committed in the same change as src                                                                                                                                                                                                                                                                     |

## 4. Verification Steps

1. `npm run verify` (format:check + lint + type-check (incl. client channel) + test:coverage
   - lock:check) all green, coverage ≥ 80%.
2. `npm run build`: `tsc -p tsconfig.build.json` + `tsdown` + client declaration channel;
   `git diff --exit-code -- lib` passes (artifacts committed in the same change).
3. After deploying to production (tencent-cloud, `dsh-web.service`), verify in a real browser: sign in →
   Settings → General Settings → a centered "退出登录 / Sign out" button appears at the bottom of the page →
   switch language → the button text toggles between "退出登录" / "Sign out" → click it → 302 falls back to the
   login page → SPA requests without the cookie are blocked by the gate. **Neither the session-header top-right,
   the new-conversation-page top-right, nor the sidebar footer has a sign-out entry anymore.** Prepare a demo per
   the "GUI demos" convention in `docs/specs/development.md` (screenshots + what they prove).
4. Commit to development → PR → main (`feat:` → release-please).

## 5. Explicitly Out of Scope

- No third-party runtime resources; the client bundle still only depends on the platform module table (react).
- No changes to any server endpoints/gate/session semantics.
- Do not replace single slots like `settings.section`/`settings.trigger` (the settings panel structure still
  belongs to ui-settings-general / ui-settings); only the appendable `settings.general.item` is used; do not
  touch the sidebar shell, do not occupy `sidebar.footer.action`.
- No language-switch control outside Settings (the switch already exists in Settings → General → Language row;
  this time only the sign-out button text follows it).
- No UI changes beyond i18n (confirmation dialogs, dark-mode-specific styles, etc.).

## 6. DoD (Definition of Done)

1. All files in §3 land, `npm run verify` all green, `lib/` committed in the same change as `src/`.
2. After production deployment, verify the sign-out loop in a real browser (placement, bilingual text, no
   leftovers at the top-right/sidebar).
3. Commit message complies with commitlint (`feat(client): move sign-out into settings as a centered
CTA`), no push without the user's instruction.
