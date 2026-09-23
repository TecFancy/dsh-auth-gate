# D21. Token-mode login failures render the login card (HTML), not a bare `text/plain` page

## Decision

A wrong shared access token keeps its frozen status code but stops answering with a machine-readable
body:

- **`POST /auth/login` with an invalid token** stays **401** + `cache-control: no-store`, but becomes
  `content-type: text/html; charset=utf-8` and re-renders the existing token card with the error slot
  filled by the single constant `Invalid access token.` (`INVALID_TOKEN`, exported by
  `src/features/token/auth-endpoints.ts`). The token field keeps `autofocus`, gains
  `aria-invalid="true" aria-describedby="err"`, and `<title>` gains the `Error: ` prefix — the shared
  renderer already does the last two whenever `error !== undefined`. The submitted token is **never**
  echoed: the field carries no `value` attribute (D20's username echo has no analogue here — echoing a
  secret back into the page, the response cache and the browser history is a disclosure, and the
  field's content is not needed to complete the retry).
- The anti-phishing identity block keeps rendering through
  `resolvePublicHost(publicHost, host)` exactly as the GET page does (D14), so a failure page cannot
  be mistaken for the same page on another host.
- **Deliberately unchanged:** `415` (raised by `parseFormBody` for a non-urlencoded body - the form
  always posts `application/x-www-form-urlencoded`, so a browser cannot reach it) and `503`
  `"session store unavailable"` (operator fault: the user cannot fix it, and the machine-readable
  body is the more useful signal). `413` also stays `text/plain` with the M19 `connection: close`
  semantics exactly as they are: a browser _can_ reach it by pasting a body over the 16 KB form
  limit, but the state is self-inflicted and non-actionable, a card would need new copy, and the
  M19 response shape is frozen. This is recorded as a known residual, not silently fixed. The GET
  page and the success `302` are untouched.
- **Deliberately not added:** D20's progressive-enhancement `SUBMIT_SCRIPT` (submit guard +
  `history.replaceState`) on the token page. The harm it was built for does not exist in token mode:
  there is no failure budget to spend (token mode has no rate limiter), so neither a double submit
  nor a reload can lock anyone out. Note precisely what a reload replays: the **original POST with
  the original token**, not the empty field of the rendered card - so a `history.replaceState` would
  have hygiene value (keeping the secret out of a replayable history entry), but it needs a new
  option on the shared page API. Deferred and recorded here rather than folded into this change.
- **TOTP second stage, same pass:** `rejectTotp` no longer renders the leftover lowercase
  `invalid credentials`; it renders `Invalid or expired code.` (`INVALID_TOTP_CODE`) — the same
  one-constant discipline, but a distinct string, because at that point the password was accepted and
  the failing input is the code (wrong, replayed, or the account no longer has a secret). The message
  deliberately does not say which of those happened.
- **Supersedes** the "token mode keeps its `text/plain` 401" clause of D20 — and the identical
  sentence in `docs/implemented/impl-m3.md` P14. Everything else in D20 stands unchanged.

## Context

Issue #85, measured on 0.14.2: a wrong token answers `401` + `content-type: text/plain` + the body
`invalid token`. A browser navigation therefore renders a blank white document — no card, no error,
an empty `document.title`, and no way forward except the Back button. The password flow had exactly
this defect until D20 (0.14.2, PR #83) gave its 401/429 the login card; token mode was left out on
purpose because M2 froze the token response shape as `text/plain` and P11 froze token mode as
byte-for-byte identical to M2.

That freeze is an internal contract (the shape M2 shipped and its tests pin), not a user-facing
requirement: the frozen parts that matter are the **status code**, the **single constant per failure
class**, the **no-reflection rule**, the **log discipline** and the **no-JavaScript submit path**.
Those are all preserved. Changing the body of a browser-facing failure therefore needs a record —
this one — plus the mechanical bookkeeping: an amendment line in `impl-m2` (the M2 spec owns the
token contract) and the `impl-m3` P14 cross-reference, exactly the way D20 amended `impl-m3`.

The failure path itself is unchanged: the same constant-time `validateToken` call, the same
`logger.info("login rejected")` (no token, no username in logs), the same absence of a session, and
no `WWW-Authenticate` header. Only the representation of the browser-facing rejection changes.

## Alternatives Considered

- **Keep `text/plain` and document it** — rejected: the documentation does not remove the dead end,
  which is the entire defect.
- **`303` to `GET /auth/login?e=1` (POST/Redirect/GET)** — rejected for the same reasons as D20:
  it replaces the frozen 401, makes script clients read a failed login as a successful navigation,
  and puts an error signal in the URL.
- **HTTP 200 with the re-rendered card** — rejected: breaks the frozen 401 contract and removes the
  only signal machine clients have.
- **A dedicated token error page** — rejected: new CSS against a 91 %-full 6 KB budget, and it drops
  the anti-phishing identity block that the card exists to show.
- **Echo the submitted token back so the user can spot a bad paste** — rejected: reflecting a secret
  into the response body, page cache and session history is a disclosure with no functional benefit;
  the empty field is strictly safer.
- **Reuse `INVALID_CREDENTIALS` for the TOTP stage** — rejected: it misattributes the failure
  (the password was accepted) and would have to cover a code that is wrong, replayed or no longer
  required.
- **Convert `413`/`415`/`503` to HTML in the same pass** — rejected: they are protocol-level or
  operator-level failures, not user-fixable states, and the M19 `connection: close` semantics on 413
  must stay exact. Recording the decision is the point; widening it is not.
- **Add D20's submit guard script to the token page** — rejected (see Decision): it would expand the
  shared page API for a flow that has no lockout budget to protect.

## Why

It is the smallest change that removes the dead end at the same place D20 removed it for passwords,
and it keeps every invariant that a frozen M2 contract actually protects: the status code, the
one-constant rule, the no-reflection rule, the log discipline, the no-JavaScript submit path, the
6 KB CSS budget, the slice boundaries and the dependency set. The change is confined to the token
slice plus one constant in the password slice, and it touches no shared API. The real-entry
integration test (`src/integration.auth.test.ts`, the cordis + webserver + storage stack) now asserts
the HTML failure body instead of only the status, so a silent regression back to `text/plain` fails
CI rather than being discovered by a confused user.

Independent review: `docs/reviews/grok46-d21-token-failure-card-review.md` (grok-4.6, 2026-09-23,
verdict **approve**); its findings F1-F3 all landed in this change.
