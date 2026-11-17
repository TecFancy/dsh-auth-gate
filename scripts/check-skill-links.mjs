#!/usr/bin/env node
/**
 * Skill link gate (zero-dependency).
 *
 * Verifies every relative Markdown link inside `.agents/skills/` (each
 * `SKILL.md`, its `references/`, and the skills README):
 *   1. It resolves to an existing path in this repository.
 *   2. It does not escape the repository.
 *   3. A `#section` fragment names a heading or anchor that exists in the target.
 *
 * Why this gate exists. Skills link to each other (`../frontend-patterns/SKILL.md`),
 * into their own `references/`, and out to the repository (`../../../AGENTS.md`,
 * `../../../docs/conventions.md`). `check-docs.mjs` walks `docs/` and the root
 * files and `check-note-links.mjs` walks the note tree; nothing walked this tree,
 * so renaming a skill or a reference file left every inbound link dead with no
 * gate in the way, and a consumer follows those links to learn what to do next.
 *
 * Differences from the note gate, on purpose:
 *   - No locale rule. Skills are single-language files with no `.zh.md` twin,
 *     and a link from a skill to `docs/conventions.md` is right even though that
 *     file has a Chinese counterpart.
 *   - No `--root` flag. The self-test calls `check()` against throwaway trees
 *     in-process, so no flag can aim a real run at another tree and report green.
 *
 * The generated mirror `.claude/skills/` is not scanned: it is a gitignored byte
 * copy, and its `../../../` links resolve from a different depth by design.
 *
 * Link extraction and resolution come from `lib/md-links.mjs`, shared with
 * `check-docs.mjs` and `check-note-links.mjs` so the gates cannot disagree about
 * what a link is.
 *
 * Usage:
 *   node scripts/check-skill-links.mjs              # exit 1 on violations
 *   node scripts/check-skill-links.mjs --self-test  # run the negative cases
 *
 * Exit codes: 0 clean, 1 a link problem, 2 an environment fault (the skills tree
 * cannot be read or has no Markdown in it, a bad argument).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { collectLinks, deadFragments, resolveInRepo } from "./lib/md-links.mjs";

const TAG = "[check-skill-links]";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_REL = ".agents/skills";

function parseArgs(argv) {
  const args = { selfTest: false };
  for (const arg of argv) {
    if (arg === "--self-test") {
      args.selfTest = true;
    } else {
      console.error(`${TAG} unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

/** Every `.md` file under `dir`, sorted. Throws when a directory cannot be read. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(abs);
  }
  return out.sort();
}

/**
 * Check the skills tree under `root`.
 *
 * @returns {Promise<{problems: string[], files: number}>}
 * @throws when the skills directory cannot be read (an environment fault).
 */
export async function check(root) {
  const files = walk(path.join(root, SKILLS_REL));
  // A tree with no Markdown in it is one this gate must not call clean.
  if (files.length === 0) throw Object.assign(new Error("no Markdown files"), { code: "EMPTY" });

  const loadTarget = async (rel) => {
    try {
      const abs = path.join(root, rel);
      return statSync(abs).isFile() ? readFileSync(abs, "utf8") : undefined;
    } catch {
      return undefined;
    }
  };

  const problems = [];
  for (const abs of files) {
    const from = path.relative(root, abs).split(path.sep).join("/");
    const text = readFileSync(abs, "utf8");
    for (const link of collectLinks(text)) {
      const target = resolveInRepo(root, abs, link);
      if (target.kind === "escape") {
        problems.push(
          `${from}: link escapes the repository -> ${link} (resolves to ${target.rel})`,
        );
      } else if (!existsSync(target.abs)) {
        problems.push(`${from}: broken link -> ${link} (resolves to ${target.rel})`);
      }
    }
    for (const dead of await deadFragments(text, loadTarget, (t) => resolveInRepo(root, abs, t))) {
      problems.push(
        `${from}: dead link fragment -> ${dead.ref} (no heading or anchor \`${dead.fragment}\` in ${dead.targetRel || from})`,
      );
    }
  }
  return { problems, files: files.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();

  let result;
  try {
    result = await check(REPO_ROOT);
  } catch (error) {
    console.error(`${TAG} cannot check ${SKILLS_REL}: ${error.code ?? error.message}`);
    process.exit(2);
  }
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`${TAG} FAIL: ${problem}`);
    console.error(`${TAG} ${result.problems.length} problem(s). Fix and re-run.`);
    process.exit(1);
  }
  console.log(`${TAG} OK - ${result.files} skill Markdown files, links resolve.`);
}

