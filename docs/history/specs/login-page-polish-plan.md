# Login Page Visual Polish Implementation Plan

> Scope: only `src/login-page.ts` (the `renderLoginCard`/`CARD_STYLE` shared by both the
> token variant `loginPageHtml` and the password variant
> `passwordLoginPageHtml`). It does not touch routes or business logic in
> `auth-endpoints.ts`/`password-endpoints.ts`/`password-login.ts` etc., because login-page
> rendering and submit handling are two separate layers; this round only touches the
> rendering layer.

---

## 1. Background and Goals

`src/login-page.ts` is the self-contained login page frozen in M2/M3 (both the token and
password variants share the same set of inline styles — zero third-party resources, no
external fonts, its behavior was already written into `docs/implemented/impl-m2.md` §4.4 and
`docs/implemented/impl-m3.md` P13/4.6). A manual review of this file was previously done,
which found several visual and accessibility issues: the button/footer/input-border contrast
is insufficient, the `autofocus` attribute is missing (a violation of the frozen contract),
the error-message styling is sparse, there is no `:focus-visible` state, and
`prefers-reduced-motion` is not honored.

This document consolidates the review conclusions into a directly executable list of
changes, with the goals:

- Bring the login page up to the WCAG 2.1 AA text and non-text contrast thresholds, while
  keeping it "self-contained, zero-dependency, zero-third-party-resource";
- Restore the `autofocus` behavior that M2/M3 explicitly require but the current
  implementation omits;
- Improve the usability of the error message, focus state, and motion degradation without
  changing any HTML structure assertions (the exact substrings the tests depend on).

---

## 2. Current Issue List (with quantifiable contrast data)

Contrast is computed with the WCAG relative-luminance formula (`(L1+0.05)/(L2+0.05)`, L =
sRGB relative luminance). Text contrast thresholds: body text 4.5:1, large text (≥24px
regular or ≥18.66px bold) 3:1; non-text/UI component boundaries (WCAG 1.4.11) 3:1.

| #                 | Issue                                | Location (`src/login-page.ts`)                                                                         | Current color value                                                                                              | Measured contrast | Threshold                                                                                                                                                                                                       | Conclusion                                                                   |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1                 | `autofocus` attribute missing        | `renderLoginCard`/`LoginCardOptions.fields`, lines 78-108                                              | —                                                                                                                | —                 | M2 §4.4 requires `autofocus` on the token input; M3 P13 requires the password form's **password field** to carry `autofocus`                                                                                    | Violates the frozen contract; neither field currently has the attribute      |
| 2                 | Input-border contrast too low        | `input { border: 1px solid #d9dce1; }` line 28                                                         | `#d9dce1` vs card background `#fff`                                                                              | **≈1.38:1**       | 3:1 (non-text UI boundary)                                                                                                                                                                                      | Far below threshold; the input outline is almost invisible on the white card |
| 3                 | Submit-button text contrast low      | `button[type=submit] { background: #4d6bfe; color: #fff; font-size: 15px; font-weight: 600; }` line 36 | White `#fff` on `#4d6bfe`                                                                                        | **≈4.33:1**       | 4.5:1 (body text; 15px/600 does not reach the large-text bold threshold of 18.66px)                                                                                                                             | Does not pass; the gap is small but genuinely non-compliant                  |
| 4                 | Footer text contrast too low         | `footer { color: #9aa0a6; }` / `footer a { color: #9aa0a6; }` lines 40-41                              | `#9aa0a6` vs page background `#f7f8fa`                                                                           | **≈2.48:1**       | 4.5:1                                                                                                                                                                                                           | Clearly non-compliant; the footer is almost unreadable                       |
| 5                 | Input placeholder contrast low       | `input::placeholder { color: #9aa0a6; }` line 30                                                       | `#9aa0a6` vs `#fff`                                                                                              | ≈2.64:1           | Not mandatory (SC 1.4.3 does not cover placeholders), but improving readability is recommended                                                                                                                  | Weak experience, non-blocking                                                |
| 6                 | Error-message styling sparse         | `.error { color: #dc2626; font-size: 13px; margin: 0 0 16px; text-align: center; }` line 39            | `#dc2626` vs `#fff` ≈4.83:1 (passes but has no visual container)                                                 | —                 | Plain centered text, no background/border, low salience, does not match the severity of the information                                                                                                         |
| 7                 | No `:focus-visible` state            | `button[type=submit]`, `.eye`, `footer a` all have no custom focus state                               | —                                                                                                                | —                 | The focus language diverges from the `input:focus` brand-color ring; the feel is inconsistent when operating via keyboard                                                                                       |
| 8                 | `prefers-reduced-motion` not honored | `transition` on `input`/`button[type=submit]`, `:active { transform: scale(.99) }`                     | —                                                                                                                | —                 | No degradation path for users who enable the "reduce motion" system setting                                                                                                                                     |
| 9 (extra finding) | Brand-icon color not explicitly set  | `.brand { background: linear-gradient(...); }` line 22, `SHIELD_SVG` uses `stroke="currentColor"`      | No ancestor element sets `color`, so `currentColor` falls back to the browser default text color (usually black) | —                 | The shield icon on the gradient badge is likely rendered with a black stroke instead of the intended white — a visual break (newly found while re-reading the source styles; folded into this round of changes) |

