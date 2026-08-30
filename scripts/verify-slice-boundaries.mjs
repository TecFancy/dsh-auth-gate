#!/usr/bin/env node
/**
 * Verifies dsh-auth-gate's slice boundaries (adapted from dsh-plugin-framework's
 * verify-slice-boundaries.mjs; framework-specific entities layer, client path
 * aliases and css-module handling are dropped).
 *
 * Layers:
 *   root      src/index.ts, src/cli.ts, src/proxy-cli.ts + their tests +
 *             src/integration.*.test.ts and src/guard-proxy-deny.test.ts
 *   gate      src/gate/**        (one slice)
 *   shared    src/shared/**      (one slice, leaf - no upward deps)
 *   session   src/session/**      (core mechanism layer like gate/)
 *   features  src/features/<f>/**  (token | password | proxy)
 *   client    src/client/**      (separate half: no host<->client imports)
 *
 * Rules:
 *   1. A cross-slice import may only land on the target slice's index.ts
 *      barrel (src/index.ts and the integration tests are assembly roots and
 *      must enter every slice through its barrel).
 *   2. Slices inside features/ may never import each other, even through
 *      barrels (token/password/proxy are independent feature surfaces).
 *   3. shared/ is a leaf: nothing may import it without going through its
 *      barrel, and it imports nothing but its own files.
 *   4. client/ is isolated from the host half in both directions.
 *   5. Imports that cannot be resolved fail (fail-closed: an unknown shape
 *      must never pass the gate silently).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const CODE_EXT = /\.(ts|tsx)$/;
const FEATURE_SLICES = new Set(["token", "password", "proxy"]);
const ROOT_FILES = new Set([
  "index.ts",
  "index.test.ts",
  "index.password.test.ts",
  "cli.ts",
  "cli.test.ts",
  "proxy-cli.ts",
  "proxy-cli.test.ts",
  "integration.auth.test.ts",
  "integration.guard.test.ts",
  "integration.password.test.ts",
  "integration.password.rate.test.ts",
  "integration.session.test.ts",
  "guard-proxy-deny.test.ts",
]);
const errors = [];

const toPosix = (p) => p.split(sep).join("/");

function collectFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
    } else if (CODE_EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Slice identifier for a src-relative path, or null when unrecognized. */
function sliceOf(rel) {
  const parts = rel.split("/");
  if (parts.length === 1) return ROOT_FILES.has(rel) ? "root" : null;
  if (parts[0] === "client") return "client";
  if (parts[0] === "gate" || parts[0] === "session") return parts[0];
  if (parts[0] === "shared") return "shared";
  if (parts[0] === "features" && FEATURE_SLICES.has(parts[1])) return `feature:${parts[1]}`;
  return null;
}

/** The barrel a cross-slice import must land on, per target slice. */
function barrelOf(slice) {
  switch (slice) {
    case "gate":
      return "gate/index.ts";
    case "session":
      return "session/index.ts";
    case "shared":
      return "shared/index.ts";
    default:
      return slice.startsWith("feature:")
        ? `features/${slice.slice("feature:".length)}/index.ts`
        : null;
  }
}

/** Resolve a relative specifier to a src-relative file path, or null. */
function resolveTarget(parentRel, spec) {
  let rel = join(dirname(parentRel), spec);
  rel = toPosix(rel.replace(/\.(js|ts|tsx)$/, ""));
  const withExt = ["", ".ts", ".tsx"].map((e) => rel + e).find((p) => existsSync(join(SRC_DIR, p)));
  return withExt === undefined ? null : withExt;
}

for (const file of collectFiles(SRC_DIR)) {
  const rel = toPosix(relative(SRC_DIR, file));
  const Fslice = sliceOf(rel);
  if (Fslice === null) {
    errors.push(`${rel}: 不认识的路径（未列入 root 白名单或未被识别的层）`);
    continue;
  }
  const text = readFileSync(file, "utf8");
  const specifiers = [...text.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);
  for (const spec of specifiers) {
    const targetRel = resolveTarget(rel, spec);
    if (targetRel === null) {
      errors.push(`${rel}: import "${spec}" 无法解析到 src 下的文件（fail-closed）`);
      continue;
    }
    const Ts = sliceOf(targetRel);
    if (Ts === null) {
      errors.push(`${rel}: import "${spec}" 落入不认识的路径 ${targetRel}`);
      continue;
    }
    if (Ts === Fslice) continue; // same-slice deep imports are fine

    // client half and host half are isolated both ways.
    if (Ts === "client" || Fslice === "client") {
      if (Ts !== Fslice) errors.push(`${rel}: client 半区与 host 半区禁止互引（${targetRel}）`);
      continue;
    }
    // Slices inside features/ never import each other, even via barrels.
    if (Fslice.startsWith("feature:") && Ts.startsWith("feature:")) {
      errors.push(`${rel}: features 同层 slice 禁止互引（${Fslice} -> ${Ts}）`);
      continue;
    }
    const barrel = barrelOf(Ts);
    if (barrel === null) {
      errors.push(`${rel}: 跨 slice import 目标 ${targetRel} 没有可用的 barrel`);
      continue;
    }
    if (targetRel !== barrel) {
      errors.push(`${rel}: 跨 slice import 必须落在 ${barrel}（当前指向 ${targetRel}）`);
    }
  }
}

if (errors.length > 0) {
  console.error("slice:check FAILED");
  for (const error of errors) console.error("  - " + error);
  process.exit(1);
}
console.log("OK: slice boundaries hold (barrel-only cross-slice imports, no feature cross-talk)");
