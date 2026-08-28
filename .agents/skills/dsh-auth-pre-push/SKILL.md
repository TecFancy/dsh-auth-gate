---
name: dsh-auth-pre-push
description: Use before pushing to dsh-auth or claiming checks pass on a branch. Selects the smallest tests and checks that cover the outgoing diff instead of reflexively running the full verify suite.
---

# dsh-auth pre-push checks

Run the narrowest relevant evidence once before a push. The hooks are intentionally narrow —
pre-commit fixes staged format+lint, pre-push runs the full type-check — so never manually
repeat a check a hook already runs.

## Inspect the outgoing change

```sh
git status --short --branch
git rev-parse --show-toplevel
```

Confirm you are on `development`. Diff against the verified base (current `origin/development`
or the PR base) — never a remembered ref. After a base change, re-derive the scope and rerun
only checks invalidated by it.

## Select relevant evidence

- **Guard/gate/session-store behavior:** `npm run test -- src/<module>.test.ts`, or a focused
  test name via `-t`.
- **Coverage for the affected source:**
  `npm run test -- src/<module>.test.ts --coverage --coverage.include='src/<module>.ts'`.
  Never lower thresholds or narrow the include to hide an uncovered affected file.
- **Mount-point behavior:** both integration files (`src/integration.guard.test.ts`,
  `src/integration.session.test.ts`) — the regression net for the non-contractual seam
  (plan §7).
- **Dependencies or lockfile:** `npm run lock:check`; the install must have used
  `--registry=https://registry.npmjs.org/`.
- **`src/` edits:** rebuild `lib/` (`npm run build`) and stage it in the same change; CI fails
  on drift.
- **Docs-only changes:** `npm run format:check && npm run lint` is enough; skip coverage.

Do not run `npm run type-check` right before a push merely to duplicate the pre-push hook.

## Protect history-rewriting pushes

Rebase is allowed. Record the current remote OID, then publish with
`--force-with-lease=<branch>:<observed-oid>`; raw `--force` is never allowed. After a rewritten
push, re-fetch the live head and re-audit review threads and CI — pre-rewrite hashes are not
current evidence.

## Handle failures

A relevant check fails before push → stop and fix; never push hoping CI differs. If a failure
looks environment-specific, prove it: exact command, failing test, platform mismatch, then
prefer fixing the nondeterminism over bypassing the check.

## Push procedure

1. Run the selected checks once.
2. Commit normally; inspect any files the pre-commit fixer changed before continuing.
3. Push normally (or with the exact lease for a rewritten branch).
4. Verify the remote ref matches local HEAD: `git rev-parse HEAD origin/development`.
5. Inspect remote CI (`gh pr checks`) and report pending checks as pending.
