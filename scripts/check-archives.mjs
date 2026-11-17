#!/usr/bin/env node
/**
 * Archive seal gate (zero-dependency).
 *
 * Two frozen archives live in this repository and both are sealed by a SHA-256
 * manifest that may only grow:
 *
 *   1. `.agents/notes/archived/` - the Agent Note archive, sealed by
 *      `manifest.json` (`{version: 1, files: {"{class}/{file}": "sha256:<hex>"}}`).
 *   2. `docs/decisions/archived/` - the retired ADR archive that predates the
 *      notes tree, sealed by `.manifest.json` (a flat `{"<file>": "<hex>"}` map).
 *
 * Freezing used to be a review rule only, so an edit to an archived file was
 * visible to nobody until someone happened to read the diff. This gate makes it
 * mechanical, and enforces three things per archive:
 *
 *   1. Every artifact under the archive is sealed, and still matches its hash.
 *      A new, edited, deleted or unsealed artifact fails.
 *   2. The manifest only grows. It is compared with the copy committed at a
 *      trusted baseline (`HEAD` locally, the PR base in CI via `--base`), so
 *      editing a sealed file and its hash together still fails.
 *   3. The tree is closed: only the archive's own root files and, for the notes
 *      archive, one level of class directories are allowed.
 *
 * Shape (path encoding, triplets, `Archived:` line) stays `check-notes.mjs`'s
 * business and the sidecars stay `check-bilingual.mjs`'s; this gate owns bytes.
 * An empty archive is valid and needs an empty manifest, so the seal exists
 * before the first note is archived and nothing has to be retrofitted.
 *
 * Usage:
 *   node scripts/check-archives.mjs                # verify; exit 1 on violations
 *   node scripts/check-archives.mjs --write        # also append hashes for newly archived artifacts
 *   node scripts/check-archives.mjs --base <ref>   # baseline for the append-only check (default HEAD)
 *   node scripts/check-archives.mjs --self-test    # run the negative cases
 *
 * There is deliberately no `--root`: the self-test calls `check()` against
 * temporary repositories directly, so no flag can point a real run at another
 * tree and report green for a tree it never opened.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  AUTHORIZED_RESEALS,
  LEGACY_SEAL,
  VERSIONED_SEAL,
  extendManifest,
  sealHash,
  validateExtension,
} from "./lib/archive-seal.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT), "..");

/**
 * The two archives this gate owns.
 *
 * `classed` says whether the archive nests one level of class directories
 * (`{class}/{file}`) or is flat. `rootFiles` are the non-artifact files the
 * archive root may carry: the placeholder and the manifest itself.
 *
 * `retirable` says whether the archive may be retired as a whole. The legacy
 * ADR archive is being folded into the notes tree, so its directory ends up
 * empty; without this the gate would read "the archive was retired" as "every
 * sealed artifact was deleted", which is the tampering it exists to catch. The
 * notes archive is not retirable: it is the live archive, so a missing
 * directory there stays an environment fault.
 *
 * Retirement is deliberately narrow. It is only recognised when the directory
 * is gone, or when it holds neither an artifact nor a manifest. A directory
 * that still has artifacts but lost its manifest, or still has a manifest but
 * lost its artifacts, is a half-retired state and fails: that is exactly the
 * "delete the file, keep the seal" and "delete the seal, keep the file" shapes.
 */
const NOTES_ARCHIVE = {
  id: "notes",
  dir: ".agents/notes/archived",
  seal: VERSIONED_SEAL,
  classed: true,
  retirable: false,
  rootFiles: new Set(["AGENTS.md", "manifest.json"]),
};
const LEGACY_ARCHIVE = {
  id: "decisions",
  dir: "docs/decisions/archived",
  seal: LEGACY_SEAL,
  classed: false,
  retirable: true,
  rootFiles: new Set([".gitkeep", ".manifest.json"]),
};
const HISTORY_ARCHIVE = {
  id: "history",
  dir: "docs/history",
  seal: VERSIONED_SEAL,
  classed: false,
  nested: true,
  retirable: false,
  // The area's own README is prose about the area, not a frozen artifact.
  rootFiles: new Set(["README.md", "README_zh.md", "manifest.json"]),
};
const ARCHIVES = [NOTES_ARCHIVE, LEGACY_ARCHIVE, HISTORY_ARCHIVE];

