# D20. Login failures render the login card (HTML), not a bare `text/plain` page

## Decision

Browser-visible login failures keep their frozen status codes but stop answering with a
machine-readable body:

- **Wrong credentials** (unknown user, wrong password, disabled account: one identical response)
  stay **401**, but become `content-type: text/html; charset=utf-8` and re-render the existing
  login card with the error slot filled with the single constant
  `Invalid username or password.`. The submitted username is echoed back as an HTML-escaped
  `value=` attribute, the password is never echoed, `aria-invalid`/`aria-describedby="err"` are
  applied to both fields, the password field keeps `autofocus` (the username field takes it when
  the echoed username is empty, e.g. an empty submission), and `<title>` gains an `Error: ` prefix.
- **Lockout** stays **429** + `retry-after: <seconds>`, but the body is the same card carrying
  `Too many sign-in attempts from this network. Try again in N seconds. There is no password reset,
so ask the instance owner if you are stuck.` `N` is the current `retry-after` integer (singular
  `second` at 1). The submit button is deliberately **not** disabled in the markup so a
  JavaScript-less browser can still retry, there is no live countdown, and the response never
  discloses attempts remaining or whether an account exists. The TOTP second stage renders the
  challenge card with the same message on 429.
- The username is **trimmed** server-side before the user lookup and before the DUMMY_HASH
  verification at the failure boundary; the password is never trimmed.
- Failure pages ship a progressive-enhancement script with two jobs. On `submit` it disables the
  button, sets `aria-busy="true"` and swaps the label to `Signing in...`, resetting on `pageshow` and
  after 10 s. When the rendered page carries the error slot (i.e. it is a failure response) it also
  calls `history.replaceState` to the GET URL, so a later F5 re-requests the plain login page
  instead of re-submitting the POST and silently spending another failure. Rewriting history _during_
  the submit event does not work: the POST navigation commits after the handler returns and puts the
  POST entry back. Without JavaScript the form submits exactly as before and a refresh still
  re-submits.
- New `src/features/password/login-failure-pages.ts` (`INVALID_CREDENTIALS`, `lockoutMessage`,
  `sendInvalidCredentials`, `sendLockout`, `sendTotpLockout`); `src/shared/login-page.ts` gained an
  escaped `value` field plus a `username` render option; `src/shared/login-page-assets.ts` gained
  `SUBMIT_SCRIPT`.

