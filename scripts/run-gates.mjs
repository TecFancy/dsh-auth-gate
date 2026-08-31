#!/usr/bin/env node
// Scenario gate runner (M3): named scenarios assembled from the same gates as
// `npm run verify`, plus automatic selection of the minimal evidence set for
// the change surface. Pre-push runs this via `.husky/pre-push`; full coverage
// is CI's job, not every local run's. Fail-closed: unknown change shapes or a
// broken git state fall back to the full set, never to a weaker one.
//
// This file is the shared template across the TecFancy dsh repos: the gate
// list is NOT hardcoded — it is derived from the `verify` chain in
// package.json (every `npm run <gate>` segment), and each gate is classified
// into a scenario by name. Repos with a leaner verify chain automatically get
// leaner scenarios.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// gate name -> scenario. Keep in sync when a repo adds a gate to verify.
const SCENE_OF = {
  "format:check": "hygiene",
  lint: "hygiene",
  "lint:no-emdash": "hygiene",
  "slice:check": "hygiene",
  "aliases:check": "hygiene",
  "lock:check": "hygiene",
  "decisions:check": "hygiene",
  "docs:check": "hygiene",
  "type-check": "types",
  typecheck: "types",
  "test:coverage": "tests",
  test: "tests",
  build: "build",
  "bundle:check": "build",
};

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const verifyScript = pkg.scripts?.verify ?? "";
const GATES = verifyScript
  .split("&&")
  .map((part) => part.trim())
  .filter((part) => part.startsWith("npm run "))
  .map((part) => part.replace(/^npm run /, ""));

if (GATES.length === 0) {
  console.error(
    "package.json has no `verify` chain of `npm run <gate>` segments — the M2 baseline is missing. See AGENTS.md.",
  );
  process.exit(2);
}
const unknownGates = GATES.filter((gate) => !SCENE_OF[gate]);
if (unknownGates.length > 0) {
  console.error(
    `verify chain contains gates without a scenario mapping: ${unknownGates.join(", ")} - add them to SCENE_OF in scripts/run-gates.mjs.`,
  );
  process.exit(2);
}

const SCENARIOS = { hygiene: [], types: [], tests: [], build: [], verify: GATES };
for (const gate of GATES) SCENARIOS[SCENE_OF[gate]].push(gate);

// Change-surface rules: the first matching rule per changed file wins, and the
// union of the matched scenarios is what runs. `verify` is the fail-closed
// answer for shapes the map does not know (dependency changes, unknown files).
const RULES = [
  { re: /^src\//, scenes: ["hygiene", "types", "tests", "build"] },
  { re: /^lib\//, scenes: ["hygiene", "build"] }, // build artifacts
  {
    re: /^(scripts\/|.*\.config\.(js|mjs|ts)$|aliases\.json|tsconfig.*\.json$)/,
    scenes: ["hygiene", "types"],
  },
  {
    re: /^(package\.json|package-lock\.json|\.npmrc)$/,
    scenes: ["verify"], // dependency changes ripple everywhere
  },
  { re: /^(docs\/|AGENTS\.md|README\.md|.*\.md$)/, scenes: ["hygiene"] },
  { re: /^\./, scenes: ["hygiene"] }, // dotfiles: .github, .husky, ...
  { re: /.*/, scenes: ["verify"] }, // unknown -> full set
];

function expand(scenes) {
  const gates = [];
  for (const scene of scenes) {
    for (const gate of SCENARIOS[scene]) {
      if (!gates.includes(gate)) gates.push(gate);
    }
  }
  return gates;
}

function changedFiles(base) {
  let tracked = null;
  for (const candidate of [base, "HEAD"]) {
    const result = spawnSync("git", ["diff", "--name-only", candidate], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status === 0) {
      tracked = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      break;
    }
  }
  if (tracked === null) return null; // not a git checkout
  // `git diff` never lists untracked files — a new src/ file would otherwise
  // skip type-check/tests entirely. Fold them in (status short format: "?? path").
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const untracked =
    status.status === 0
      ? status.stdout
          .split("\n")
          .filter((line) => line.startsWith("?? "))
          .map((line) => line.slice(3))
          .filter(Boolean)
      : [];
  return [...new Set([...tracked, ...untracked])];
}

function runGates(gates) {
  for (const gate of gates) {
    console.log(`\n=== ${gate} ===`);
    const result = spawnSync("npm", ["run", gate], {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      console.error(`\n✖ ${gate} failed — fix it and re-run.`);
      process.exit(result.status ?? 1);
    }
  }
}

const args = process.argv.slice(2);
let scenario = null;
let base = "HEAD";
if (args.includes("--list")) {
  console.log("Scenarios (named gate sets, same gates as `npm run verify`):\n");
  for (const [name, gates] of Object.entries(SCENARIOS)) {
    console.log(`  ${name.padEnd(8)} ${gates.join(", ")}`);
  }
  console.log("\nUsage: node scripts/run-gates.mjs [--scenario <name>] [--base <ref>]");
  console.log(
    "  default: auto-detect the change surface against HEAD (pre-push passes --base @{u})",
  );
  process.exit(0);
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--scenario") scenario = args[++i];
  else if (args[i] === "--base") base = args[++i];
  else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

if (scenario) {
  if (!SCENARIOS[scenario]) {
    console.error(`Unknown scenario "${scenario}" — see --list.`);
    process.exit(2);
  }
  const gates = expand([scenario]);
  console.log(`Scenario ${scenario}: ${gates.length} gates\n`);
  runGates(gates);
  console.log(`\n✓ ${scenario} passed (${gates.length} gates).`);
  process.exit(0);
}

const files = changedFiles(base);
if (files === null) {
  console.error("Not a git checkout — pass --scenario <name> explicitly (see --list).");
  process.exit(2);
}
if (files.length === 0) {
  console.log("No changes since the base — running the hygiene scenario.");
  runGates(expand(["hygiene"]));
  console.log("\n✓ hygiene passed (no changes found).");
  process.exit(0);
}

const scenes = new Set();
for (const file of files) {
  const rule = RULES.find((r) => r.re.test(file));
  for (const scene of rule.scenes) scenes.add(scene);
}
const gates = expand([...scenes]);
const full = scenes.has("verify") || gates.length === GATES.length;
console.log(
  `Auto-detected ${files.length} changed file(s) → scenarios: ${[...scenes].join(", ")}` +
    (full ? " (full set)" : "") +
    "\n",
);
runGates(gates);
console.log(`\n✓ ${full ? "full set" : [...scenes].join(" + ")} passed (${gates.length} gates).`);