---

## 3. Scope Split

### P0 (must fix — violates the frozen contract or is clearly non-compliant)

1. Restore `autofocus` (issue 1).
2. Input-border contrast (issue 2).
3. Submit-button text contrast (issue 3).
4. Footer text contrast (issue 4).
5. Brand-icon color (issue 9).

### P1 (clear visual/usability improvement, changes no frozen decision)

1. Placeholder contrast (issue 5).
2. Error-message styling (issue 6).
3. `:focus-visible` unification (issue 7).

### P2 (polish)

1. `prefers-reduced-motion` degradation (issue 8).

---

## 4. Per-Item Change Details

All changes land in the single file `src/login-page.ts`: the `CARD_STYLE` template string's
selectors/color values, the `LoginCardOptions` interface, the field-rendering logic inside
`renderLoginCard`, and the call arguments of `loginPageHtml`/`passwordLoginPageHtml`. No
new files, no new SVG icon constants (`SHIELD_SVG`/`EYE_OPEN_SVG`/`EYE_CLOSED_SVG` themselves
stay unchanged; only `.brand` needs to provide the correct `currentColor` source).

### 4.1 P0 — Restore `autofocus` (interface + rendering-logic change)

**`LoginCardOptions.fields` element type** (lines 82-89) gains an optional field:

```ts
// Before
fields: {
  id: string;
  label: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  type: "text" | "password";
}[];

// After
fields: {
  id: string;
  label: string;
  name: string;
  autocomplete: string;
  placeholder: string;
  type: "text" | "password";
  /** Required by the frozen M2 §4.4 / M3 P13 contract: the token field and the password form's password field need it. */
  autofocus?: boolean;
}[];
```

**`renderLoginCard` field rendering** (lines 100-108) appends ` autofocus` on demand when
building the `input` string:

```ts
// Before
const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required>`;

