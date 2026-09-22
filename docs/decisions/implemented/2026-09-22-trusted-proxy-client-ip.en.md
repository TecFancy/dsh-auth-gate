# D19. Client identity for the limiter comes from a trusted proxy header (`clientIpHeader` + `trustedProxyCidrs`)

## Decision

Two new configuration options, two new leaf modules, and a change of what "the client" means
for rate limiting: from the TCP peer address to a trusted client address.

- `clientIpHeader: string` (default `""`). The request header name. **An empty string reads no
  header at all**: the bucket key is the normalized `socket.remoteAddress`, exactly as before.
- `trustedProxyCidrs: string[]` (default `["127.0.0.0/8", "::1/128"]`). Trusted reverse proxy
  addresses. The header is consulted **only when the immediate peer is inside this set**.
- New `src/shared/client-ip.ts` (policy parsing, per-request resolution, warning de-duplication)
  and `src/shared/ip-address.ts` (literals and CIDR matching). The fixed algorithm is:
  read the header, split on `,`, normalize each entry, then **take the first address from the
  right that is both a valid IP and not a trusted hop**. **Any segment that is not a valid IP
  invalidates the whole header** (including an empty segment), so garbage on the right can never
  make the code fall back to a client-supplied value on the left; missing, over-long (>1024 B), or
  all-trusted values fall back to the peer with a warning (one per untrusted peer, capped at 10;
  configuration problems warn once).
- A peer is trusted when it is inside `trustedProxyCidrs`, **or** when the transport is not TCP and
  has no peer address at all (a Unix socket, which can only come from this host and is therefore
  trusted like loopback). Omitting `trustedProxyCidrs` means the loopback default; passing an
  **explicit empty list means "trust nobody"** (the header is never read) rather than widening back
  to loopback.
- The password path and the TOTP second stage share one resolution point
  (`handlePasswordLogin` computes `ip` once), so both paths always use the same key; the
  integration tests verify "the other device is not collateral damage" for both paths.

This is an **explicit exception to P10** ("the IP comes from `req.socket.remoteAddress ?? ""`;
do not read XFF"). The default is unchanged; the header is only believed when the operator
configures it and the request actually arrives from a trusted peer. A bad configuration can only
narrow trust, never widen it, and never fails open:

| Configuration problem             | Behaviour                                                  |
| --------------------------------- | ---------------------------------------------------------- |
| header name is not an HTTP token  | read no header (historical behaviour) + error log          |
| non-empty list, all CIDRs invalid | trust loopback only + error log                            |
| explicit empty list `[]`          | trust nobody (never read the header, no fallback widening) |
| some CIDRs invalid                | drop the invalid entries, keep the valid ones + error log  |
| `0.0.0.0/0`, `::/0` (prefix 0)    | rejected (they mean "trust everyone") + error log          |

## Context

issue #74 (0.13.0, Cloudflare Tunnel over loopback) reports that the limiter keys on
`req.socket.remoteAddress`, and that behind a same-host proxy (Tunnel, Caddy, nginx, Docker host
networking) **every request's peer is a loopback address**, collapsing the deployment into a
single `byIp` bucket:

- five failures from anyone return 429 to every login and TOTP submission for the lock window,
  **even for a correct password from a device that never failed**;
- `recordSuccess` clears that same shared bucket, so any successful login wipes the whole
  deployment's failure count;
- an attacker arriving through the same proxy is indistinguishable from legitimate users, so
  per-source throttling has no object left.

Code evidence (0.14.0): the only source of client identity is
`const ip = req.socket.remoteAddress ?? ""` in `src/features/password/password-login.ts`, and
`LoginRateLimiter.check` takes `max(ipLock, accountLock)`, so one locked IP bucket rejects
**every** account. The repository has always documented "rate limiting aggregates by proxy egress
IP" as a known limitation (P10 plus the "do not trust `X-Forwarded-For`" notes in
`docs/deployed/*`), but in this topology it is not a limitation: it is a deployment-wide
availability defect. This repository's own reference topology (Caddy on the same host, dsh bound
to loopback) hits it.

## Alternatives Considered

- **Trust a configured header unconditionally (the issue's `trustedProxyHeader`).** Anything that
  can reach dsh directly (the plugin claims to serve any topology; dsh can bind any interface)
  could pick its own bucket, lock out a victim, or churn `byIp` (capped at 10000 entries, oldest
  evicted, so other clients' state can be pushed out). Same reasoning that made D14 refuse the
  `X-Forwarded-*` family. Not acceptable.
- **Bucket by account only, or by `(peer, username)`.** Cross-user damage disappears, but there is
  still no per-client budget; password spraying degrades from "five per deployment" to "five per
  account", and a misconfigured header would no longer be visible.
- **Read `X-Forwarded-For` by default, or take its leftmost value.** The leftmost value can be
  pre-seeded by the client, and reading a header by default would base every existing deployment's
  rate limiting on attacker-controlled input.
- **Fail closed (503 / refuse the login) when the header is missing.** A configuration typo would
  become a deployment-wide login outage, hard to distinguish from a broken gateway.
- **Docs only (keep today's behaviour).** That documents the DoS as a limitation, accepting that
  five mistyped passwords from anyone lock out the whole instance.
- **Change lockout semantics at the same time** (IP bucket as a throttle, account bucket as the
  lockout, or dropping the reset on lock expiry). That is a separate concern and would blur the
  signal this change needs to prove; it belongs in its own issue.

## Why

"Trust the peer, not the header" matches express `trust proxy`, nginx `real_ip` and the Go
standard library's `Forwarded` handling: a forwarding header is only what a trusted peer says
about the client, and its credibility comes from the peer rather than the header. Under that
model the default configuration (read nothing) is byte-identical for every existing deployment,
and all new behaviour happens only after an operator declares the topology explicitly.
Walking right to left while skipping trusted hops is the only safe direction for an
`X-Forwarded-For` chain, because a client can only pre-seed entries further left. Normalizing
IPv4-mapped and IPv6 forms keeps one client in one bucket and lets `127.0.0.0/8` cover
`::ffff:127.0.0.1`.

The precondition and the residual risk are documented rather than hidden in code: the trusted
proxy must **overwrite** the header (passing a client-supplied one through would hand the choice
back to the client), and shared NAT/CGNAT egress can still cause collateral lockouts, with the
account bucket as the last line of defence.