const SEAL_HINT = "node scripts/check-archives.mjs --write";

function parseArgs(argv) {
  const fail = (message) => {
    console.error(`[check-archives] ${message}`);
    process.exit(2);
  };
  const args = { write: false, selfTest: false, base: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      args.write = true;
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--base" || arg.startsWith("--base=")) {
      if (args.base !== undefined) fail("--base given more than once");
      const value = arg === "--base" ? argv[i + 1] : arg.slice("--base=".length);
      // A transposed flag would otherwise be consumed as the ref, and a value
      // that starts with `-` would reach git as an option.
      if (!value || value.startsWith("-")) fail("--base needs a git ref");
      args.base = value;
      if (arg === "--base") i += 1;
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  if (args.selfTest && (args.write || args.base !== undefined)) {
    fail("--self-test takes no other arguments");
  }
  return args;
}

/**
 * Read every artifact under one archive. Returns the artifacts keyed by their
 * path relative to the archive root plus the closed-tree problems found on the
 * way. Throws when the archive directory itself cannot be read.
 *
 * @param {string} root Repository root, absolute.
 * @param {typeof NOTES_ARCHIVE} archive
 * @returns {{artifacts: Map<string, Buffer>, problems: string[]}}
 */
export function collectArtifacts(root, archive) {
  const archiveRoot = path.join(root, archive.dir);
  const artifacts = new Map();
  const problems = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (archive.nested) visit(abs, rel);
        else if (archive.classed && !prefix) visit(abs, rel);
        else {
          problems.push(
            `${rel}/: ${archive.classed ? "no nested directories under a class" : "the legacy archive is flat"}`,
          );
        }
        continue;
      }
      if (!entry.isFile()) {
        problems.push(`${rel}: only regular files are allowed`);
        continue;
      }
      if (!prefix && archive.rootFiles.has(entry.name)) continue;
      if (!prefix && (archive.classed || archive.nested)) {
        problems.push(`${rel}: unexpected file at the archive root`);
        continue;
      }
      artifacts.set(rel, readFileSync(abs));
    }
  };
  visit(archiveRoot, "");
  return { artifacts, problems };
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * The manifest as committed at `ref`. A baseline that predates the manifest is
 * an empty one, which is how the first sealing commit passes; a ref git cannot
 * resolve throws, so an unusable baseline is a failure and never a free pass.
 *
 * @param {string} root
 * @param {string} ref
 * @param {typeof NOTES_ARCHIVE} archive
 */
export function readBaseline(root, ref, archive) {
  git(root, ["cat-file", "-e", `${ref}^{commit}`]);
  const manifestRepoPath = `${archive.dir}/${archive.seal.manifestName}`;
  if (git(root, ["ls-tree", "--name-only", ref, "--", manifestRepoPath]).trim() === "") {
    return archive.seal.empty();
  }
  return archive.seal.parse(git(root, ["show", `${ref}:${manifestRepoPath}`]));
}

/**
 * Whether an archive has been retired as a whole.
 *
 * The legacy ADR area (`docs/decisions/`) is being folded into the notes tree,
 * so its archive directory ends up gone. Without this rule the gate would read
 * "the archive was retired" as "every sealed artifact was deleted", which is
 * the tampering it exists to catch.
 *
 * The switch is the archive directory's existence, and nothing else: absent
 * means retired, present means checked strictly. That is deliberately the
 * narrowest possible exemption, because it is the only one that cannot be
 * reached by deleting a file. A directory that still exists is checked in full,
 * so "delete the artifacts, keep the seal" and "delete the seal, keep the
 * artifacts" both fail, and a rebuilt archive is checked again rather than
 * inheriting the exemption.
 *
 * The limit this leaves, stated rather than hidden: deleting the whole
 * directory is indistinguishable from retiring it, so the seal cannot prove the
 * legacy bytes were never touched. That guarantee moves to the notes archive,
 * which is not retirable, and the retirement itself is a reviewed commit whose
 * original bytes stay in git history.
 *
 * @param {string} root Repository root, absolute.
 * @param {typeof NOTES_ARCHIVE} archive
 * @returns {boolean}
 */