// After
const autofocusAttr = field.autofocus === true ? " autofocus" : "";
const input = `<input id="${field.id}" type="${field.type}" name="${field.name}" autocomplete="${field.autocomplete}" placeholder="${field.placeholder}" required${autofocusAttr}>`;
```

**`loginPageHtml`** (lines 138-156, token variant, single field) marks the only field as
`autofocus: true`:

```ts
fields: [
  {
    id: "token",
    label: "Access token",
    name: "token",
    autocomplete: "current-password",
    placeholder: "Paste your token",
    type: "password",
    autofocus: true,
  },
],
```

**`passwordLoginPageHtml`** (lines 159-185, password variant, two fields) follows M3 P13's
exact frozen wording: the `username` field does **not** carry `autofocus`, the `password`
field does:

```ts
fields: [
  {
    id: "username",
    label: "Username",
    name: "username",
    autocomplete: "username",
    placeholder: "Enter your username",
    type: "text",
    // No autofocus set: the per-field semantics are frozen by M3 P13, focus lands on the password field
  },
  {
    id: "password",
    label: "Password",
    name: "password",
    autocomplete: "current-password",
    placeholder: "Enter your password",
    type: "password",
    autofocus: true,
  },
],
```

> Note: this is inconsistent with the common intuition of "focus the first empty field
> first", but `docs/implemented/impl-m3.md` P13 explicitly writes `autofocus` into the
> `<input>` contract of the password field; it is a frozen decision, and this round does
> not re-evaluate it — it only fills in the missing implementation.

### 4.2 P0 — Input-border contrast

The `input` selector in `CARD_STYLE` (line 28):

```css
/* Before */
input { ...; border: 1px solid #d9dce1; ...; }

/* After */
input { ...; border: 1px solid #8a919a; ...; }
```

`#8a919a` vs card background `#fff` is ≈3.18:1, meeting the WCAG 1.4.11 non-text 3:1
threshold. The `input:focus` brand-color outline (`border-color: #4d6bfe; box-shadow: ...`,
line 29) stays unchanged.

### 4.3 P0 — Submit-button text contrast

`button[type=submit]` (lines 36-38):

```css
/* Before */
button[type=submit] { ...; background: #4d6bfe; ...; }
button[type=submit]:hover { background: #4059e0; }

/* After */
button[type=submit] { ...; background: #4059e0; ...; }
button[type=submit]:hover { background: #34479c; }
```

White `#fff` on `#4059e0` is ≈5.64:1 (passes); the hover state `#34479c` is ≈8.31:1 (more
headroom, and the visual hierarchy on hover is also clearer). `:active { transform: scale(.99) }`
stays unchanged.

### 4.4 P0 — Footer text contrast

`footer`/`footer a`/`footer a:hover` (lines 40-42):

```css
/* Before */
footer {
  margin-top: 20px;
  font-size: 12px;
  color: #9aa0a6;
  text-align: center;
}
footer a {
  color: #9aa0a6;
  text-decoration: none;
}
footer a:hover {
  color: #6b7280;
  text-decoration: underline;
}

/* After */
footer {
  margin-top: 20px;
  font-size: 12px;
  color: #6b7280;
  text-align: center;
}
footer a {
  color: #6b7280;
  text-decoration: none;
}
footer a:hover {
  color: #4b5563;
  text-decoration: underline;
}
```

Default state `#6b7280` vs `#f7f8fa` is ≈4.55:1 (passes); hover state `#4b5563` is ≈7.11:1.

### 4.5 P0 — Brand-icon color

Add a `color` to `.brand` (line 22) so that `SHIELD_SVG`'s `stroke="currentColor"` resolves
to white instead of the browser default text color:

```css
/* Before */
.brand {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4d6bfe, #7c5cff);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}

/* After */
.brand {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #4d6bfe, #7c5cff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}
```

The `SHIELD_SVG` constant itself needs no change (still `stroke="currentColor"`, only now it
has a correct ancestor `color` source).

### 4.6 P1 — Placeholder contrast

`input::placeholder` (line 30):

```css
/* Before */
input::placeholder {
  color: #9aa0a6;
}

/* After */
input::placeholder {
  color: #7d8590;
}
```

`#7d8590` vs `#fff` is ≈3.73:1; although not a mandatory item, it is clearly more readable
than the original ≈2.64:1.

### 4.7 P1 — Error-message styling (HTML structure unchanged, CSS only)

The `errorHtml` concatenation inside `renderLoginCard` **must not change**
(`auth-endpoints.methods.test.ts` and `password-endpoints.methods.test.ts` both assert the
exact substring `<p class="error">bad &lt;script&gt; &amp; &quot;quotes&quot;</p>`, so no
child element/attribute may be inserted inside the tag); only adjust the `.error` CSS
(line 39):

```css
/* Before */
.error {
  color: #dc2626;
  font-size: 13px;
  margin: 0 0 16px;
  text-align: center;
}

/* After */
.error {
  color: #b91c1c;
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 16px;
  padding: 10px 12px;
  background: #fff5f5;
  border: 1px solid #fecaca;
  border-radius: 8px;
  text-align: left;
}
```

The text color darkens from `#dc2626` (≈4.83:1 on the white card) to `#b91c1c`, which on the
new background `#fff5f5` is ≈6.05:1, with more headroom; the background/border give the
error message an independent visual container, so it is no longer a lone line of red text
"floating" in blank space. `text-align` changes from centered to left, which together with
the padding forms a "notice-card" look (a purely stylistic choice; it affects no assertion).

### 4.8 P1 — `:focus-visible` unification

Add three rules (either at the end of `CARD_STYLE` or before `@media (max-width: 420px)`):

```css
button[type="submit"]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(77 107 254 / 30%);
}
.eye:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgb(77 107 254 / 30%);
}
footer a:focus-visible {
  outline: 2px solid #4d6bfe;
  outline-offset: 2px;
}
```

The existing brand-color ring of `input:focus` (line 29) keeps using `:focus` (an input
gaining focus is itself a meaningful state; there is no need to distinguish
keyboard/mouse); the button, icon button, and footer links switch to `:focus-visible`, so a
stray ring no longer lingers after a mouse click, while keyboard Tab navigation still gets a
brand-color visual language consistent with the input.

### 4.9 P2 — `prefers-reduced-motion`

Append at the end of `CARD_STYLE`:

```css
@media (prefers-reduced-motion: reduce) {
  input,
  button[type="submit"] {
    transition: none;
  }
  button[type="submit"]:active {
    transform: none;
  }
}
```

---

## 5. Test List That Needs Synchronous Updates

Conclusion first: **this round needs no changes to any existing test assertion**, because all
CSS color values/focus states/motion degradation are outside any test's string-assertion
range, and the `errorHtml`/hidden-`next` HTML structure stays verbatim unchanged (see the
hard constraint in §4.7). File-by-file:

| File                                                                        | Affected?               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/auth-endpoints.test.ts`                                                | No                      | GET `/auth/login` only asserts `toContain("<form")`, does not involve style/autofocus                                                                                                                                                                                                                                                                                                                                                            |
| `src/auth-endpoints.methods.test.ts`                                        | No (new case suggested) | The 3 cases for `loginPageHtml` only assert the presence/absence of `<p class="error">`/`class="error"` and the hidden-`next` escaping; none are affected. **Recommended** to add an `it` asserting `loginPageHtml("/")` contains `autofocus` (e.g. `expect(html).toContain('placeholder="Paste your token" autofocus>')` or, more loosely, `toContain(" autofocus>")`), pinning M2 §4.4's frozen requirement into a regression test             |
| `src/password-endpoints.test.ts`                                            | No                      | GET `/auth/login` (password variant) only asserts `name="username"`/`name="password"`/`<form`                                                                                                                                                                                                                                                                                                                                                    |
| `src/password-endpoints.methods.test.ts`                                    | No (new case suggested) | The 4 cases for `passwordLoginPageHtml` assert the field names/`autocomplete`/error paragraph/hidden `next`; none are affected. **Recommended** to add a case asserting respectively that the `password` field carries `autofocus` and the `username` field does not (e.g. assert the `username` `<input ...>` substring does not contain `autofocus`, and the `password` one does), pinning M3 P13's per-field semantics into a regression test |
| `src/auth-endpoints.login.test.ts` / `src/password-endpoints.login.test.ts` | No                      | Only cover the POST submit path (302/401/429/503 etc.), do not render/assert the login-page HTML                                                                                                                                                                                                                                                                                                                                                 |
| `src/integration.auth.test.ts`                                              | No                      | Only asserts `toContain("<form")`                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/integration.password.test.ts`                                          | No                      | Only asserts `toContain('name="username"')`                                                                                                                                                                                                                                                                                                                                                                                                      |

The two new cases are recommended to be added directly inside the corresponding
`describe("loginPageHtml", ...)` / `describe("passwordLoginPageHtml", ...)` blocks, keeping
the same style as the existing escaping cases (pure string `toContain` assertions, no
DOM-parsing dependency introduced).

---

## 6. Verification Steps

1. `npm run verify` (format:check + lint + type-check + coverage ≥80% + lock:check) must
   fully pass. The changes only touch string concatenation and the CSS template, so the
   coverage red line is not expected to be affected, but a full run is still needed to
   confirm.
2. Run the affected test files individually to confirm the HTML-structure assertions still
   hold (faster than a full `verify` for locating issues):
   ```
   npm run test -- src/auth-endpoints.test.ts src/auth-endpoints.methods.test.ts src/password-endpoints.test.ts src/password-endpoints.methods.test.ts
   ```
3. `npm run build`: after changing `src/login-page.ts`, `lib/` must be regenerated and
   committed together with the `src/` change (`AGENTS.md` "Verifying a change actually works"
   item 2; CI runs `git diff --exit-code -- lib` to check for drift).
4. Per the `docs/specs/development.md` "GUI demos" convention: the login page is a
   user-visible Web behavior, so the change needs a demo recorded from a real flow (a
   really started server, clean browser state, non-mocked transport), and the demo notes
   must state clearly what it proves (it should cover at least: the focus landing point on
   first load of both the token page and the password page, the error-message state, and the
   focus ring when Tab-keyboard-navigating to the button/footer links).
5. Suggested commit messages (following `AGENTS.md`'s `type(scope): subject` convention,
   with `scope` as the module name `login-page`):
   - A single commit: `fix(login-page): restore autofocus and raise contrast to WCAG AA`
     (all five P0 items bundled; the `fix` type triggers a release-please version commit,
     because "restore autofocus" among them is a fix of a deviation from the frozen
     contract).
   - If landing in batches, you can split out a `style(login-page): unify focus-visible and error affordance`
     covering P1 and a `chore(login-page): respect prefers-reduced-motion` covering P2
     (neither `style`/`chore` triggers a release, consistent with the "purely visual polish"
     positioning).
   - No matter how many commits, `lib/` must always be in the same commit as the
     corresponding `src/login-page.ts` change.

---

## 7. Explicitly Not Done

- No third-party resources are introduced (icon libraries, font CDNs, CSS frameworks);
  `CARD_STYLE` continues to be a purely inline string.
- No external fonts; the system font stack of `font-family` stays unchanged.
- No changes to the M2/M3-frozen route/session/validation logic: `auth-endpoints.ts`,
  `password-endpoints.ts`, `password-login.ts`, `token-gate.ts`,
  `password-gate.ts`, cookie/session semantics, the `validateNext` rules, etc. are all
  untouched.
- No change to any field shape of `LoginCardOptions` except `autofocus?: boolean`, and no
  change to the export signatures of `loginPageHtml`/`passwordLoginPageHtml`.
- No JS framework or client-side state management is introduced; the `EYE_SCRIPT`
  progressive-enhancement script stays as-is, no new behavior is added.
- No new SVG icon constants and no change to the path data of the existing three SVG
  strings; only `.brand` provides a correct `color` for `currentColor` to consume.
- No changes to selectors that this review found no contrast issues with, such as
  `.card`/`.field`/`.label`/`h1`/`.subtitle`.
- ESLint complexity/line-count limits are not relaxed to satisfy this change (file ≤250
  lines, function ≤80 lines, complexity ≤15); after the change, `login-page.ts` should be
  re-confirmed still within budget (186 lines before the change; the new CSS rules and
  `autofocus` logic are expected to add about 15-20 lines in total, leaving ample headroom).

---

## 8. DoD (Definition of Done)

1. `src/login-page.ts` lands all the §4 P0 + P1 + P2 items (or at least P0 + P1; whether P2
   is done in the same round is a time decision, but the scope must be stated clearly in the
   commit message).
2. The two new regression cases listed in §5 (the token/password `autofocus` assertions) are
   added to `src/auth-endpoints.methods.test.ts` / `src/password-endpoints.methods.test.ts`
   and are green.
3. `npm run verify` is fully green.
4. `npm run build` has been run, `lib/` and the `src/` changes are in the same batch of
   commits, and `git diff --exit-code -- lib` passes.
5. A real-flow demo has been recorded per the `docs/specs/development.md` "GUI demos"
   convention, stating which points it verifies (focus landing point, error state,
   focus-visible keyboard navigation).
6. None of the scope listed in §7 "Explicitly Not Done" is touched.
7. The commit message conforms to `AGENTS.md`'s commitlint convention, `lib/` and `src/` are
   committed in the same batch, and nothing is pushed without the user's instruction.
