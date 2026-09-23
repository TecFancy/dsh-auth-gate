# D24. Post-change destination, login-page reason notice, and the settings nav identity

## Decision

P1.1 (the four follow-ups before the PR) with **zero changes to the frozen `POST /auth/password`
contract**:

1. **A successful change no longer leaves the user on the settings panel.** The success copy stays
   (it is the only proof the change worked), then after **2500 ms** the client runs
   `location.replace("/auth/login?next=%2F&notice=password-changed")`. The success button becomes
   **"Sign in again"** (immediate replace, cancels the pending timer) and receives focus as soon as
   the success state renders. The host's `close` owner prop is no longer used: closing the dialog
   would leave the user inside a dead-session SPA.
2. **The login card can explain itself.** `GET /auth/login` reads a `notice` query parameter and
   maps it through an **exact whitelist** (`password-changed` only) to a compiled-in constant:
   `<p class="notice" role="status">Your password was changed. Sign in with your new password.</p>`
   — its own slot, never the `role="alert"` error slot, rendered before the error. It appears
   **only on the password card**: the TOTP challenge page, the 401/429 failure pages and every
   `POST /auth/login` re-render carry no notice (the POST path never parses the parameter).
3. **Settings nav identity**: the section id stays `dsh-auth-gate-account` (we never take the host's
   `account`), the nav label moves from `Account` to **"Account security" / 「账号安全」**, and
   `order` moves from 500 to **900**; the panel adds one line clarifying that these are local
   sign-in credentials, unrelated to the DeepSeek cloud account.
4. **We do not fight the host for the nav DOM.** The host's `settings.section` options are only
   `id`/`order`/`label`, and nav icons come from the shell's hard-coded `navIcon` if-chain (every
   third-party section falls back to the default gear) — so there is **no** `MutationObserver`-based
   nav-row replacement. The self-designed icon (shield + keyhole, 16px outline) is rendered inside
   our own content area and shipped as the asset `docs/demo/account-security.svg` for README use
   and a future upstream PR.

## Context

- The server clears the cookie and revokes **every** session for that subject _before_ it answers
  `200 {"ok":true}`. The current device is therefore already a dead shell at success time — every
  later request would 401. That is the product reason for leaving the panel.
- The host sorts nav rows by `order` only (`sort((a, b) => a.order - b.order)`) with **no
  tie-breaker**: equal orders keep plugin registration order, which differs across installations.
  Known occupants: host `general 0` / `models 10` / `plugins 15` / `agent-presets 20`, plus the
  official cloud-account section `account -10` from 0.1.7; the sibling package
  `dsh-plugin-subscriptions` uses `90`.
- From 0.1.7 the host ships `@deepseek-ai/dsh-client-ui-settings-account` (DeepSeek cloud account:
  sign-in, API keys, balance) and it registers exactly `id: "account"`; sharing an id makes the
  `only` filter mount both sections at once.
- The login card is **server-rendered English** (`Sign in`, `Invalid username or password.`) and is
  outside the client dictionary, so the notice copy is an English constant too.

## Alternatives Considered

- **Server-side 302** to the login page: `fetch` follows the redirect and swallows the JSON body,
  which contradicts the frozen 200 JSON contract. Rejected.
- **`location.assign` instead of `replace`**: the dead page stays in the history stack, so pressing
  Back after signing in returns to a shell that only looks alive (and may be restored from bfcache).
  Rejected.
- **A short-lived flash cookie carrying the notice**: survives a later reload better, but widens the
  session surface (one more cookie slot a third party can set) for a copy-only benefit. Rejected.
- **Taking `id: "account"` to inherit the host's person icon**: collides with the official cloud
  account section (double mount on 0.1.7) and mismatches semantics (that section is the DeepSeek
  cloud account, ours is local sign-in). Rejected; a negative test pins `id !== "account"`.
- **Nav-row DOM enhancement** (locate our nav button by the current locale label, hide the host
  gear, inject our SVG, replay with a `MutationObserver`): it would put the icon in the nav row, but
  it means fighting the host's React tree — reconciliation can drop the injected node (flicker), the
  visible label is not a stable selector across host releases, and it spends the file-line and test
  budgets. Review verdict: cut it; render the icon inside our own content and file the upstream ask.
  The proposal source is archived under
  `notes/tech/dsh-auth-gate/references/pwchange-p1-2026-09-23/proposal-nav-icon/` (not product code).
- **Keeping `order 500` (or moving up to `5` next to the official account section)**: 500 collides
  more easily with newcomers, and the host's `-10 … 20` band has no contractual gap — a later
  official section would jump the queue. Rejected.

## Why

- **replace + timer + clickable button**: all three exits point at the same URL — the automatic hop
  is convenience, the button is the fallback, and focus is accessibility (WCAG 2.2.1: a 2.5 s time
  limit needs an equivalent immediate action). The button is never disabled.
- **Whitelist constant for the notice**: every served string is a compile-time constant; the query
  only _selects_ copy and is never concatenated or echoed, so reflected XSS / open redirect cannot
  exist on this path, and `next` validation is untouched. Tests assert the response contains no
  attacker-controlled bytes and that failure pages carry no notice.
- **order 900 instead of a declared "reserved band"**: it only claims "greater than every known
  entry, late in the nav" — a global-last guarantee is impossible without a tie-breaker. First come,
  first served on 900; collisions move to 901/902. Late placement also matches the settings-page
  convention of account/security last and avoids overflowing a nav column that does not scroll.
- **Icon inside our own tree**: testable (jsdom asserts presence and `aria-hidden`), disposable, and
  free of host coupling; if the host ever adds an `icon` option for `settings.section` (or maps our
  id in `navIcon`), we switch to the official API.

**Residuals**: the notice is visible only on the current device (other devices lose their sessions
server-side, so their browsers have no way to know why); a later reload still shows it because the
query persists, but it disappears once the user signs in; if the host's global 401 handling navigates
first within those 2.5 s, the notice can be lost (worst case: an ordinary login card — no security or
functional impact); and until the host offers an icon API the nav row keeps the default gear.

## Migration conditions (what to do when the host upgrades)

| Trigger                                                                                           | Action                                                                                                                                                             |
| :------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The host adds an `icon` option to `settings.section`, or `navIcon` learns `dsh-auth-gate-account` | Switch to the official API for the icon; the self-drawn content-area mark can then be removed (avoid two marks on one screen)                                      |
| Another plugin also registers `order: 900`                                                        | We step aside to 901/902 (first come, first served, as above)                                                                                                      |
| The host adds a tie-breaker to nav sorting (e.g. by id)                                           | 900 stays valid; do not fight for "last"                                                                                                                           |
| The host's global 401 handling navigates first within those 2.5 s                                 | The notice is lost and the page degrades to an ordinary login card (no security impact, known)                                                                     |
| The official cloud-account section is labelled "Account" in every locale                          | The label "Account security" plus the content-area "local sign-in credentials" line already separate the semantics; **do not** take the id to grab the person icon |
| The host unmounts the section that shows the success state                                        | The redirect survives because its timer is module-scoped (see `account-redirect.ts`)                                                                               |
