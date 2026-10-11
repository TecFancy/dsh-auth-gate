# Guard unwrap rolls back per entry, not by snapshot

## Decision

The disposer returned by `wrapServer` rolls back entry by entry: an entry in
`exact` / `prefixes` / `upgrades` (or the `fallback` seat) goes back to its
original unguarded handler only while it still holds a guarded handler that
this wrap produced. Entries deleted while the guard was mounted are not written
back, entries someone else replaced are left alone, and routes registered after
the wrap stay in the tables with the guard removed. This supersedes the
"restore = snapshot + original methods, post-wrap registrations discarded"
clause of `docs/implemented/impl-m1.md` D6.

## Context

The M1 disposer cleared the route tables and wrote back a snapshot taken at
wrap time. That is only correct when the whole host shuts down. dsh reloads a
single plugin in place (a config change in the Plugins page is dispose + apply
of that plugin alone), and the real `@deepseek-ai/dsh-host-webserver` throws on
a duplicate path or a second fallback. Reloading dsh-auth-gate alone therefore:

1. dropped every route other plugins registered after the wrap (404 until a
   full restart);
2. resurrected routes whose owner had been disposed meanwhile, pointing at a
   dead plugin's closure;
3. made that owner's next load fail with `webserver: duplicate exact route`,
   because the resurrected entry still held the path.

`src/integration.guard.test.ts` ("guard survives a reload of this plugin
alone") reproduces all three over the real cordis and webserver stack.

## Alternatives Considered

- **Keep the snapshot restore (M1 D6)**: rejected, it owns state that belongs
  to other plugins and breaks them on a single-plugin reload.
- **Snapshot restore plus merging in post-wrap registrations**: rejected, it
  still resurrects disposed routes and has to guess which side wins a path.
- **Leave the tables guarded on dispose and only restore the register
  methods**: rejected, the stale guards would keep calling a disposed gate, and
  the next wrap could not tell its own guards from leftovers.

## Why

The guard only owns the handlers it created, so rollback should touch exactly
those. Each wrap records "guarded handler to original" in WeakMaps scoped to
that wrap call, so a lookup answers "did this wrap produce the entry that is in
the table right now", which is the one fact rollback needs. Ownership of the
paths themselves stays with the plugins that registered them, and their own
disposers keep working because the real webserver deletes by path.
