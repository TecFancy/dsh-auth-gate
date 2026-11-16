/**
 * Shared `--root` guard cases for the gate self-tests.
 *
 * The guard is the same ~30 lines in `sync-skills.mjs`, `check-docs.mjs`,
 * `check-notes.mjs`, `check-note-links.mjs`, `check-bilingual.mjs`,
 * `check-zh-prose.mjs` and `check-skill-frontmatter.mjs`. `gen-zh-brief.mjs`
 * has a self-test but no `--root`, so it is not a copy of this guard. The
 * defect that motivated these cases was a sampling failure rather than a
 * logic error: several copies existed and only one carried a guard assertion,
 * so the others could have fallen open unnoticed. The cases live here so
 * every copy answers to one list, while each script still exercises its
 * *own* copy - the caller supplies a spawn helper that runs that script.
 *
 * What the guard protects: it decides which tree a gate reads, and for
 * `sync-skills.mjs` which tree it prunes. A `--root` that silently degrades to
 * the checkout would let a gate report green for a tree it never opened, and
 * would turn every fixture-based negative case into a test of the real
 * repository instead of the case under test.
 *
 * Imported dynamically, from inside each `selfTest`, so that a normal gate run
 * keeps working if this file is absent: only the self-tests depend on it.
 */

import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * @param {object} options
 * @param {(args: string[], env?: Record<string, string>) => {status: number|null, stdout: string, stderr: string}} options.spawnRoot
 *   Runs the script under test with the given argv and environment override.
 * @param {string[]} options.failures Collected failure messages, appended to.
 * @param {string[]} [options.runArgs] Extra argv appended to every invocation,
 *   so a case that must stay read-only can pass `--check`.
 */
