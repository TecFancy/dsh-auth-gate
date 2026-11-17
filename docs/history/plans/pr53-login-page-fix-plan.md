# PR #53 Login Page Takeover Fix Plan

> Status: pending review, not started. This document is authoritative until it lands; any deviations after a decision are recorded in the "Resolutions" section at the end.
>
> Scope: cleanly merge BuvkB's
> [#53](https://github.com/TecFancy/dsh-auth-gate/pull/53)
> Apple-style login page + `Accept-Language` zh/en localization into the current
> `development` (which includes `logoutOrder` / config skill), with all gates green and the squash
> authorship left to the contributor.
>
> Reference: the visual baseline is `docs/implemented/login-page-polish-plan.md` (the landed WCAG AA /
> autofocus / reduced-motion); this round is a **port of another contribution branch + gate fixes**,
> not a continuation of that plan.

---

## 1. Background & Conclusion

PR #53 is a single commit `6b6889b` by BuvkB (email
`19549719+BuvkB@users.noreply.github.com`), branch
`feat/login-page-localization`, based on `main` at the time = `v0.9.1` (`0bd0592`).
The local ref `pr53` points to the same SHA.

**Conclusion first:**

- **Mergeable, but it must be ported — do not cherry-pick / directly merge the original commit.** The original branch would
  revert `logoutOrder`, the `/auth/status` JSON, and several harness bits.
- **No security blockers**: `next` / `error` still go through `escapeHtml`; fonts are data-uris; no CDN /
  external links; no credential logging.
- **Gates are currently red**: prettier, lint, type-check, `max-lines`, no new tests, `lib/` stale.
- **Accessibility regression**: the WCAG AA work just landed in `9dd09de` would be undone by this version's color scheme and must be restored in the same fix.

What the contributor got right (keep):

- Apple-style minimalism: `#f5f5f7` gradient, white rounded card, pill inputs/buttons;
- DeepSeek branding: whale wordmark + HARNESS badge SVG replica;
- slogan blend cursor (`mix-blend-mode: difference`) + `prefers-reduced-motion` +
  touch `(hover: hover)` fallback;
- `loginStrings(lang)` zh/en copy; zero external resources.

---

## 2. Scope / Non-Scope

### 2.1 Do

- Login page visuals (Apple card, whale wordmark, slogan, pill inputs, cursor ring);
- `loginPageHtml` / `passwordLoginPageHtml` third parameter `lang`;
- Choose `zh | en` from `Accept-Language`;
- Split files to pass `max-lines` 250, fix lint/type, add tests, contrast, regenerate `lib/`, README demo image.

### 2.2 Explicitly Not Doing

- Do not change login POST semantics (failure is still `401 text/plain`; the error is not rendered into the HTML — status quo);
- Do not change `logoutOrder`, skill dispatch, proxy, session/cookie, `validateNext`;
- Do not take in the PR's `package-lock.json` / stale `lib/`;
- Do not hand-edit `version` / `CHANGELOG.md` / `.release-please-manifest.json`;
- Do not relax ESLint limits (file ≤250, function ≤80, complexity ≤15);
- Do not introduce Playwright into the repo's tests (real-device demos are manual/CLI steps after verify).

---

## 3. Branch & Merge Strategy

Recommended: **port on `development`, then push back to `feat/login-page-localization` and let #53
update itself.** The squash author remains BuvkB by default.

```
1. git checkout development && git pull
2. git checkout -b fix/pr53-login-page
3. port + fix per the §4 file list (do not git cherry-pick 6b6889b)
4. npm run verify green; after npm run build, commit lib/ in the same change
5. git checkout feat/login-page-localization
   git merge origin/development     # keep the logoutOrder side
   # conflict resolution per §3.1
   checkout the already-fixed src/ tests and docs from fix/pr53-login-page
   npm run build && npm run verify
6. git push origin feat/login-page-localization
   (#53 updates automatically)
```

Alternative (not recommended): close #53 and open a new PR from `development`. The author becomes the maintainer; only a
`Co-authored-by: BuvkB <19549719+BuvkB@users.noreply.github.com>` line records the contribution.
Corresponds to decision item **D** (§10).

Merging into `main` is still squash, keeping the contributor's original title, or switching to the shorter
`feat(login): Apple-style login page with zh/en localization` (decide when the decision is made).
Path: #53 turns green → squash into `main` → release-please opens 0.11.0. Do not merge `development` into `main`
from #53 first.

### 3.1 Conflict Resolution (Step 5)

