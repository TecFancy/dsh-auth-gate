# Agent Note: Market card screenshots are declared by a repository-root `screenshots.json`, behind a gate

Status: implemented
Legacy ID: D36

English | [中文](2026-11-16-market-card-screenshots.zh.md)

## Problem

The plugin market (dsh-market) draws a card's thumbnail strip from the `screenshots` field of its
catalog entry, and that field is produced by awesome-dsh-plugin's nightly `probe-screenshots.mjs`,
which resolves relative paths from a `screenshots.json` **in the plugin's own repository root**. With
no such file the catalog entry has no field, `CardShot` receives an empty array and returns `null`, and
the card renders no image at all.

The market does read README images, but only as the fallback inside the **install confirmation dialog**
(`ScreenshotStrip`). Once the plugin is installed the button reads "✓ 已安装" and that dialog never
opens, so the fallback is unreachable for exactly the case in question. "Nine images in the README, a
blank card" is therefore not a bug: they are two different image paths.

Nothing else in the repository references this file. Renaming an image under `docs/demo/` is caught by
`readme:parity` for the README reference, while `screenshots.json` would silently point at a 404. The
upstream registry documents that cost: 41 of 773 published screenshots had rotted that way before it
started probing.

## Decision

Ship `screenshots.json` at the repository root, listing six landscape images from `docs/demo/`, as the
single source of the plugin market's card thumbnails. Add `npm run screenshots:check`
(`scripts/verify-screenshots.mjs`) and wire it into the `verify` chain, the `hygiene` scenario of
`run-gates.mjs`, and the `hygiene` job of CI.

The gate enforces the upstream registry's contract: 1 to 8 images, relative paths that stay inside the
repository (no leading `/`, no `..` segment), PNG/JPEG/WebP only (the market client drops SVG), every
file present on disk, and no duplicates.

## Alternatives considered

- **Rely on README auto-extraction only** - does not reach the card: extraction feeds the install
  dialog, which an installed plugin never opens.
- **Add a key to awesome-dsh-plugin's `data/screenshots.json`** - upstream `contributing.md` asks that
  no new keys go there; it is a fallback for older entries with a removal plan, and a hard-coded
  absolute URL only rots silently when the file is renamed.
- **Ship the images inside the npm package's `files`** - the registry reads GitHub HEAD, not the npm
  package, so that changes nothing.
- **Add the JSON without a gate** - that is how the 41 dead screenshots happened; nothing else in the
  repository references this file, so no existing check would notice it going stale.

## Why

Keeping the screenshots in our own repository means an image change is a push to our own repository,
picked up by the next nightly build, with no pull request and no waiting on a maintainer. A relative
path that breaks on rename fails the gate immediately instead of rotting into a 404 on someone else's
page. The gate's rules mirror the upstream contract one for one, so a local pass means the registry
accepts the declaration rather than a green local run followed by an upstream rejection.
