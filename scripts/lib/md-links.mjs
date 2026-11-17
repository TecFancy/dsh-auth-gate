/**
 * Markdown link extraction and repository-relative resolution.
 *
 * Shared by the gates that validate links (`check-docs.mjs`,
 * `check-note-links.mjs`). It exists because the same resolution logic had
 * grown three near-copies inside `check-docs.mjs` alone, and copying it a
 * fourth time into the note-tree gate would have guaranteed that a fix to one
 * copy silently missed the others. The rules that must stay identical across
 * the gates, and therefore live here:
 *
 *   - what counts as a checkable link (external URLs, bare fragments,
 *     `mailto:`, and empty targets are not);
 *   - that the target is resolved from the linking file's own directory;
 *   - that escaping the repository is reported rather than answered by
 *     `existsSync` against some unrelated file outside the tree;
 *   - that an in-repo name beginning with dots (`..odd.md`) is not read as an
 *     escape, and that a cross-drive Windows target is treated as an escape;
 *   - that a heading slug follows GitHub's slugger, punctuation deleted and one
 *     hyphen per space, so `## Notes & limitations` is `notes--limitations`.
 *
 * Callers keep their own policy: which files to walk, how to report, and what
 * else to assert about each file. In particular the bilingual suffix is a
 * caller concern: `docs/` pairs as `foo.md` + `foo_zh.md` while
 * `.agents/notes/` pairs as `foo.md` + `foo.zh.md`, so `chineseCounterpart`
 * and `englishSource` below serve the note tree only.
 */

import path from "node:path";

const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Blank out code regions, preserving every other character's position and the
 * line count. A link *shown* in a fenced block or an inline span is an example
 * of a link syntax, not a link any reader can follow: the notes README teaches
 * the cross-reference form inside backticks, and reporting that as a broken
 * link would make the gate lie about the tree it validates. Fenced blocks
 * (backtick or tilde, any length) are matched before inline spans so a fence
 * marker is never read as an inline span.
 */
/** Blank fenced blocks only, keeping inline spans readable. */
function blankFences(text) {
  return text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1?\2[^\n]*$/gm, (block) =>
    block.replace(/[^\n]/g, " "),
  );
}

function blankCode(text) {
  return blankFences(text).replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])?\1/g, (span) =>
    " ".repeat(span.length),
  );
}

/**
 * The text a GitHub heading slug is derived from.
 *
 * GitHub slugs the *rendered* heading: an inline code span contributes its
 * contents (`` `foo_bar` `` -> `foo_bar`), a link contributes its label, and
 * emphasis markers disappear. Deriving the slug from the raw source instead made
 * some real anchors unreachable, which the link gate would report as a dead
 * fragment.
 *
 * Punctuation is deleted rather than replaced, and each remaining space becomes
 * exactly one hyphen, which is what `github-slugger` does. Collapsing a run of
 * spaces into a single hyphen is the tempting simplification and it is wrong: a
 * heading `## Notes & limitations` slugs to `notes--limitations` (the `&` is
 * deleted, leaving two spaces), so collapsing reported the real anchor in
 * `README.md` as dead.
 *
 * @param {string} raw Heading text, fences already blanked.
 * @returns {string} Slug, or `""` when nothing visible is left.
 */
function headingSlugOf(raw) {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]*>/g, "")
    .toLowerCase()
    // Keep letters, digits, space, `_` and `-`; delete everything else. A tab
    // or other control whitespace is deleted too, not turned into a hyphen,
    // because GitHub's slugger only maps the space character.
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .replace(/ /g, "-");
}

/**
 * Collect every checkable Markdown link target in `text`, in document order.
 * Links inside fenced blocks and inline code spans are skipped (`blankCode`).
 *
 * @param {string} text Markdown source.
 * @returns {string[]} Targets with any `#fragment` removed, `""` entries removed.
 */
export function collectLinks(text) {
  const links = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(blankCode(text))) !== null) {
    const target = m[1].trim();
    if (!target || target.startsWith("#") || EXTERNAL_SCHEME_RE.test(target)) continue;
    links.push(target.split("#")[0]);
  }
  return links.filter(Boolean);
}

/**
 * Collect every checkable Markdown link reference, keeping its `#fragment`.
 *
 * `collectLinks` answers "does the file exist"; this answers "does the section
 * exist", which is the question a reader has after a heading is renamed.
 *
 * @param {string} text Markdown source.
 * @returns {{ref: string, path: string, fragment: string}[]} In document order.
 *   `path` is `""` for a same-document link (`#section`).
 */
export function collectLinkRefs(text) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(blankCode(text))) !== null) {
    const ref = m[1].trim();
    if (!ref || EXTERNAL_SCHEME_RE.test(ref)) continue;
    const { path: targetPath, fragment } = splitTarget(ref);
    if (!targetPath && !fragment) continue;
    out.push({ ref, path: targetPath, fragment });
  }
  return out;
}

/**
 * The anchors GitHub generates for a document's headings, with the `-1`, `-2`
 * suffixes it appends to repeated headings.
 *
 * The rules are GitHub's, not CommonMark's: lowercase, drop punctuation and
 * symbols, keep letters (CJK included), digits, `_` and `-`, and turn runs of
 * whitespace into `-`. A fragment must name one of these, or an explicit
 * `<a id="...">` / `<a name="...">`, to resolve when a reader clicks it.
 *
 * Known limit: a heading containing a Markdown link keeps the whole link text
 * here, where GitHub keeps the link label alone.
 *
 * @param {string} text Markdown source; code regions are ignored.
 * @returns {Set<string>} Anchor names.
 */
