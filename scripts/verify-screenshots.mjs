#!/usr/bin/env node
/**
 * Verifies the repository-root `screenshots.json` (`npm run screenshots:check`).
 *
 * The plugin market (dsh-market) draws a card thumbnail strip from a curated
 * screenshot list, and it reads that list from `screenshots.json` beside the
 * plugin's `package.json`. It does NOT read the README for the card: README
 * images are only a fallback inside the install dialog, and that dialog never
 * opens for an already-installed plugin. So this file is the only thing that
 * puts screenshots on the card, and nothing else in the repo references it.
 *
 * That makes it exactly the kind of list that rots silently: rename a
 * `docs/demo/` image and `readme:parity` catches the README reference while
 * this file keeps pointing at a 404. The upstream registry documents the cost
 * (41 of 773 published screenshots had gone 404 before it started probing).
 *
 * The rules below mirror the upstream contract, so a declaration that passes
 * here is one the registry accepts:
 *
 * 1. Shape - an array of 1-8 non-empty strings, or `{"screenshots": [...]}`.
 * 2. Location - a relative path that stays inside the repository (no leading
 *    `/`, no `..` segment), or an absolute https URL on GitHub hosting.
 * 3. Format - a raster image (PNG/JPEG/WebP). The market refuses SVG: an SVG
 *    is a document, not an image, and it is dropped before an `<img>` exists.
 * 4. Existence - every relative path resolves to a file on disk.
 * 5. Uniqueness - no image is declared twice.
 *
 * Run via `npm run screenshots:check` (part of `npm run verify`).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "screenshots.json";
const MAX_SHOTS = 8;
/** Image hosts the registry accepts for an absolute URL. */
const GITHUB_HOSTS = new Set([
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
  "github.com",
]);
/** Extensions the market renders. SVG is deliberately absent. */
const RASTER = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** @type {string[]} */
const errors = [];
/** @param {string} message */
const note = (message) => errors.push(`${FILE}: ${message}`);

const path = join(ROOT, FILE);
if (!existsSync(path)) {
  console.error(`${FILE} is missing: the plugin market reads its card screenshots from this file.`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(
    `${FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const list = Array.isArray(doc) ? doc : Array.isArray(doc?.screenshots) ? doc.screenshots : null;
if (list === null) {
  console.error(`${FILE} must be an array of paths or {"screenshots": [...]}.`);
  process.exit(1);
}

if (list.length === 0) note("declares no images");
if (list.length > MAX_SHOTS) note(`declares ${list.length} images; the cap is ${MAX_SHOTS}`);

const seen = new Set();
for (const [index, raw] of list.entries()) {
  const where = `entry ${index + 1}`;
  if (typeof raw !== "string" || raw.trim() === "") {
    note(`${where} must be a non-empty string`);
    continue;
  }
  const entry = raw.trim();
  if (seen.has(entry)) note(`${where} repeats ${entry}`);
  seen.add(entry);

  if (/^https?:\/\//i.test(entry)) {
    let parsed;
    try {
      parsed = new URL(entry);
    } catch {
      note(`${where} is not a parseable URL: ${entry}`);
      continue;
    }
    if (parsed.protocol !== "https:" || !GITHUB_HOSTS.has(parsed.hostname)) {
      note(`${where} must be https on GitHub hosting, got ${entry}`);
      continue;
    }
    if (!RASTER.has(extname(parsed.pathname).toLowerCase())) {
      note(`${where} must be a raster image (PNG/JPEG/WebP), got ${entry}`);
    }
    continue;
  }

  if (entry.startsWith("/") || entry.split("/").includes("..")) {
    note(`${where} must stay inside the repository, got ${entry}`);
    continue;
  }
  if (!RASTER.has(extname(entry).toLowerCase())) {
    note(`${where} must be a raster image (PNG/JPEG/WebP), got ${entry}`);
    continue;
  }
  const target = resolve(ROOT, entry);
  if (!existsSync(target) || !statSync(target).isFile()) {
    note(`${where} does not exist: ${entry}`);
  }
}

if (errors.length > 0) {
  console.error("screenshots:check FAILED:");
  for (const message of errors) console.error(`  - ${message}`);
  process.exit(1);
}
console.log(`OK: ${FILE} verified (${list.length} images, all present and market-renderable)`);
