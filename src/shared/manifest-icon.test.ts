import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Plugins page reads this package's `icon` through the harness, not through
 * us: `dsh-app-boot` resolves the exported `package.json`, admits a relative
 * path with one of five extensions under 256 KiB that stays inside the package
 * after `realpath`, and inlines the file as a `data:` URL. Nothing here is
 * enforced by the compiler, and every way of getting it wrong fails *quietly*:
 * the manager keeps the position and draws its own default artwork instead, so
 * the icon is simply absent with no error anywhere. These are the checks that
 * turn that into a red test.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Extensions the harness admits, from its own reader. */
const ICON_MEDIA_TYPES = new Map([
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

/** Raw byte cap the harness applies before encoding the icon. */
const MAX_ICON_BYTES = 256 * 1024;

interface Manifest {
  readonly files?: readonly string[];
  readonly icon?: unknown;
}

async function readManifest(): Promise<Manifest> {
  return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as Manifest;
}

async function readIconPath(): Promise<string> {
  const manifest = await readManifest();
  expect(typeof manifest.icon).toBe("string");
  return manifest.icon as string;
}

describe("plugin icon", () => {
  it("declares a relative path the harness will accept", async () => {
    const icon = await readIconPath();
    // Absolute paths and bare schemes are refused outright; so is any extension
    // outside the five the harness maps to a media type.
    expect(path.isAbsolute(icon)).toBe(false);
    expect(path.win32.isAbsolute(icon)).toBe(false);
    expect(/^[A-Za-z][A-Za-z\d+.-]*:/u.test(icon)).toBe(false);
    expect(ICON_MEDIA_TYPES.has(path.extname(icon).toLowerCase())).toBe(true);
  });

  it("points at a file inside the package, under the size cap", async () => {
    const icon = await readIconPath();
    const real = await fs.realpath(path.resolve(root, icon));
    const local = path.relative(await fs.realpath(root), real);
    expect(local.startsWith("..")).toBe(false);
    expect(path.isAbsolute(local)).toBe(false);
    const stat = await fs.stat(real);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeLessThanOrEqual(MAX_ICON_BYTES);
  });

  it("ships the icon with the package", async () => {
    const [manifest, icon] = [await readManifest(), await readIconPath()];
    // `files` decides what npm publishes; an icon left out of it works from a
    // checkout and disappears from an installed release.
    expect(manifest.files).toContain(icon.replace(/^\.\//u, ""));
  });

  it("draws the shield and keyhole rather than a placeholder", async () => {
    const svg = await fs.readFile(path.resolve(root, await readIconPath()), "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 36 36"');
    // The shield is a filled path (a gradient fill, so no single colour to pin),
    // and the keyhole is the white circle plus its stem. A file that decodes but
    // draws nothing would satisfy every check above and none of these.
    expect(svg).toMatch(/<path[^>]*d="M18 [^"]+"[^>]*fill="url\(#/u);
    expect(svg).toMatch(/<circle[^>]*fill="#FFFFFF"/u);
    expect(svg).toMatch(/<path[^>]*stroke="#FFFFFF"/u);
  });
});
