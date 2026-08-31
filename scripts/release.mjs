#!/usr/bin/env node
/**
 * Release orchestration for dsh release-please repos
 * (development → main → npm, or main-direct repos like dsh-collab).
 *
 * Works from ANY dsh repo root (reads package.json for the npm name);
 * the authoritative copy lives in the workspace at
 * .dsh/scripts/release.mjs (mirrored into dsh-auth-gate/scripts/).
 *
 * Subcommands (run from the repo root):
 *   check             - environment & readiness (gh auth, remote, branch,
 *                       clean tree, unpushed commits)
 *   pr                - push the current branch + open PR against main
 *                       (--title required)
 *   merge-pr <n|url>  - wait for CI on the PR to pass, then squash-merge
 *                       (never --delete-branch)
 *   release-pr        - find the open release-please PR (chore(main): release)
 *                       and squash-merge it
 *   wait-publish      - poll the npm registry until the expected version is
 *                       published (--version <v> required; --package to
 *                       override the name read from package.json)
 *   sync-back         - merge origin/main back into the base branch & push
 *   ship --title <t>  - run the whole chain end to end
 *
 * Flags:
 *   --branch <name>   - base branch (default development; use main for
 *                       repos without a development branch)
 *
 * Rules baked in (see the target repo's development.md "Releases"):
 *   - PRs merge into main with squash (one conventional commit per PR)
 *   - never pass --delete-branch when merging promotion PRs
 *   - the PR title's conventional type drives the release-please bump
 *     (feat → minor, fix → patch)
 *   - release PRs usually carry no required checks; merge once they appear
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const BASE = flag("--branch") ?? "development";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    process.stderr.write(`gh ${args.join(" ")}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  return r.stdout.trim();
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] }).trim();
  } catch (error) {
    process.stderr.write(`command failed: ${cmd}\n`);
    process.exit(1);
    return undefined;
  }
}

function pkgName() {
  try {
    return JSON.parse(readFileSync("package.json", "utf8")).name;
  } catch {
    return undefined;
  }
}

const bumpHint = (title) =>
  /^feat(\(|:)/.test(title)
    ? "minor (feat)"
    : /^fix(\(|:)/.test(title)
      ? "patch (fix)"
      : /^(docs|chore|test|ci|style|refactor|build|perf|revert)(\(|:)/.test(title)
        ? "none (docs/chore family)"
        : "UNKNOWN TYPE — check the title";

function check() {
  const branch = sh("git branch --show-current");
  const npmName = pkgName() ?? "(no package.json)";
  if (branch !== BASE) {
    console.error(`✗ must be on '${BASE}' (on '${branch}') — use --branch to override`);
    process.exit(1);
  }
  const dirty = sh("git status --porcelain");
  if (dirty !== "") {
    console.error(`✗ working tree is dirty — commit or stash first:\n${dirty}`);
    process.exit(1);
  }
  gh(["auth", "status"]);
  const ahead = Number(sh(`git rev-list --count origin/${BASE}..${BASE}`) || 0);
  console.log(`✓ on ${BASE}, tree clean, ${ahead} unpushed commit(s)`);
  console.log(
    `✓ npm package: ${npmName}, gh authenticated, origin = ${sh("git remote get-url origin")}`,
  );
  if (ahead === 0) console.log("  (nothing to release — did you commit?)");
}

function openPr(title) {
  if (!title) {
    console.error("✗ --title required (its conventional type decides the version bump)");
    process.exit(1);
  }
  console.log(`  bump: ${bumpHint(title)}`);
  sh(`git push origin HEAD`);
  const head = sh("git branch --show-current");
  const url = gh([
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    head,
    "--title",
    title,
    "--body",
    "Automated release via .dsh/scripts/release.mjs. CI runs the full matrix on this PR.",
  ]);
  console.log(`✓ PR opened: ${url}`);
  return url.split("/").pop();
}

async function mergePr(pr) {
  console.log(`  waiting for CI on PR #${pr}…`);
  gh(["pr", "checks", pr, "--watch"]);
  const title = gh(["pr", "view", pr, "--json", "title", "--jq", ".title"]);
  gh(["pr", "merge", pr, "--squash", "--subject", title]);
  console.log(`✓ PR #${pr} squash-merged into main (no --delete-branch)`);
}

async function releasePr() {
  // release-please opens the PR on push to main; poll briefly
  for (let i = 0; i < 20; i++) {
    const lines = gh([
      "pr",
      "list",
      "--state",
      "open",
      "--json",
      "number,title,headRefName",
      "--jq",
      `.[] | select(.headRefName | startswith("release-please--branches--main")) | [.number, .title] | @tsv`,
    ])
      .split("\n")
      .filter(Boolean);
    if (lines.length > 0) {
      const [n, title] = lines[0].split("\t");
      console.log(`  release PR #${n}: ${title}`);
      gh(["pr", "merge", n, "--squash", "--subject", title]);
      const version = /release (\d+\.\d+\.\d+)/.exec(title)?.[1] ?? "";
      console.log(`✓ release PR merged → version ${version}`);
      return version;
    }
    await sleep(15_000);
  }
  console.error("✗ no release PR appeared within 5 min — check the Release workflow");
  process.exit(1);
  return "";
}

async function waitPublish(version) {
  const pkg = flag("--package") ?? pkgName();
  if (!version) {
    console.error("✗ --version required (e.g. 0.12.0)");
    process.exit(1);
  }
  if (!pkg) {
    console.error(
      "✗ cannot read package.json name here — run from the repo root or pass --package",
    );
    process.exit(1);
  }
  console.log(`  waiting for ${pkg}@${version} on npm…`);
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    try {
      const out = execSync(`npm view ${pkg}@${version} version`, { encoding: "utf8" });
      if (out.trim() !== "") {
        console.log(`✓ published: ${pkg}@${version}`);
        return;
      }
    } catch {
      /* not yet */
    }
    await sleep(15_000);
  }
  console.error(`✗ ${version} not on npm within 5min — check the Release workflow`);
  process.exit(1);
}

function syncBack() {
  if (BASE === "main") {
    console.log("  (main-based repo — nothing to sync back)");
    return;
  }
  sh("git fetch origin main");
  sh("git merge origin/main --no-edit");
  sh("git push origin HEAD");
  console.log("✓ origin/main merged back into development and pushed");
}

async function main() {
  const cmd = process.argv[2] ?? "check";
  switch (cmd) {
    case "check":
      check();
      break;
    case "pr":
      openPr(flag("--title"));
      break;
    case "merge-pr":
      await mergePr(process.argv[3]);
      break;
    case "release-pr":
      await releasePr();
      break;
    case "wait-publish":
      await waitPublish(flag("--version"));
      break;
    case "sync-back":
      syncBack();
      break;
    case "ship": {
      const title = flag("--title");
      check();
      const pr = openPr(title);
      await mergePr(pr);
      const version = await releasePr();
      await waitPublish(version);
      syncBack();
      console.log(`🎉 shipped: ${version} — PR #${pr} → main → npm`);
      break;
    }
    default:
      console.log(
        "usage: node release.mjs <check|pr|merge-pr|release-pr|wait-publish|sync-back|ship>\n" +
          "  flags: --title <t> --version <v> --package <npm-name> --branch <base>",
      );
      process.exit(2);
  }
}

main();
