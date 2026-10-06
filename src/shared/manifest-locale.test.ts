import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Plugins page shows what the harness resolves from `<package>/locale/*.json`:
 * `en.json` is required before any scanning happens, every other `<language>.json`
 * beside it is read, and each file carries `meta.title` and `meta.description`.
 * Anything wrong falls back to the package name and the English package.json
 * description, quietly, which is exactly the failure these tests exist to catch:
 * the plugin keeps working and simply looks unnamed.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A language id the harness admits as a locale filename. */
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

interface Manifest {
  readonly exports?: Record<string, unknown>;
  readonly files?: readonly string[];
}

interface Meta {
  readonly title?: unknown;
  readonly description?: unknown;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as Manifest;
}

async function localeFiles(): Promise<string[]> {
  return (await fs.readdir(path.join(root, "locale")))
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
}

async function readMeta(file: string): Promise<Meta> {
  const parsed = JSON.parse(await fs.readFile(path.join(root, "locale", file), "utf8")) as {
    meta?: Meta;
  };
  return parsed.meta ?? {};
}

describe("plugin display metadata", () => {
  it("ships the English locale the harness scans from", async () => {
    // Without en.json the reader never looks at this package's locales at all,
    // so a Chinese-only directory would silently do nothing.
    expect(await localeFiles()).toContain("en.json");
  });

  it("names every locale file by a language id", async () => {
    const files = await localeFiles();
    // A loop over an empty directory passes without checking anything, so the
    // list itself has to be non-empty: "no file is misnamed" is not the claim.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(LANGUAGE_ID.test(file.slice(0, -".json".length))).toBe(true);
    }
  });

  it("gives every locale a title and a description", async () => {
    const files = await localeFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const meta = await readMeta(file);
      // The harness refuses an empty or whitespace-only string, and a missing
      // field falls back per language rather than failing, so both are asserted.
      for (const field of ["title", "description"] as const) {
        const value = meta[field];
        expect(typeof value, `${file}: meta.${field}`).toBe("string");
        expect((value as string).trim(), `${file}: meta.${field}`).not.toBe("");
      }
    }
  });

  it("exports and publishes the locale directory", async () => {
    const manifest = await readManifest();
    // The reader resolves through the package's exports map: an unexported path
    // is reported to it as missing. And `files` decides what npm publishes, so a
    // locale left out of it works from a checkout and vanishes from a release.
    expect(Object.keys(manifest.exports ?? {})).toContain("./locale/*.json");
    expect(manifest.files).toContain("locale/*.json");
  });
});