Deliberately unchanged: token mode keeps its `text/plain` 401 (frozen by M2), the lock and backoff
semantics are untouched (issue #81), the shared-NAT bucket key is untouched (#82), the 6 KB CSS
budget is untouched (this change adds no CSS), and the 401 sends **no** `WWW-Authenticate` header.

## Context

0.14.1 answered a wrong username or password with `401 text/plain` and the body
`invalid credentials`. A browser navigation therefore renders a blank white page containing one
monospace line: no form, no `next` affordance, and an empty `document.title`. The same holds for a
lockout (`429 text/plain`, `too many attempts`), where the `retry-after` seconds the server already
knows are invisible to the user. Measured on an isolated instance (0.14.1, Chromium):

- pressing F5 on that blank page **re-submits the POST** and spends another failure from the
  5-per-600 s budget, so a confused user can lock themselves out;
- the username the user just typed is dropped (Back restores it only through browser form state);
- scrypt verification costs about 190 ms during which the submit button gives no feedback;
- a real double-click is de-duplicated by the browser, so the problem is perceived latency.

The shape itself is an omission rather than a security decision. The TOTP stage was fixed this way
in 0.11.1 (`docs/implemented/totp-fix-plan.md` §3.3: "keep the 401 status, change
content-type / body so the browser form can see the slot; fetch clients still see the status"),
and that plan records that the plain-text contract came from the M3 password path. The frozen
decisions constrain the **source** of the wording (one constant, never read `?error=`, never
reflect request text) and the **identity** of the three failure responses, not the content type.
The renderer already supported an error slot, `role="alert"`, `aria-invalid`/`aria-describedby`
wiring and the `.error` styles, and `passwordLoginPageHtml(next, error?, options?)` already accepted
an error; it was simply never called with one. The only missing renderer capability was echoing the
username, since the sole `value=` in the template was the hidden `next` input.

Supporting evidence gathered while designing this:

- Accessibility research: an already-filled `role="alert"` on a freshly loaded document is generally
  **not** announced (W3C APG, MDN, WAI ARIA19, WebAIM), so the error must be reachable by focus and
  descriptive wiring; the `Error: ` title prefix is the zero-cost GOV.UK pattern for this case.
- Industry survey (source-level): Keycloak re-renders its form and reuses the same "Invalid username
  or password." message even for temporary lockout; oauth2-proxy answers 401 with an HTML body and
  no `WWW-Authenticate`; Grafana says `Login temporarily blocked` for IP-scoped lockouts; pfSense has
  a dedicated lockout page. No surveyed product discloses attempts remaining, and none of the
  serious gates answers a browser form with a bare text page.
- RFC 6585 §4 shows an HTML body with `Retry-After` as the canonical 429 example, so the lockout
  card is squarely within the standard.

## Alternatives Considered

- **POST/Redirect/GET (303 to `GET /auth/login?e=1`)** - rejected: it would have to replace the
  frozen 401, would make scripts and monitoring read a failed login as a successful navigation,
  would put an error signal in the URL (the neighbourhood of the banned `?error=`), needs a cookie
  or query parameter to keep the username, and contradicts Chromium's password-manager guidance that
  a failed login should not navigate to a different page.
- **HTTP 200 with the re-rendered card (the Keycloak shape)** - rejected: it breaks the frozen
  401 contract and removes the only signal that machine clients (curl, monitoring, the plugin's own
  tests) can rely on.
- **Fetch/XHR error injection (progressive enhancement)** - rejected for this change: two response
  paths to test, CSP exposure for a larger inline script, and a divergence between JavaScript and
  no-JavaScript behaviour, for a 190 ms latency problem.
- **A standalone error page** - rejected: it would need new CSS against a 91 %-full 6 KB budget and
  would drop the anti-phishing identity block and the "use a different account" affordance that the
  card exists to provide.
- **A one-time form ticket (GET issues, POST validates; a replayed ticket does not count)** -
  deferred, not rejected: it is the only way to close the F5 counting hole without JavaScript, but
  it adds state and couples to the lock semantics that issue #81 will change. Revisit together with
  that decision.
- **Live countdown and a disabled submit button on the lockout card** - rejected: a `disabled`
  attribute in the markup strands JavaScript-less users permanently (WCAG 2.2.1), a countdown is
  dishonest under a per-IP lock shared through NAT, and no surveyed product shows one.
- **Accept-based content negotiation (HTML for browsers, `text/plain` for scripts)** - rejected:
  `curl` sends `Accept: */*`, so quality values would be the only discriminator and both audiences
  would occasionally get the wrong body. The contract for machine clients is the status code.
- **Sending `WWW-Authenticate: Basic` to satisfy RFC 9110 §15.5.2** - rejected: it makes the browser
  raise its native credential dialog and hide the card. The deviation from the MUST is deliberate and
  recorded here; oauth2-proxy ships the same deviation, and no supported header keeps a form login
  both compliant and usable.

## Why

It is the smallest change that removes the dead end while preserving every frozen invariant. The
status codes, the single constant for all three failure classes, the no-reflection rule, the log
discipline, the no-JavaScript submit path, the 6 KB CSS budget, the slice boundaries and the
dependency set are all untouched, and the result is structurally identical to the TOTP fix that has
already been shipped and tested since 0.11.1. Echoing the username is unconditional (unknown and
disabled users get it too) so it cannot become an account-existence oracle, and the lockout copy is
scoped to "this network" because the bucket key is a client IP that several people can share. The
remaining F5 and perceived-latency issues are addressed without weakening the contract: a
progressive-enhancement submit guard plus `history.replaceState` for browsers that run JavaScript,
and an explicit note that the no-JavaScript path still re-submits on refresh rather than a claim
that it is fixed.