/** Negative cases, each against a throwaway tree so the real skills are never read. */
async function selfTest() {
  const failures = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), "check-skill-links-selftest-"));
  try {
    const build = async (name, files) => {
      const root = path.join(tmp, name);
      for (const [rel, body] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
        await writeFile(path.join(root, rel), body);
      }
      return root;
    };
    const verdict = async (name, files) => check(await build(name, files));
    const skill = (body) => `# Skill\n\n${body}\n`;

    const clean = await verdict("clean", {
      "AGENTS.md": "# Agents\n",
      "docs/conventions.md": "# Conventions\n\n## Gates\n",
      ".agents/skills/a/SKILL.md": skill(
        "See [b](../b/SKILL.md), [ref](references/r.md), [repo](../../../AGENTS.md#agents), [gates](../../../docs/conventions.md#gates).",
      ),
      ".agents/skills/a/references/r.md": "# R\n\nBack to [a](../SKILL.md).\n",
      ".agents/skills/b/SKILL.md": skill("Plain."),
    });
    if (clean.problems.length !== 0)
      failures.push(`a clean tree reported: ${clean.problems.join("; ")}`);
    if (clean.files !== 3) failures.push(`clean tree counted ${clean.files} files, expected 3`);

    const expectProblem = async (name, files, needle) => {
      const { problems } = await verdict(name, files);
      if (!problems.some((p) => p.includes(needle))) {
        failures.push(
          `${name}: expected a problem containing "${needle}", got [${problems.join("; ")}]`,
        );
      }
    };
    await expectProblem(
      "sibling-skill-renamed",
      {
        ".agents/skills/a/SKILL.md": skill("See [b](../b/SKILL.md)."),
        ".agents/skills/c/SKILL.md": skill("x"),
      },
      "broken link -> ../b/SKILL.md",
    );
    await expectProblem(
      "reference-removed",
      { ".agents/skills/a/SKILL.md": skill("See [r](references/gone.md).") },
      "broken link -> references/gone.md",
    );
    await expectProblem(
      "repo-file-moved",
      { ".agents/skills/a/SKILL.md": skill("See [x](../../../docs/gone.md).") },
      "broken link -> ../../../docs/gone.md",
    );
    await expectProblem(
      "escapes",
      { ".agents/skills/a/SKILL.md": skill("See [x](../../../../outside.md).") },
      "link escapes the repository",
    );
    await expectProblem(
      "dead-fragment",
      {
        ".agents/skills/a/SKILL.md": skill("See [x](references/r.md#nope)."),
        ".agents/skills/a/references/r.md": "# R\n\n## Real\n",
      },
      "dead link fragment",
    );
    await expectProblem(
      "dead-fragment-same-file",
      { ".agents/skills/a/SKILL.md": skill("See [x](#nope).") },
      "dead link fragment",
    );

    // Shapes that must stay quiet: a link shown in code, an external URL, a mailto.
    const quiet = await verdict("quiet", {
      ".agents/skills/a/SKILL.md": skill(
        "Example `[x](gone.md)`.\n\n```md\n[y](also-gone.md)\n```\n\n[ext](https://example.com/x) [mail](mailto:a@b.c)",
      ),
    });
    if (quiet.problems.length !== 0)
      failures.push(`code, external and mailto links reported: ${quiet.problems.join("; ")}`);

    // Environment faults must throw, not read as a clean tree.
    let missing = false;
    try {
      await check(path.join(tmp, "no-such-root"));
    } catch {
      missing = true;
    }
    if (!missing) failures.push("a missing skills directory did not throw");
    let empty = false;
    try {
      await mkdir(path.join(tmp, "empty", SKILLS_REL, "a"), { recursive: true });
      await check(path.join(tmp, "empty"));
    } catch (error) {
      empty = error.code === "EMPTY";
    }
    if (!empty) failures.push("a skills tree with no Markdown did not throw");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const failure of failures) console.error(`${TAG} SELF-TEST FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(
    `${TAG} self-test passed (clean tree, renamed sibling, removed reference, moved repo file, repository escape, dead fragments, quiet shapes, missing and empty tree).`,
  );
}

await main();
