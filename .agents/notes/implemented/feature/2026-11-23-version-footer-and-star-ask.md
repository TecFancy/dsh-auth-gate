# Agent Note: The account footer reports the host's version and asks the operator for a star

Status: implemented

English | [中文](2026-11-23-version-footer-and-star-ask.zh.md)

## Problem

A deployment cannot tell which version it runs. The only answers are `npm ls`
in the right profile or opening `package.json`; the settings panel, the one
surface every signed-in user already opens, said nothing. That gap is expensive
here because behaviour is version-conditional: on dsh `0.2.3-alpha.2` and later
the first-run wizard cannot verify the launch token, and
[known-limitations](../../../../docs/deployed/known-limitations.md) is written
against version boundaries. "Which version are you on" is the first question of
every bug report, and nobody has a cheap way to answer it.

The second half is that nobody is ever asked to star the repository. Downloads
are ~6k a month and the repository has 21 stars. That is a fact about
distribution, not a licence to put an ask everywhere - the interesting question
was which surface is the operator's, and which is somebody else's.

## Decision

One footer line at the bottom of the Account security section:

- `dsh-auth-gate v0.24.0` for every signed-in user, sourced from the running
  host process;
- `给个星星鼓励一下 ★` / `Give it a star ★` next to it, only for the operator:
  `mode: "token"` (the shared token default - whoever can reach this page holds
  that token) or `role === "admin"` under password mode.

Three decisions are inside that line.

**The version comes from the host, not from the client bundle.**
`GET /auth/status` gained an optional `version`, written by
`session-endpoints.writeStatus` from `SELF_VERSION` in
[shared/lib/version.ts](../../../../src/host/shared/lib/version.ts) - one
synchronous read of `package.json` at load, `""` when it cannot be read. The
client bundle was the obvious alternative and it is wrong: after a plugin
upgrade the browser may still be running a cached bundle, and a footer is the
one place in the product that would then report a version no longer installed.
The same payload also carries `mode`, which is what makes the audience rule
expressible at all.

**The ask is addressed to the operator.** The Account security page is
reachable by every signed-in user; under password mode those users are the
deployment's colleagues, not this project's audience. The login page already
respects that boundary for the same reason - a third-party link on somebody
else's authentication surface is confusing at best - and moving the ask one page
deeper does not change whose surface it is. Token mode is the exception by
construction: there is no role, and the only person who can open the page is the
one who installed the plugin.

**Unknown is not inferred.** Both keys are omitted when the host does not know
them, the client parser leaves them `undefined`, and the footer renders one line
instead of two. It does not treat a missing `mode` as `"token"` and it does not
render an empty `v`. That follows the additive-compatibility rule the rest of
`/auth/status` already uses: absent means unknown, never a default.

## Alternatives considered

- **A build-time version constant in the client bundle.** Rejected: it reports
  the cached bundle's version, not the running one - exactly the lie the footer
  is supposed to prevent.
- **Showing the ask to every signed-in user.** Rejected: it markets the
  maintainer's repository to the deployer's colleagues, which is the same
  mistake as putting it on the login page, just one page further in.
- **Counting star clicks through the telemetry endpoint.** Rejected: contract v1
  has a fixed key set, and a star is not usage data. GitHub's own referrer
  traffic answers the question without a new field.
- **A `postinstall` banner or an install-time browser open.** Rejected: an
  authentication package that runs code or prints advertisements at install time
  is a supply-chain smell, and this repository documents its network behaviour
  precisely so that it is not one.
- **Shipping the update check in the same change.** Deferred, see below.

## Consequences

- `/auth/status` gains two optional keys. Old clients ignore them; old hosts
  omit them and the footer renders fewer lines. No version floor moved.
- The version number is right by construction: release-please bumps
  `package.json`, the host reads it, and the integration tests assert against
  that same file rather than a literal, so a release does not turn CI red.
- The ask reaches operators only, costs one line, blocks nothing, stores
  nothing, and does not repeat within a page view.
- The README screenshot of the panel
  (`docs/demo/account-change-password.en.png`) does not show the footer.
  Screenshots are not re-shot for a 12px line; the image stays an illustration,
  not a spec.
- A token-mode instance on an old host shows no star, because `mode` is missing
  and missing is not inferred.

## Deferred

- **Update check.** The shape is decided: host-side, cached for at least a day,
  silent on failure, one extra line only when a newer version exists, no
  "up to date" badge, and no self-upgrade - installing is dsh's plugin manager
  job, and a security plugin that rewrites its own `lib/` while running is an
  undefined state. It needs a new outbound request documented in the README's
  "Anonymous usage statistics" section and in `docs/security.md`, which is why
  it is a separate change.
- **Retiring the version line.** dsh's plugin market already knows published
  versions and may eventually show installed-versus-available itself. If it
  does, this footer keeps the version and drops nothing else.

## Verification

- `session-endpoints.facts.test.ts` - both keys written when known, both absent
  when unknown, an empty version never written, the identity projection
  unchanged.
- `account-status.test.ts` - whitelist parsing for `mode` and `version`,
  including `""` and non-strings.
- `section-footer.test.tsx` - version interpolation in both locales, empty
  version treated as unknown, link target and `rel`, audience gate.
- `account-section.footer.test.tsx` - the gate as wired through the real
  section: an ordinary user sees the version only, an administrator and a
  token-mode instance see the star, an old host renders no footer.
- `integration.auth.test.ts`, `integration.revoke.test.ts` - the exact wire
  string, with the version taken from `package.json`.