export function headingSlugs(text) {
  const anchors = new Set();
  // Deduplicate on the slug actually emitted, the way GitHub does: with
  // `## foo` then `## foo-1` then `## foo`, the third heading is `foo-2`, not a
  // second `foo-1`.
  const used = new Set();
  for (const m of blankFences(text).matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    const base = headingSlugOf(m[1]);
    if (!base) continue;
    let slug = base;
    let suffix = 1;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(slug);
    anchors.add(slug);
  }
  for (const m of blankCode(text).matchAll(/<a\s[^>]*(?:id|name)="([^"]+)"/gi)) {
    anchors.add(m[1].toLowerCase());
  }
  return anchors;
}

/**
 * Link fragments that name no section of their target document.
 *
 * @param {string} text The linking document.
 * @param {(rel: string) => Promise<string | undefined>} load Reads a target
 *   document's text, or returns `undefined` when the target is not a file this
 *   gate can read (a directory, a missing file, a non-Markdown path).
 * @param {(fromAbs: string, target: string) => string} resolveInRepo Bound
 *   resolver for the linking file, so this stays path-agnostic.
 * @returns {Promise<{ref: string, fragment: string, targetRel: string}[]>}
 */
export async function deadFragments(text, load, resolve) {
  const selfAnchors = headingSlugs(text);
  const dead = [];
  for (const { ref, path: targetPath, fragment } of collectLinkRefs(text)) {
    if (!fragment) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(fragment);
    } catch {
      // A malformed escape (`#%`) names nothing; report it rather than throwing
      // a URIError the caller cannot read as a verdict.
      dead.push({ ref, fragment, targetRel: targetPath ? resolve(targetPath).rel : "" });
      continue;
    }
    if (!targetPath) {
      if (!selfAnchors.has(decoded.toLowerCase())) dead.push({ ref, fragment, targetRel: "" });
      continue;
    }
    const resolved = resolve(targetPath);
    if (resolved.kind === "escape" || !isMarkdownPath(resolved.rel)) continue;
    const targetText = await load(resolved.rel);
    if (targetText === undefined) continue;
    if (!headingSlugs(targetText).has(decoded.toLowerCase())) {
      dead.push({ ref, fragment, targetRel: resolved.rel });
    }
  }
  return dead;
}

/**
 * Split a raw link target into its path and fragment parts.
 *
 * @param {string} target Raw target as written in the link.
 * @returns {{path: string, fragment: string}} `fragment` excludes the `#`.
 */
export function splitTarget(target) {
  const hash = target.indexOf("#");
  if (hash === -1) return { path: target, fragment: "" };
  return { path: target.slice(0, hash), fragment: target.slice(hash + 1) };
}

/**
 * Resolve one relative link target against the directory holding the link.
 *
 * @param {string} root Repository root, absolute.
 * @param {string} fromAbs Absolute path of the file containing the link.
 * @param {string} target Link target, already trimmed of any fragment.
 * @returns {{kind: "in-repo", rel: string, abs: string} | {kind: "escape", rel: string}}
 *   `rel` is separator-normalised and relative to `root`. `kind: "escape"`
 *   means the target leaves the repository (or names another Windows drive),
 *   which no gate can validate portably.
 */
export function resolveInRepo(root, fromAbs, target) {
  const abs = path.resolve(path.dirname(fromAbs), target);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  // `rel === ".."` or a `../` prefix, not `startsWith("..")`, so a legitimate
  // in-repo name beginning with dots is not misreported. `path.relative`
  // returns an absolute path for a cross-drive target on Windows.
  if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    return { kind: "escape", rel };
  }
  return { kind: "in-repo", rel, abs };
}

/**
 * Whether a link target names a Markdown file.
 *
 * @param {string} rel Repository-relative, separator-normalised path.
 * @returns {boolean} True for `.md` targets, including `.zh.md`.
 */
export function isMarkdownPath(rel) {
  return rel.endsWith(".md");
}

/**
 * The Chinese counterpart path of a Markdown file, or `undefined`.
 *
 * This is the `.zh.md` suffix, which is the Agent Note convention
 * (`.agents/notes/`). Docs under `docs/` pair as `foo.md` + `foo_zh.md`
 * instead, so a caller scanning `docs/` must not use this helper; see
 * `isChineseDoc` in `check-docs.mjs`.
 *
 * @param {string} rel Repository-relative path.
 * @returns {string | undefined} `foo.md` -> `foo.zh.md`; already-Chinese and
 *   non-Markdown paths yield `undefined`.
 */
export function chineseCounterpart(rel) {
  if (!rel.endsWith(".md") || rel.endsWith(".zh.md")) return undefined;
  return `${rel.slice(0, -3)}.zh.md`;
}

/**
 * The English source path of a Chinese Markdown file, or `undefined`.
 *
 * The `.zh.md` suffix, as above: Agent Notes only, not `docs/`.
 *
 * @param {string} rel Repository-relative path.
 * @returns {string | undefined} `foo.zh.md` -> `foo.md`.
 */
export function englishSource(rel) {
  if (!rel.endsWith(".zh.md")) return undefined;
  return `${rel.slice(0, -6)}.md`;
}