export async function runGuardCases({ spawnRoot, failures, runArgs = [] }) {
  const expect = (name, result, code, needle) => {
    if (result.status !== code) {
      failures.push(`${name}: expected exit ${code}, got ${result.status}`);
      return;
    }
    const out = `${result.stdout}${result.stderr}`;
    if (needle && !out.includes(needle)) {
      failures.push(`${name}: output missing ${JSON.stringify(needle)}`);
    }
  };

  const guardRoot = await mkdtemp(path.join(os.tmpdir(), "gate-guard-"));
  let dottedChild;
  try {
    // 1. A path outside the temp directory is refused. The filesystem root is
    //    the one path guaranteed to exist on every platform, so the case
    //    reaches the containment test rather than the missing-path branch.
    expect(
      "--root outside temp",
      spawnRoot(["--root", path.parse(guardRoot).root, ...runArgs]),
      2,
      "refusing --root outside the temp directory",
    );

    // 2. A broken override must not degrade to the checkout. A caller who wrote
    //    `--root "$DIR"` with `DIR` unset believes the run was redirected;
    //    falling back to the default root would scan the real tree and report a
    //    green verdict the caller never asked for. The needle matters as much as
    //    the exit code: `--self-test` consumed as a value resolves to a missing
    //    path, which exits 2 for the wrong reason.
    expect("--root without a value", spawnRoot(["--root"]), 2, "--root needs a directory value");
    expect(
      "--root with an empty value",
      spawnRoot(["--root", ""]),
      2,
      "--root needs a directory value",
    );
    expect(
      "--root followed by a flag",
      spawnRoot(["--root", "--self-test", ...runArgs]),
      2,
      "--root needs a directory value",
    );
    // The equals form with nothing after it must fail closed rather than be
    // ignored: ignoring it scans the default root and reports the caller a
    // verdict about a tree their override never named.
    expect(
      "--root= with an empty value",
      spawnRoot(["--root="]),
      2,
      "--root needs a directory value",
    );
    // A misspelled flag must be refused, not dropped. `-root` is the
    // single-dash typo and the one most likely to be typed by hand; before the
    // strict parser every entry here was ignored outright, which scanned the
    // default tree and exited 0.
    for (const misspelling of ["-root", "--Root", "--roots", "--rooot"]) {
      expect(
        `misspelled flag ${misspelling}`,
        spawnRoot([misspelling, guardRoot, ...runArgs]),
        2,
        `unknown argument: ${misspelling}`,
      );
    }
    // Two different roots is an ambiguous request, not a preference order, so it
    // is refused instead of being resolved by position.
    expect(
      "--root given twice",
      spawnRoot(["--root", guardRoot, "--root", guardRoot, ...runArgs]),
      2,
      "--root given more than once",
    );
    expect(
      "--root= given twice",
      spawnRoot([`--root=${guardRoot}`, `--root=${guardRoot}`, ...runArgs]),
      2,
      "--root given more than once",
    );

    // 3. Spellings that must stay accepted. Each shape below would be refused
    //    by a comparison that skipped normalisation or compared case
    //    sensitively, so together they pin that the guard decides containment on
    //    resolved paths. What the script then reports about that tree is not the
    //    guard's business, so only acceptance is asserted.
    const variants = [
      // Both flag spellings must reach the same override. `--root=<dir>` was
      // ignored outright before, which is the same fail-open as a missing
      // value.
      ["value form", ["--root", guardRoot], {}],
      ["equals form", [`--root=${guardRoot}`], {}],
      // The environment may spell the temp directory with a trailing
      // separator. `os.tmpdir()` strips one, so a doubled separator is what
      // actually reaches the comparison; a path used without resolving it would
      // then be compared as `/tmp//` against `/tmp/gate-guard-x`.
      [
        "temp dir with a trailing separator",
        ["--root", guardRoot],
        {
          TMPDIR: os.tmpdir() + path.sep + path.sep,
          TEMP: os.tmpdir() + path.sep + path.sep,
          TMP: os.tmpdir() + path.sep + path.sep,
        },
      ],
    ];

    // When the temp directory is the filesystem root, every path is inside it,
    // so the override has to be accepted. This is the shape that separates the
    // containment test from a string prefix: `tmp + path.sep` builds `//` and a
    // prefix test then refuses every path on the machine, while a relative-path
    // test reports `tmp/gate-guard-x` and accepts. It is the one variant that
    // distinguishes the two implementations on POSIX.
    const rootDir = path.parse(os.tmpdir()).root;
    variants.push([
      "temp dir at the filesystem root",
      ["--root", guardRoot],
      { TMPDIR: rootDir, TEMP: rootDir, TMP: rootDir },
    ]);

    // A temp directory reached through a symlink. This is also the macOS shape,
    // where `/tmp` is a symlink to `/private/tmp`, so the two sides of the
    // comparison must both be resolved to agree.
    const link = path.join(guardRoot, "tmp-link");
    let linked = false;
    try {
      await symlink(os.tmpdir(), link);
      linked = true;
    } catch {
      // Symlink creation needs a privilege on Windows. The skip is reported so
      // it is visible in the output; it does not by itself fail the run, so a
      // reader who only checks the exit code still sees green.
      console.warn("[guard-cases] SKIP symlinked temp directory case: no symlink privilege");
    }
    if (linked) {
      variants.push([
        "symlinked temp dir",
        ["--root", guardRoot],
        { TMPDIR: link, TEMP: link, TMP: link },
      ]);
    }

    // Windows names the same directory with either case, and that is the one
    // shape a string-prefix comparison gets wrong while `path.relative` gets
    // right. The case varies the `--root` side rather than the environment, so
    // it pins the comparison itself. It is gated on a probe, because the
    // spelling only names the same directory where the resolution step agrees
    // that the two cases are one path.
    if (process.platform === "win32") {
      let caseFolded = false;
      try {
        caseFolded = realpathSync(os.tmpdir().toUpperCase()) === realpathSync(os.tmpdir());
      } catch {
        caseFolded = false;
      }
      if (caseFolded) {
        variants.push(["case-varied --root", ["--root", guardRoot.toUpperCase()], {}]);
      } else {
        console.warn(
          "[guard-cases] SKIP case-varied --root: path resolution does not equalise case here",
        );
      }
    }

    // A directory directly inside the temp directory whose name begins with
    // dots is a legitimate child, not an escape. `path.relative` yields exactly
    // `..guard-xxxx` for it, the shape a bare `startsWith("..")` test would
    // misreport, so this pins the separator in the `..` comparison.
    dottedChild = await mkdtemp(path.join(os.tmpdir(), "..guard-"));
    variants.push(["child named with leading dots", ["--root", dottedChild], {}]);

    for (const [label, args, env] of variants) {
      const accepted = spawnRoot([...args, ...runArgs], env);
      const out = `${accepted.stdout}${accepted.stderr}`;
      if (!out.includes("root override:")) {
        const why = out.includes("refusing --root outside the temp directory")
          ? " as outside the temp directory"
          : "";
        failures.push(`--root accepted spelling (${label}): the override was refused${why}`);
      }
    }

    // 4. A temp directory that cannot be resolved is an environment fault, not a
    //    verdict on the tree: exit 2, never an uncaught throw whose exit 1 reads
    //    as "this tree has violations" and sends the reader after the wrong
    //    problem. Every variable `os.tmpdir()` consults is pointed at a missing
    //    path, so the broken value is returned rather than silently replaced.
    const broken = path.join(guardRoot, "does-not-exist");
    const brokenEnv = { TMPDIR: broken, TEMP: broken, TMP: broken, USERPROFILE: broken };
    const unresolvable = spawnRoot(["--root", os.tmpdir(), ...runArgs], brokenEnv);
    const out = `${unresolvable.stdout}${unresolvable.stderr}`;
    if (unresolvable.status !== 2) {
      failures.push(`unresolvable temp dir: expected exit 2, got ${unresolvable.status}`);
    } else if (/\n\s+at |node:fs:/.test(out)) {
      failures.push("unresolvable temp dir: surfaced as an uncaught exception, not exit 2");
    }
  } finally {
    await rm(guardRoot, { recursive: true, force: true });
    if (dottedChild) await rm(dottedChild, { recursive: true, force: true });
  }
}