| File                                              | Take                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/login-page.ts` and the new split-out files   | The fixed ported version                                                                                                             |
| `src/auth-endpoints.ts` / `password-endpoints.ts` | **`development`'s `logoutOrder` + status JSON**, only add the `langOf` call                                                          |
| Test harness `logoutOrder: 1000`                  | development                                                                                                                          |
| `lib/**`                                          | Regenerate locally with `npm run build`; keep no PR artifacts                                                                        |
| `package-lock.json`                               | development, untouched                                                                                                               |
| `docs/screenshots/*.png`                          | Can stay temporarily as design reference; the official demo image goes through `docs/demo/login-page.png` (retaken on a real device) |

A real `git diff development pr53 -- src/auth-endpoints.ts` deletes the
`logoutOrder` field and `JSON.stringify({ authenticated, logoutOrder })` — a hard conflict,
handled as "development wins + add lang".

---

## 4. File-Level Changes

### 4.1 Split Files (Pass `max-lines` 250)

The PR version of `login-page.ts`: **298 lines / ~83KB** (two woff2 ≈ 39KB + whale SVG ≈ 15KB).
ESLint `max-lines` counts with skipBlankLines + skipComments; measured **253 > 250**.

The fonts are ultra-long **single lines**, so splitting out constants alone barely reduces the count; the excess comes from CSS / scripts / i18n / rendering.
Split into 4 files:

| File                             | Responsibility                                                                   | Budget                          |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| `src/login-page-assets.ts` (new) | `@font-face` CSS, `SHIELD_SVG`, eye/user/lock SVG, `EYE_SCRIPT`, `CURSOR_SCRIPT` | constants mostly, far below 250 |
| `src/login-page-i18n.ts` (new)   | `LoginLang`, `loginStrings()`, the **single** `langOf(req: IncomingMessage)`     | ~40 lines                       |
| `src/login-page-style.ts` (new)  | `CARD_STYLE` (references the fonts CSS)                                          | ~60 lines                       |
| `src/login-page.ts` (modified)   | `escapeHtml`, `renderLoginCard`, the two exports                                 | ~120 lines                      |

Public API:

```ts
loginPageHtml(next: string, error?: string, lang?: LoginLang): string;
passwordLoginPageHtml(next: string, error?: string, lang?: LoginLang): string;
```

The third parameter defaults to English (same as the current default page). **Do not** write `langOf` into the two
endpoints again (that is the PR's duplication and the source of TS2345).

The `src/` tree in `docs/specs/development.md` just needs a line added for the new file names when landing (a `docs:`
commit; does not trigger a release). This plan document itself does not pre-modify development.md.

### 4.2 `langOf` (Fix Type-Check + Lint)

Put it in `src/login-page-i18n.ts`:

```ts
export type LoginLang = "zh" | "en";

export function langOf(req: IncomingMessage): LoginLang {
  const raw = req.headers["accept-language"];
  const header = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  if (/^\s*zh/i.test(header) || /,\s*zh/i.test(header)) return "zh";
  return "en";
}
```

Problems fixed accordingly:

| Current state                                                                                                                      | Handling                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Parameter typed as `{ headers?: { [k: string]: string \| undefined } }`, can't accept `IncomingMessage` (values can be `string[]`) | Use `IncomingMessage` directly         |
| `try/catch` + unused `_e`                                                                                                          | Remove; parsing cannot throw           |
| Two copies (auth / password endpoints)                                                                                             | Keep only one                          |
| `htmlLang \|\| 'en'` / `securedBy \|\| '...'`                                                                                      | Change to `??`, Prettier double quotes |
| `consistent-indexed-object-style`                                                                                                  | Disappears with the type rewrite       |

Matching rules keep the contributor's semantics: `zh`, `zh-CN`, `zh-TW`, `en,zh;q=0.9` → zh; everything else → en.

### 4.3 Endpoints (Add a Single Wiring Line)

`serveLoginPage` in `src/auth-endpoints.ts`:

```ts
res.end(loginPageHtml(next, undefined, langOf(req)));
```

Same for the GET branch of `src/password-endpoints.ts`.

**Must keep** what `development` already has:

- `logoutOrder: number` on deps;
- `JSON.stringify({ authenticated, logoutOrder: deps.logoutOrder })`.

### 4.4 Rendering Layer: Keep the Contributor's Design, Fix Gates / Accessibility

Keep from the PR:

- Apple background / white card / pill inputs / black button;
- DeepSeek whale + HARNESS badge SVG;
- zh/en `loginStrings` + slogan (`探索未至之境` / `Into the Unknown`);
- blend cursor + `prefers-reduced-motion` + `(hover: hover)` touch fallback (decision item **C**);
- `aria-label` on inputs (the autofocus assertion will change; update the tests together);
- zero external links (font data-uris, decision item **B**).

In `renderLoginCard`, use `??` for `htmlLang` / `securedBy`; `sloganHtml` keeps taking only
`escapeHtml(brandText)`. Whether the visible label is restored is decision item **A**.

### 4.5 Colors That Must Change (Measured Relative Luminance)

Contrast uses the WCAG relative-luminance formula `(L1+0.05)/(L2+0.05)`. Text threshold 4.5:1; non-text UI
boundaries (1.4.11) 3:1. Same algorithm as §2 of `docs/implemented/login-page-polish-plan.md`.

| Role                                                           | PR color    | Measured     | Change to                                                 | After         |
| -------------------------------------------------------------- | ----------- | ------------ | --------------------------------------------------------- | ------------- |
| Subtitle `#86868b` on `#fff` / `#f5f5f7`                       | 3.62 / 3.33 | < 4.5        | `#6e6e73`                                                 | 5.07 / 4.66   |
| Footer / placeholder `#a1a1a6`                                 | 2.36–2.57   | far below AA | `#6e6e73`                                                 | same as above |
| Input border (transparent border + `#f5f5f7` bg vs white card) | 1.09        | < 3.0        | `1px solid #8a919a` (consistent with current development) | ~3.2          |

The button's white text on `#0f1115` (18.9:1) and the error bar `#b91c1c` on `#fff5f5` (6.05:1) already pass;
leave them. The icon `#86868b` on the input background `#f5f5f7` is 3.33:1, above 1.4.11's 3:1, so it can stay.

---

## 5. Test Checklist

Principle: HTML contracts go into pure-function tests; endpoints only test the single "header → language" hop. `describe` callbacks count
80 lines against `max-lines-per-function`; keep splitting large blocks. The repo already has the precedent of extracting the GET `/auth/status`
into `*-endpoints.status.test.ts` files.

### 5.1 New `src/login-page.test.ts`

**Move over** the existing HTML cases from `src/auth-endpoints.methods.test.ts` /
`src/password-endpoints.methods.test.ts` (the methods files get slimmer afterward, avoiding 250 again):

- error escaping / `.error` not rendered without an error / hidden `next` escaping;
- token: `autofocus` (change the assertion to the one with `aria-label="Access token"`, adjusted with decision A);
- password: username/password autocomplete; **only** password has autofocus.

Add new:

- default `lang` → `lang="en"`, English copy, `Paste your token` / `Sign in`;
- `lang: "zh"` → `lang="zh"`, zh copy, English placeholder **must not appear**;
- slogan text is escaped;
- contains `prefers-reduced-motion`, no `http://` font URL (guards zero external links);
- subtitle/footer CSS contains `#6e6e73` (prevents AA regression).

### 5.2 New `src/login-page-i18n.test.ts`

`langOf` matrix (construct a minimal `IncomingMessage`):

| Accept-Language                                    | Expected |
| -------------------------------------------------- | -------- |
| missing / `""` / `en` / `en-US`                    | `en`     |
| `zh` / `zh-CN` / `zh-TW`                           | `zh`     |
| `en,zh;q=0.9`                                      | `zh`     |
| `zh-CN,zh;q=0.9,en;q=0.8`                          | `zh`     |
| array header `["zh-CN","en"]` (occasional in Node) | `zh`     |

### 5.3 Endpoint Wiring (One Each, Into the Existing GET describes)

Add an optional `acceptLanguage` to `makeReq` in `src/auth-endpoints.test.ts` (239 lines) and
`src/password-endpoints.test.ts` (236 lines), written into `headers["accept-language"]`:

- `Accept-Language: zh-CN` → body contains the zh title/button;
- no such header → English.

Count skipBlank before adding tests; if over, split the GET describe into
`src/auth-endpoints.login-page.test.ts` (or the password counterpart). **Forbidden** to copy another
150-line harness unless splitting files is unavoidable.

The existing GET cases only assert `<form` / `name="username"` / hidden next escaping; they should stay green after the port.

### 5.4 Not Changed

- POST 401 / rate-limit / session cases;
- integration (`src/integration.auth.test.ts` etc. only assert `<form`), should stay green;
- no DOM-parsing dependency; keep pure string `toContain`.

---

## 6. Documentation & Demos

`docs/specs/development.md` "GUI demos": user-visible Web behavior must come with a real-device demo — a real
server, a clean browser, non-mocked transport — with a note next to the demo stating what it proves.

| Action                                    | Notes                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Retake `docs/demo/login-page.png`         | web-test real device (password mode); replaces the current one in README                  |
| The PR's 4 `docs/screenshots/login-*.png` | May stay as design reference; **not** DoD evidence (not produced by this tree of commits) |
| README / README.zh demo image paths       | Still point to `docs/demo/login-page.png`; change the image, not the path                 |
| Prose contracts                           | Describe only current behavior; no "this PR / used to" language                           |

Optional one-liner (only if the README login section needs it): the login page switches between zh and en based on `Accept-Language`.
It is not a config option; no need to add it to the config table.

---

## 7. Verification Steps (In Order)

1. `npx prettier --write` the changed files (or rely on the pre-commit hook).
2. `npm run lint` — no `max-lines` / unused / `||` / index signatures.
3. `npm run type-check`.
4. Run the affected files first, then full coverage:
   ```
   npm run test -- src/login-page.test.ts src/login-page-i18n.test.ts \
     src/auth-endpoints.test.ts src/auth-endpoints.methods.test.ts \
     src/password-endpoints.test.ts src/password-endpoints.methods.test.ts
   npm run test:coverage
   ```
   Coverage red line 80%; the new files must be covered.
5. After `npm run build`, `git diff --exit-code -- lib`.
6. Full `npm run verify` (format:check + lint + type-check + test:coverage + lock:check).
7. **Real device**: web-test (3081, password, `tester`)
   - browser language zh → zh login page;
   - `curl -H 'Accept-Language: en' http://127.0.0.1:3081/auth/login` → English;
   - login succeeds; error 401 still plain text (behavior unchanged);
   - with the system's "reduce motion" on, no cursor-ring zoom / entrance animation;
   - capture `docs/demo/login-page.png`.

---

## 8. Commit / Release

- Pushing to #53 may be multiple commits; **merging into `main` is still squash**
  (`gh pr merge 53 --squash`), one conventional commit per PR, so release-please
  does not double-count.
- Do not hand-edit `version` / `CHANGELOG.md` on the feature branch.
- The maintainer reviews the real-device demo / screenshots before merging; **if the visuals are not acceptable, stop and do not release**.

---

## 9. DoD

1. §4 file splits and wiring are in place; `logoutOrder` / status JSON not regressed.
2. §4.5's three contrast fixes pass; the zero-external-links contract still holds.
3. §5 tests all green (moved cases + i18n matrix + endpoint wiring).
4. `npm run verify` all green; `lib/` committed in the same batch as `src/`, `git diff --exit-code -- lib` passes.
5. Real-device demo captured in `docs/demo/login-page.png`, with a note covering zh/en, reduced-motion,
   and focus placement.
6. §2.2 untouched.
7. #53 CI green; squash author is BuvkB (if D1 is chosen).

---

## 10. Decisions Pending (Before Work Starts)

These change §4 / §5 details. Defaults are **A1 + B1 + C1 + D1**.

### A. Form Labels

- **A1 (recommended)**: restore visible labels (small text above the inputs), placeholder as a hint. Satisfies
  WCAG 3.3.2 and matches the current development page.
- **A2**: keep the contributor's "icon + placeholder + aria-label only" (more Apple-like; the visible
  label is gone).

### B. Embedded Fonts ~39KB HTML

- **B1 (recommended)**: keep the Host Grotesk + Montserrat data-uris (zero external network; the contributor's branding intent).
- **B2**: remove `@font-face`, use only `system-ui` / PingFang (the page gets lighter, but the slogan suffers a bit).

### C. Blend Cursor

- **C1 (recommended)**: keep it; touch / reduced-motion already have fallbacks.
- **C2**: remove `CURSOR_SCRIPT`, one less block of inline JS.

### D. Merge Channel

- **D1 (recommended)**: after fixing, push back to #53; squash author is BuvkB.
- **D2**: close #53, open a new PR from `development` (maintainer as author + Co-authored-by).

---

## 11. Resolutions (Fill In After Decisions Are Made)

| Item             | Choice                                      | Date |
| ---------------- | ------------------------------------------- | ---- |
| A Form labels    | _To be filled in_                           |      |
| B Embedded fonts | _To be filled in_                           |      |
| C Blend cursor   | _To be filled in_                           |      |
| D Merge channel  | _To be filled in_                           |      |
| Squash title     | _To be filled in_ (keep original / shorten) |      |