export function isRetired(root, archive) {
  return archive.retirable && !existsSync(path.join(root, archive.dir));
}

/**
 * Check one archive.
 *
 * @param {object} options
 * @param {string} options.root
 * @param {typeof NOTES_ARCHIVE} options.archive
 * @param {string} [options.base]
 * @param {boolean} [options.write]
 * @param {ReadonlyArray<{archive: string, path: string, before: string, after: string}>} [options.authorized]
 * @returns {{problems: string[], checked: number, added: string[], rendered: string, retired: boolean}}
 */
export function checkArchive({
  root,
  archive,
  base = "HEAD",
  write = false,
  authorized = AUTHORIZED_RESEALS,
}) {
  if (isRetired(root, archive)) {
    return { problems: [], checked: 0, added: [], rendered: "", retired: true };
  }
  const { artifacts, problems } = collectArtifacts(root, archive);
  const manifestPath = path.join(root, archive.dir, archive.seal.manifestName);
  const manifestName = archive.seal.manifestName;

  let manifest = archive.seal.empty();
  if (existsSync(manifestPath)) {
    try {
      manifest = archive.seal.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      problems.push(`${manifestName}: ${error.message}`);
    }
  } else if (!write) {
    problems.push(`${manifestName} is required in ${archive.dir}; seal with \`${SEAL_HINT}\``);
  }

  try {
    const scoped = authorized.filter((entry) => entry.archive === archive.id);
    problems.push(...validateExtension(readBaseline(root, base, archive), manifest, scoped));
  } catch (error) {
    const detail = String(error.stderr || error.message)
      .trim()
      .split("\n")[0];
    problems.push(`${manifestName}: cannot read baseline ${JSON.stringify(base)}: ${detail}`);
  }

  const extended = extendManifest(manifest, artifacts, archive.seal);
  problems.push(...extended.problems);
  if (!write) {
    for (const artifact of extended.added) {
      problems.push(`${artifact}: archived artifact is not sealed in ${manifestName}`);
    }
  }
  return {
    problems,
    checked: artifacts.size,
    added: extended.added,
    rendered: archive.seal.render(extended.files),
    retired: false,
  };
}

/**
 * Check both archives. Problems are tagged with the archive id so a failure
 * names which manifest has to be resealed.
 *
 * @param {{root: string, base?: string, write?: boolean, authorized?: ReadonlyArray<object>}} options
 * @returns {{problems: string[], checked: number, added: string[], rendered: Map<string, string>}}
 */
