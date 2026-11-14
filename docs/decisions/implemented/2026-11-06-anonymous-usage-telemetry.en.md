# Anonymous usage statistics: one lazy ping, visible and switchable

## Decision

The plugin sends one anonymous usage ping per process per 24 hours, and only after a request has
already been let through the login gate. The body is the shared contract's v1 shape, key for key:
the payload version, the package name and version read once from this package's `package.json`, a
random install id (UUID v4), the Node major version, the platform, the architecture, and this
deployment's three facts - the gate `mode`, the `totp` mode, and the bucketed `users` count. It is a
`POST` to `https://t.hi-ruofei.com/v1/ping` with a five-second abort signal, no retry, no log line,
and no effect on the request it rode on.

`telemetry` is an ordinary, visible config option with default `true`; `false` means no request at
all. `installId` is declared `.volatile().hidden(true)`, generated on first use and written back
through the host's settings service (`ctx.get("settings")`). A host that does not provide that
service keeps the generated id in memory for this process and still reports - one new id per restart,
which the endpoint's `(id, day)` dedupe absorbs - and never falls back to a private file on disk. The
`users` metric is read lazily: only when a ping is actually due (at most once per 24 hours), and
through the same `loadUsersFile` the login path uses, so it never adds a read to a request path.

The ping is hooked at the guard's allow branch (`guardHttp`, `guardResource`, `guardUpgrade`, via the
`AdmitHook` that `wrapServer` threads into every wrapped entry): the hook runs after `decide()`
returned `allow`, outside the decision path. There is no timer and no call at startup.

**On the word "anonymous".** It is the feature's name, not a legal claim. The accurate description,
and the one both READMEs use, is _pseudonymous data with no IP, linked by a random install id_: the
same id is linkable over time, so the data is only used to estimate install counts and version spread,
never for billing, security decisions or precise public numbers. No IP address is collected, and the
endpoint stores no request metadata beyond the payload.

## Context

Two questions drove this: how many machines actually run the plugin, and which version did they
adopt. Nothing in the deployment answers them - a self-hosted instance has no telemetry, and the
maintainer cannot count installations. The constraints came from the product, not from the
measurement: this is a security plugin whose only job is to keep people out, so its data surface must
not grow; it is installed on machines the operator owns, often offline-first, and its users
self-hosted precisely because they do not want a vendor account. Two packages (`dsh-auth-gate` and
`dsh-lingualab`) answer the same question, so they share one wire contract and one endpoint, and a
change to either payload is a contract change.

## Alternatives Considered

- **A machine fingerprint** (hostname, MAC address, `/etc/machine-id`) - it is stable across restarts,
  but it is identifying: it ties the ping to one machine across networks and accounts, needs
  privileged OS-specific reads, and is exactly the "anonymous" claim it breaks. Rejected.
- **A third-party analytics SDK** (PostHog, Sentry, an APM agent) - a new dependency with its own
  background timers, its own data collection and its own update surface, in a package that allows no
  new dependency. One `fetch` covers the whole need. Rejected.
- **Account or login-gated telemetry** - it would need a server, registration and storage of
  personal data, and it turns installing a login gate into creating an account at the login gate's
  vendor. Rejected.
- **Default off, opt in** - honest, but the sample would be too small to answer the question that
  motivated the feature; adoption reporting is the one thing this repo cannot infer locally. Rejected
  in favour of default-on-but-visible.
- **Store `installId` in a file under `$DSH_HOME`** - it would be a second home for a fact the config
  already holds, and the two would disagree the first time either is edited by hand. The settings
  service writes into the same config entry that is read at load; when it is absent the id stays in
  memory. Rejected.
- **Hook the gate's `decide()` or the session layer** - that puts network or ID generation on the
  authentication decision path, where a failure or a slow write can hurt the one thing that must not
  degrade. The guard's allow branch is after the decision and outside it. Rejected.
- **Ping at startup** - an instance that is started and never used would report as "in use", and
  every restart would look like a new install. Returning to "only after an admitted request" keeps
  the signal honest. Rejected.

## Why

Default-on is what makes the number meaningful; visible-and-switchable is what keeps consent real -
`telemetry` is an ordinary row in the config table, not a hidden field, and one key turns the whole
path off. Lazy-after-admit ties the report to actual use: a process that is started but never
receives an admitted request sends nothing, and nothing runs on a timer. The payload is built from
the deployment's configuration and the process facts only - never a user name, password hash, TOTP
secret, session id, token, client IP, request path or host name - so the threat model of the plugin
does not change. No dependency, no account, no server of our own, and every failure is swallowed:
telemetry can never fail or delay an authentication decision.
