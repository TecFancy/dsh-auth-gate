# D15. Login page visual language: a cool-neutral checkpoint card (identity block kept)

## Decision

The shared style of the three login page variants in `src/shared/login-page.ts` becomes
"cool neutral + soft depth + hairline rules + the domain as the hero": a light backdrop
gradient (`#eaedf2 → #dde2ea`), a `#f6f7fa` card with a 1px border and one soft elevation
shadow, inset inputs with 10px radii and 150ms transitions, and a near-black primary
button. Structurally the kicker, the domain marker and the host move into a `.head` block
with a hairline rule under it, and `.meta` gets a hairline above it; the domain grows to
22px/700/-0.025em with a small 7px neutral square marker in front (`aria-hidden`). The
anti-phishing identity block (kicker / host / who / switch-account fallback), zero
third-party resources, submit-without-JS, light+dark, reduced motion and the 6KB CSS
budget are all unchanged.

## Context

The 2026-09-17 revision read as a warm-paper tool-site (backdrop `#f4efe6`, surface
`#fbf8f3`, a single border, no shadow). Its anti-phishing identity block worked, but the
owner reviewed it and said it **"looks a bit dated"**. The same review also settled where
the identity block's host comes from (see D14).

## Alternatives Considered

- **Keep the 09-17 look as is** - functionally fine, but "dated" is direct product-owner
  feedback on the only screen an end user ever sees.
- **Go back to upstream brand blue plus the shield logo** - exactly what the 09-17
  revision removed on purpose: mirroring the upstream chat product's sign-in page weakens
  the anti-phishing semantics (users should read it as "my instance's door", not
  "DeepSeek sign-in").
- **Generic modern SaaS styling (violet gradients, glassmorphism, big radii)** - modern
  but indistinguishable, heavy on AI-slop, and at odds with this project's restrained,
  auditable tone.
- **Any single route among the three grok-4.6 candidates**:
  - A, editorial typographic (white card, hairlines, monospace domain): cleanest, but
    flat - the card barely separates from the backdrop;
  - B, soft depth (cool slate, ambient shadow, inset inputs): the most contemporary, but
    the identity block loses prominence;
  - C, checkpoint console (dot field, all-monospace, amber cap): unmistakably a
    controlled entry, but all-monospace uppercase labels are heavy for daily sign-in.

## Why

B as the base clears out the dated feel (layering, transitions and inset controls are the
vocabulary of current system UI), A's hairlines give the page its three-part order
(identity / form / footer), and C's treatment of the domain re-establishes the identity
block as the visual anchor - which is precisely this page's security job. All three routes
were produced in parallel by grok-4.6 (each a complete self-contained HTML page within the
no-external-assets and CSS budget constraints) and compared as real renders on an isolated
instance before choosing, so the trade-offs are on the record rather than a hunch.

Open item: the square marker before the domain is purely decorative ("this instance
identity is on display", `aria-hidden`, absent from the accessibility tree) and **does not
mean authentication has succeeded**. Expressing a stronger state (for example a bound TOTP
secret) would need its own design and an honest semantic.