export function check(options) {
  const results = ARCHIVES.map((archive) => ({
    archive,
    ...checkArchive({ ...options, archive }),
  }));
  return {
    problems: results.flatMap((r) => r.problems.map((p) => `[${r.archive.id}] ${p}`)),
    checked: results.reduce((total, r) => total + r.checked, 0),
    added: results.flatMap((r) => r.added.map((a) => `${r.archive.id}:${a}`)),
    rendered: new Map(results.map((r) => [r.archive.id, r.rendered])),
    retired: results.filter((r) => r.retired).map((r) => r.archive.id),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  let result;
  try {
    result = check({ root: REPO_ROOT, base: args.base, write: args.write });
  } catch (error) {
    // An archive this gate cannot open is an environment fault, not a lint
    // failure, so it exits 2 like the other note gates.
    console.error(`[check-archives] cannot read an archive: ${error.code ?? error.message}`);
    process.exit(2);
  }
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[check-archives] FAIL: ${problem}`);
    console.error(`[check-archives] ${result.problems.length} problem(s).`);
    process.exit(1);
  }
  if (args.write) {
    for (const archive of ARCHIVES) {
      const rendered = result.rendered.get(archive.id);
      // A retired archive has nothing to seal, and writing an empty manifest
      // into a directory that was deliberately removed would resurrect it.
      if (rendered === undefined || rendered === "") continue;
      const manifestPath = path.join(REPO_ROOT, archive.dir, archive.seal.manifestName);
      const current = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : undefined;
      if (current !== rendered) writeFileSync(manifestPath, rendered);
    }
    console.log(
      `[check-archives] sealed ${result.added.length} new artifact(s); existing seals unchanged.`,
    );
    return;
  }
  const retired = result.retired.length > 0 ? ` (retired: ${result.retired.join(", ")})` : "";
  console.log(
    `[check-archives] OK - ${result.checked} sealed artifact(s) match the live manifests${retired}.`,
  );
}

/**
 * Negative cases against throwaway git repositories. Each rule above has a case
 * that fails for exactly that rule, and the append-only rule is pinned with the
 * edit-the-file-and-its-hash attempt, because that is the one a content-only
 * check cannot see. Both archives get a case, so neither can silently drop out
 * of `ARCHIVES`.
 */
async function selfTest() {
  const failures = [];
  const expectProblem = (name, result, needle) => {
    if (!result.problems.some((p) => p.includes(needle))) {
      failures.push(
        `${name}: expected a problem containing ${JSON.stringify(needle)}, got ${JSON.stringify(result.problems)}`,
      );
    }
  };
  const expectClean = (name, result) => {
    if (result.problems.length > 0) {
      failures.push(`${name}: expected no problems, got ${JSON.stringify(result.problems)}`);
    }
  };

  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-archives-selftest-"));
  const manifestOf = (archive) => path.join(tmp, archive.dir, archive.seal.manifestName);
  const at = (archive, rel) => path.join(tmp, archive.dir, rel);
  const put = async (archive, rel, text) => {
    await mkdir(path.dirname(at(archive, rel)), { recursive: true });
    await writeFile(at(archive, rel), text);
  };
  const commit = () => {
    git(tmp, ["add", "-A"]);
    git(tmp, [
      "-c",
      "user.name=selftest",
      "-c",
      "user.email=selftest@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    ]);
  };
  const reset = async () => {
    for (const archive of ARCHIVES) {
      await rm(path.join(tmp, archive.dir), { recursive: true, force: true });
      await mkdir(path.join(tmp, archive.dir), { recursive: true });
    }
    await writeFile(at(NOTES_ARCHIVE, "AGENTS.md"), "# archive\n");
    await writeFile(at(LEGACY_ARCHIVE, ".gitkeep"), "");
  };
  const seal = () => {
    const sealed = check({ root: tmp, write: true });
    for (const archive of ARCHIVES)
      writeFileSync(manifestOf(archive), sealed.rendered.get(archive.id));
    return sealed;
  };

  try {
    git(tmp, ["init", "-q"]);

    // 1. The reserved place: two empty archives with empty manifests are valid.
    await reset();
    seal();
    commit();
    expectClean("empty archives with empty manifests", check({ root: tmp }));

    // 2. A missing manifest fails verification; `--write` is what creates it.
    for (const archive of ARCHIVES) await rm(manifestOf(archive));
    expectProblem("missing manifest", check({ root: tmp }), "is required");
    expectClean("write mode creates the missing manifests", check({ root: tmp, write: true }));

    // 3. A new artifact must be sealed; sealing appends and leaves older entries
    //    alone. One artifact per archive, so both are exercised from here on.
    await reset();
    await put(NOTES_ARCHIVE, "process/2026-01-01-topic.md", "one\n");
    await put(LEGACY_ARCHIVE, "2026-01-01-legacy.en.md", "legacy one\n");
    seal();
    commit();
    expectClean("sealed artifacts verify", check({ root: tmp }));
    const before = readFileSync(manifestOf(NOTES_ARCHIVE), "utf8");
    await put(NOTES_ARCHIVE, "process/2026-02-02-later.md", "two\n");
    expectProblem("an unsealed artifact fails", check({ root: tmp }), "is not sealed");
    const sealedLater = seal();
    if (sealedLater.added.join() !== "notes:process/2026-02-02-later.md") {
      failures.push(
        `write mode appends only the new artifact, got ${JSON.stringify(sealedLater.added)}`,
      );
    }
    const oldEntry = JSON.parse(before).files["process/2026-01-01-topic.md"];
    const afterEntry = JSON.parse(readFileSync(manifestOf(NOTES_ARCHIVE), "utf8")).files[
      "process/2026-01-01-topic.md"
    ];
    if (afterEntry !== oldEntry) failures.push("write mode must not rewrite an existing seal");
    commit();

    // 4. Editing a sealed artifact fails, even by one byte.
    await put(NOTES_ARCHIVE, "process/2026-01-01-topic.md", "one \n");
    expectProblem("an edited sealed artifact", check({ root: tmp }), "sealed content changed");

    // 5. Write mode never reseals an edit: it fails the same way.
    expectProblem(
      "write mode refuses an edited artifact",
      check({ root: tmp, write: true }),
      "sealed content changed",
    );

    // 6. Deleting a sealed artifact fails.
    await rm(at(NOTES_ARCHIVE, "process/2026-01-01-topic.md"));
    expectProblem("a deleted sealed artifact", check({ root: tmp }), "sealed artifact is missing");

    // 7. Edit the file and its hash together: content matches the manifest, the
    //    baseline comparison is the only thing that sees it.
    await put(NOTES_ARCHIVE, "process/2026-01-01-topic.md", "tampered\n");
    const tampered = JSON.parse(readFileSync(manifestOf(NOTES_ARCHIVE), "utf8"));
    tampered.files["process/2026-01-01-topic.md"] = sealHash(Buffer.from("tampered\n"));
    writeFileSync(manifestOf(NOTES_ARCHIVE), VERSIONED_SEAL.render(tampered.files));
    expectProblem(
      "file and hash edited together",
      check({ root: tmp }),
      "sealed manifest hash changed",
    );

    // 8. The exact authorised pair is the one sanctioned way through, and it is
    //    scoped to its archive: the same pair aimed at the other archive is not
    //    a licence to change this one.
    const authorized = [
      {
        archive: "notes",
        path: "process/2026-01-01-topic.md",
        before: oldEntry,
        after: sealHash(Buffer.from("tampered\n")),
      },
    ];
    expectClean("an exact authorised reseal", check({ root: tmp, authorized }));
    const wrongAfter = [{ ...authorized[0], after: sealHash(Buffer.from("other\n")) }];
    expectProblem(
      "an authorised pair with another end hash",
      check({ root: tmp, authorized: wrongAfter }),
      "sealed manifest hash changed",
    );
    const wrongArchive = [{ ...authorized[0], archive: "decisions" }];
    expectProblem(
      "an authorised pair aimed at the other archive",
      check({ root: tmp, authorized: wrongArchive }),
      "sealed manifest hash changed",
    );

    // 8b. `--base` is honoured, not merely defaulted to HEAD. The tampered tree
    //     is committed, so a baseline of HEAD agrees with it and the content
    //     check passes; the same tree against the commit that still held the
    //     original seal is caught. Without this case a gate that ignored the
    //     ref and always read HEAD would pass every other case here.
    const originalSha = git(tmp, ["rev-parse", "HEAD"]).trim();
    commit();
    expectClean("a tampered tree against its own HEAD", check({ root: tmp }));
    expectProblem(
      "the same tree against the pre-tamper base",
      check({ root: tmp, base: originalSha }),
      "sealed manifest hash changed",
    );

    // 9. Dropping a manifest entry (and its file) fails against the baseline.
    await reset();
    await put(NOTES_ARCHIVE, "process/2026-02-02-later.md", "two\n");
    writeFileSync(
      manifestOf(NOTES_ARCHIVE),
      VERSIONED_SEAL.render({ "process/2026-02-02-later.md": sealHash(Buffer.from("two\n")) }),
    );
    expectProblem(
      "a dropped manifest entry",
      check({ root: tmp }),
      "sealed manifest entry is missing",
    );

    // 10. The closed tree, for both layouts.
    git(tmp, ["checkout", "-q", "--", "."]);
    await put(NOTES_ARCHIVE, "stray.txt", "x\n");
    expectProblem(
      "an unexpected root file",
      check({ root: tmp }),
      "unexpected file at the archive root",
    );
    await rm(at(NOTES_ARCHIVE, "stray.txt"));
    await put(NOTES_ARCHIVE, "process/nested/deep.md", "x\n");
    expectProblem("a nested directory", check({ root: tmp }), "no nested directories");
    await rm(at(NOTES_ARCHIVE, "process/nested"), { recursive: true });
    await put(LEGACY_ARCHIVE, "nested/deep.md", "x\n");
    expectProblem(
      "a directory in the legacy archive",
      check({ root: tmp }),
      "the legacy archive is flat",
    );
    await rm(at(LEGACY_ARCHIVE, "nested"), { recursive: true });

    // 11. The legacy archive is covered by the same byte rule, and its failure
    //     names that archive so a reader knows which manifest to reseal.
    await put(LEGACY_ARCHIVE, "2026-01-01-legacy.en.md", "legacy tampered\n");
    expectProblem(
      "an edited legacy artifact",
      check({ root: tmp }),
      "[decisions] 2026-01-01-legacy.en.md: sealed content changed",
    );
    git(tmp, ["checkout", "-q", "--", "."]);

    // 12. A baseline git cannot resolve fails; it never silently passes.
    expectProblem(
      "an unresolvable baseline",
      check({ root: tmp, base: "no-such-ref" }),
      "cannot read baseline",
    );

    // 13. A missing archive is an environment fault: the check throws. The
    //     notes archive is the live one, so it is never retirable.
    await rm(path.join(tmp, NOTES_ARCHIVE.dir), { recursive: true, force: true });
    let threw = false;
    try {
      check({ root: tmp });
    } catch {
      threw = true;
    }
    if (!threw) failures.push("a missing archive directory must throw, not report green");

    // 13b. The legacy archive is retirable, and retirement is the only way a
    //      sealed artifact may disappear. Removing the whole directory is the
    //      shape the ADR migration leaves behind, so it must be clean and must
    //      report which archive was skipped.
    await reset();
    seal();
    commit();
    await rm(path.join(tmp, LEGACY_ARCHIVE.dir), { recursive: true, force: true });
    const retired = check({ root: tmp });
    expectClean("a removed legacy archive is retired", retired);
    if (retired.retired.join() !== "decisions") {
      failures.push(`retirement must name the archive, got ${JSON.stringify(retired.retired)}`);
    }

    // 13c. A legacy directory that still exists is checked strictly, even when
    //      it is empty: only removing the directory retires the archive. This
    //      is what keeps "delete the seal, keep the directory" from reading as
    //      retirement.
    await reset();
    seal();
    commit();
    await rm(manifestOf(LEGACY_ARCHIVE));
    expectProblem(
      "an empty legacy directory still needs its manifest",
      check({ root: tmp }),
      "[decisions] .manifest.json is required",
    );

    // 13d. Half-retired states are not retirement. A manifest with no artifacts
    //      is "delete the file, keep the seal"; artifacts with no manifest is
    //      "delete the seal, keep the file". Both must fail, or retirement would
    //      be a hole a tamperer could walk through.
    await reset();
    await put(LEGACY_ARCHIVE, "2026-01-01-legacy.en.md", "legacy\n");
    seal();
    commit();
    await rm(at(LEGACY_ARCHIVE, "2026-01-01-legacy.en.md"));
    expectProblem(
      "a manifest whose artifacts were deleted",
      check({ root: tmp }),
      "[decisions] 2026-01-01-legacy.en.md: sealed artifact is missing",
    );
    await reset();
    await put(LEGACY_ARCHIVE, "2026-01-01-legacy.en.md", "legacy\n");
    seal();
    commit();
    await rm(manifestOf(LEGACY_ARCHIVE));
    expectProblem(
      "artifacts whose manifest was deleted",
      check({ root: tmp }),
      "[decisions] .manifest.json is required",
    );

    // 13e. Retirement is keyed on the directory, not on a hardcoded path: a
    //      rebuilt legacy archive is checked strictly again, so the exemption
    //      cannot be inherited by a directory that comes back.
    await reset();
    seal();
    commit();
    await rm(path.join(tmp, LEGACY_ARCHIVE.dir), { recursive: true, force: true });
    expectClean("retired legacy archive", check({ root: tmp }));
    await put(LEGACY_ARCHIVE, "2026-01-01-rebuilt.en.md", "rebuilt\n");
    expectProblem(
      "a rebuilt legacy archive is checked again",
      check({ root: tmp }),
      "[decisions] .manifest.json is required",
    );

    // 14. Manifest schema, in memory, for both shapes.
    const good = `sha256:${"a".repeat(64)}`;
    const bare = "a".repeat(64);
    const parseFails = (name, seal, value) => {
      try {
        seal.parse(JSON.stringify(value));
        failures.push(`${name}: parse accepted it`);
      } catch {
        // rejected, as intended
      }
    };
    parseFails("an extra field", VERSIONED_SEAL, { version: 1, files: {}, extra: 1 });
    parseFails("a wrong version", VERSIONED_SEAL, { version: 2, files: {} });
    parseFails("a short hash", VERSIONED_SEAL, {
      version: 1,
      files: { "process/a.md": "sha256:abc" },
    });
    parseFails("a path outside {class}/{file}", VERSIONED_SEAL, {
      version: 1,
      files: { "a.md": good },
    });
    parseFails("a parent-directory path", VERSIONED_SEAL, {
      version: 1,
      files: { "../a.md": good },
    });
    parseFails("a nested artifact path", VERSIONED_SEAL, {
      version: 1,
      files: { "process/x/a.md": good },
    });
    parseFails("a bare hash in the versioned shape", VERSIONED_SEAL, {
      version: 1,
      files: { "process/a.md": bare },
    });
    parseFails("a prefixed hash in the legacy shape", LEGACY_SEAL, { "a.md": good });
    parseFails("a classed path in the legacy shape", LEGACY_SEAL, { "process/a.md": bare });
    parseFails("a versioned manifest read as the legacy shape", LEGACY_SEAL, {
      version: 1,
      files: {},
    });

    // 15. The rendered order is fixed by code unit, not by locale, in both shapes.
    const order = Object.keys(
      JSON.parse(VERSIONED_SEAL.render({ "b/x.md": good, "B/x.md": good, "a/x.md": good })).files,
    );
    if (order.join() !== "B/x.md,a/x.md,b/x.md") {
      failures.push(`versioned manifest order is not code-unit order: ${order}`);
    }
    const legacyOrder = Object.keys(
      JSON.parse(LEGACY_SEAL.render({ "b.md": bare, "B.md": bare, "a.md": bare })),
    );
    if (legacyOrder.join() !== "B.md,a.md,b.md") {
      failures.push(`legacy manifest order is not code-unit order: ${legacyOrder}`);
    }

    // 16. The CLI refuses what it does not understand instead of ignoring it.
    const cli = (args) => {
      try {
        execFileSync(process.execPath, [SCRIPT, ...args], { stdio: "pipe" });
        return 0;
      } catch (error) {
        return error.status;
      }
    };
    if (cli(["--bogus"]) !== 2) failures.push("an unknown argument must exit 2");
    if (cli(["--base"]) !== 2) failures.push("--base without a ref must exit 2");
    if (cli(["--base", "--write"]) !== 2)
      failures.push("--base given a flag as its ref must exit 2");
    if (cli(["--self-test", "--write"]) !== 2) {
      failures.push("--self-test with other arguments must exit 2");
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("[check-archives] self-test FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    "[check-archives] self-test passed (empty archives, missing manifests, unsealed, edited, deleted, file and hash edited together, authorised reseal, dropped entry, closed tree in both layouts, legacy coverage, bad baseline, missing archive, retirement and its half-retired states, schema for both shapes, order, arguments).",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) main();
