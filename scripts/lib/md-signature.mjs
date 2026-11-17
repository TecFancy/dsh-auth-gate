/**
 * Structural signature of a Markdown document, for the bilingual pairing gate.
 *
 * A translation must keep the *frame* of its source: the same headings, the
 * same verbatim code blocks, tables with the same rows and columns, the same
 * lists with the same item counts, and the same link targets. The pairing gate
 * computes a signature for each side of a pair and compares them; nothing here
 * judges meaning or wording.
 *
 * The rules, stated so a failure can name the rule instead of pointing at a
 * parser:
 *
 *   - **Fenced code is copied verbatim.** A block is identified by its marker
 *     character and by a closing fence at least as long as the opening one, so
 *     a four-backtick block may contain three-backtick fences. Both sides must
 *     have the same blocks in the same order, with the same info string and
 *     byte-identical bodies. Localizing a comment inside a block is therefore a
 *     gate failure: the block is material a reader copies, not prose.
 *   - **Tables keep their dimensions.** Row and column counts per table, in
 *     order. Cell text is not compared.
 *   - **Lists keep kind, start, nesting and item counts.** A marker line is
 *     read as an item the way CommonMark reads it, including the rule that a
 *     bullet item may interrupt a paragraph while an ordered item may do so
 *     only when it starts at 1. That matters here because the English side is
 *     hard-wrapped: a wrapped line beginning with `- ` or `+ ` is a list item
 *     to every Markdown renderer, so the gate reports the difference instead of
 *     hiding it. Wrapped lines indented past their marker are item text.
 *   - **Link targets keep their locale-correct paths and their exact `?`/`#`
 *     suffix.** Each side names the counterpart in its own locale; the caller
 *     supplies `pairedLocale`, which maps a repository-relative path to the
 *     locale-neutral key of its pair, the locale that path is written in, and
 *     both sides' paths. A target outside the paired corpus keeps its authored
 *     path on both sides. Targets are compared as a multiset, because
 *     restructuring sentences may legitimately move a link within the document,
 *     and as a count for same-document `#fragment` links, whose anchor text
 *     follows the translated heading. A link and an image are different
 *     targets, so an image key carries an `image:` prefix.
 *
 * The naming schemes themselves are not this module's business: a repository
 * may pair `foo.md` with `foo_zh.md`, `foo.zh.md`, or `foo.en.md` with
 * `foo.zh.md`, and the projection callback is what makes all three look alike
 * to the comparison.
 *
 * Known limits, stated rather than silently accepted: reference-style links
 * (`[text][label]` plus a `[label]: url` definition) are not compared, inline
 * code spans are blanked before targets are read, a `|` inside an inline code
 * span still counts as a table cell separator, and setext headings (`===` /
 * `---` underlines) are not read as headings.
 */

/** Blank inline code spans so their contents are not read as markup. */
function withoutCodeSpans(line) {
  return line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
}

/** How a locale is named in a report, so a message reads as prose. */
const LOCALE_LABEL = { en: "English", zh: "Chinese" };

/**
 * Drop one blockquote marker, so a quoted list or table is still read as a list
 * or a table. The README quotes a callout that carries structure; without this
 * the quote was invisible to the signature and its contents could drift freely.
 */
function unquote(line) {
  return line.replace(/^(\s*)>\s?/, "$1");
}

/** A thematic break, which is a block boundary and not list content. */
function isThematicBreak(line) {
  return /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

/**
 * Parse one link or image reference into a target and its suffix.
 *
 * The destination runs to the first whitespace (a title may follow it) or to
 * the closing `>`. Taking `[^)\s]+` instead silently dropped every link written
 * with a title, so `[t](foo.md "title")` was invisible rather than mismatched.
 *
 * @param {string} raw The text between the parentheses.
 * @returns {{target: string, suffix: string} | undefined} `undefined` when the
 *   destination is empty or an angle-bracketed target is unterminated.
 */
function parseLinkReference(raw) {
  let dest = raw.trim();
  if (dest.startsWith("<")) {
    const close = dest.indexOf(">");
    if (close === -1) return undefined;
    dest = dest.slice(1, close);
  } else {
    dest = dest.split(/\s+/)[0];
  }
  if (!dest) return undefined;
  const cut = [dest.indexOf("#"), dest.indexOf("?")].filter((i) => i !== -1);
  if (!cut.length) return { target: dest, suffix: "" };
  const at = Math.min(...cut);
  return { target: dest.slice(0, at), suffix: dest.slice(at) };
}

/**
 * Resolve a link target to a repository-relative path.
 *
 * @param {string} rel Repository-relative path of the linking document.
 * @param {string} target Raw target, without any `#fragment`.
 * @returns {string} Repository-relative path with `.` and `..` applied.
 */
function resolveTarget(rel, target) {
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
  const start = target.startsWith("/") ? target.slice(1) : `${dir}${target}`;
  const parts = [];
  for (const part of start.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/**
 * Locate fenced code blocks.
 *
 * @param {string[]} lines Document lines.
 * @returns {{inFence: boolean[], fences: Array<{info: string, body: string, closed: boolean}>}}
 *   `inFence[i]` marks every line belonging to a block, fences included.
 */
export function indexFences(lines) {
  const inFence = new Array(lines.length).fill(false);
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      i += 1;
      continue;
    }
    const marker = open[2];
    const info = open[3].trim();
    // A backtick fence may not carry a backtick in its info string; such a line
    // is ordinary text (CommonMark). Treating it as a fence would swallow the
    // rest of the document.
    if (marker[0] === "`" && info.includes("`")) {
      i += 1;
      continue;
    }
    const body = [];
    inFence[i] = true;
    i += 1;
    let closed = false;
    while (i < lines.length) {
      const close = /^(\s*)(`{3,}|~{3,})\s*$/.exec(lines[i]);
      inFence[i] = true;
      if (close && close[2][0] === marker[0] && close[2].length >= marker.length) {
        closed = true;
        break;
      }
      body.push(lines[i]);
      i += 1;
    }
    i += 1;
    fences.push({ info, body: body.join("\n"), closed });
  }
  return { inFence, fences };
}

/** Heading depths in document order, ignoring fenced code. */
export function headingDepths(text) {
  const lines = text.split("\n");
  const { inFence } = indexFences(lines);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m) out.push(m[1].length);
  }
  return out;
}

/**
 * Group prose lines into blocks, so a link whose text wraps onto the next line
 * is still one link and a blank line still separates two blocks.
 *
 * @param {string[]} lines Document lines.
 * @param {boolean[]} inFence Per-line fence membership.
 * @returns {string[]} Non-empty blocks of non-fenced lines.
 */
export function proseBlocks(lines, inFence) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i] || /^\s*$/.test(lines[i])) flush();
    else current.push(withoutCodeSpans(lines[i]));
  }
  flush();
  return blocks;
}

/**
 * Tables as `rows:cell-counts`, in document order.
 *
 * Comparing the first row's column count alone let a later row gain or lose a
 * cell unnoticed; per-row counts make an uneven table visible.
 *
 * @param {string[]} lines Document lines.
 * @param {boolean[]} inFence Per-line fence membership.
 * @returns {string[]} One entry per table.
 */
export function tableSignatures(lines, inFence) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (inFence[i] || !/^\s*\|/.test(unquote(lines[i]))) {
      i += 1;
      continue;
    }
    const columnCounts = [];
    while (i < lines.length && !inFence[i] && /^\s*\|/.test(unquote(lines[i]))) {
      const inner = withoutCodeSpans(unquote(lines[i]))
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "");
      columnCounts.push(inner.split(/(?<!\\)\|/).length);
      i += 1;
    }
    out.push(`${columnCounts.length}:${columnCounts.join(",")}`);
  }
  return out;
}

/**
 * Lists as `kind:start:items:depth`, in document order.
 *
 * `depth` is the nesting level the list sits at, so a bullet list promoted to a
 * nested list on one side is a difference rather than a match.
 */
export function listSignatures(lines, inFence) {
  const out = [];
  /** Open lists, innermost last. */
  const stack = [];
  let afterBlank = true;
  // Close lists nested deeper than `indent`, leaving a list at exactly
  // `indent` open so the next item continues it. Popping at equal indent here
  // was the bug that made every item its own one-item list.
  const closeDeeperThan = (indent) => {
    while (stack.length && stack[stack.length - 1].markerIndent > indent) stack.pop();
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (inFence[i]) continue;
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      afterBlank = true;
      continue;
    }
    // Read the raw line: blanking inline code first turned a mid-line `+` or
    // `-` into a marker at the blanked prefix's indent, inventing lists that no
    // renderer sees.
    if (isThematicBreak(line)) {
      stack.length = 0;
      afterBlank = true;
      continue;
    }
    const marker = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(unquote(line));
    if (marker) {
      const markerIndent = marker[1].length;
      const ordered = /^\d/.test(marker[2]);
      const start = ordered ? Number.parseInt(marker[2], 10) : 1;
      const top = stack[stack.length - 1];
      // An ordered item may interrupt a paragraph only when it starts at 1;
      // otherwise the line is paragraph text, not a list item.
      if (!afterBlank && !top && ordered && start !== 1) {
        afterBlank = false;
        continue;
      }
      if (top && markerIndent > top.markerIndent) {
        const item = {
          markerIndent,
          kind: ordered ? "ordered" : "bullet",
          start,
          items: 1,
          depth: top.depth + 1,
        };
        out.push(item);
        stack.push(item);
      } else {
        closeDeeperThan(markerIndent);
        const current = stack[stack.length - 1];
        if (current) current.items += 1;
        else {
          const item = {
            markerIndent,
            kind: ordered ? "ordered" : "bullet",
            start,
            items: 1,
            depth: 0,
          };
          out.push(item);
          stack.push(item);
        }
      }
      afterBlank = false;
      continue;
    }
    // A non-marker line continues the innermost item when it is indented past
    // the item's marker column *or* when it is a lazy continuation - a wrapped
    // line with no blank before it. Only a block that starts after a blank line
    // ends the lists it sits outside; reading a lazy continuation as the end of
    // the list split one list into two and made every note look drifted.
    const indent = /^\s*/.exec(unquote(line))[0].length;
    const top = stack[stack.length - 1];
    if (!afterBlank || (top && indent > top.markerIndent)) {
      // continuation text of the innermost item
    } else {
      while (stack.length && stack[stack.length - 1].markerIndent >= indent) stack.pop();
    }
    afterBlank = false;
  }
  return out.map((l) => `${l.kind}:${l.start}:${l.items}:${l.depth}`);
}

/**
 * Build one side's signature.
 *
 * @param {object} input
 * @param {string} input.text Document text.
 * @param {string} input.rel Repository-relative path of this side.
 * @param {string} input.siblingRel Repository-relative path of the counterpart,
 *   so the language switcher is not counted as a content link.
 * @param {string} input.locale The locale this side is written in.
 * @param {(rel: string) => {key: string, locale: string, paths: Record<string, string>} | undefined} input.pairedLocale
 *   Maps a repository-relative path to its pair: `key` is the locale-neutral
 *   identity both sides project to, `locale` is the language that path is
 *   written in, and `paths` names both sides by locale so a wrong-locale link
 *   can be reported with the path to write instead. Returns `undefined` for a
 *   path outside the paired corpus, whose authored path is then kept as-is.
 *   This is the seam that lets one gate handle `foo.md`/`foo_zh.md`,
 *   `foo.en.md`/`foo.zh.md` and `README.md`/`README.zh.md` without demanding a
 *   single suffix.
 * @returns {{fences: Array<{info: string, body: string}>, tables: string[], lists: string[], headings: number[], links: Map<string, number>, selfLinks: number, wrongLocale: string[]}}
 */
export function documentSignature({ text, rel, siblingRel, locale, pairedLocale }) {
  const lines = text.split("\n");
  const { inFence, fences } = indexFences(lines);
  const linkCounts = new Map();
  const wrongLocale = [];
  let selfLinks = 0;
  // Blocks rather than lines: the English side is hard-wrapped, so a link's
  // *text* can end up on the next line (`[toolchain portability\nnote](x.md)`),
  // and a line-by-line scan drops that link from the signature entirely.
  for (const block of proseBlocks(lines, inFence)) {
    for (const m of block.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const parsedRef = parseLinkReference(m[1]);
      if (!parsedRef) continue;
      const { target: pathPart, suffix } = parsedRef;
      const isImage = m[0].startsWith("!");
      // A same-document anchor is counted, never compared by text: the anchor
      // follows the translated heading. Dead anchors belong to the link gates;
      // the count still has to match, because dropping a cross-reference is a
      // defect a reader sees.
      if (!pathPart) {
        if (suffix.startsWith("#")) selfLinks += 1;
        continue;
      }
      if (/^(https?:)?\/\//.test(pathPart) || pathPart.startsWith("mailto:")) continue;
      const resolved = resolveTarget(rel, pathPart);
      if (resolved === siblingRel) continue; // the language switcher
      const pair = pairedLocale(resolved);
      // Projecting only a paired target keeps both sides symmetric: an unpaired
      // path is an authored path on either side.
      if (pair && pair.locale !== locale) {
        const write = pair.paths[locale] ?? pair.key;
        wrongLocale.push(
          `${rel}: links \`${pathPart}${suffix}\` - a ${LOCALE_LABEL[locale] ?? locale} document links the ${LOCALE_LABEL[locale] ?? locale} counterpart \`${write}\``,
        );
      }
      const projected = pair ? pair.key : resolved;
      const key = `${isImage ? "image:" : ""}${projected}${suffix}`;
      linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
    }
  }
  return {
    fences: fences.map(({ info, body }) => ({ info, body })),
    tables: tableSignatures(lines, inFence),
    lists: listSignatures(lines, inFence),
    headings: headingDepths(text),
    links: linkCounts,
    selfLinks,
    wrongLocale,
  };
}

/**
 * Compare two sides and return one message per structural difference.
 *
 * @param {object} input
 * @param {string} input.enText
 * @param {string} input.zhText
 * @param {string} input.enRel
 * @param {string} input.zhRel
 * @param {(rel: string) => {key: string, locale: string} | undefined} input.pairedLocale
 * @returns {string[]} Problem messages; empty when the signatures match.
 */
export function structuralProblems({ enText, zhText, enRel, zhRel, pairedLocale }) {
  const problems = [];
  const en = documentSignature({
    text: enText,
    rel: enRel,
    siblingRel: zhRel,
    locale: "en",
    pairedLocale,
  });
  const zh = documentSignature({
    text: zhText,
    rel: zhRel,
    siblingRel: enRel,
    locale: "zh",
    pairedLocale,
  });

  if (en.fences.length !== zh.fences.length) {
    problems.push(
      `${zhRel}: ${zh.fences.length} fenced code block(s), ${enRel} has ${en.fences.length} - a block was dropped or introduced by the translation`,
    );
  } else {
    en.fences.forEach((a, i) => {
      const b = zh.fences[i];
      if (a.info !== b.info) {
        problems.push(
          `${zhRel}: fenced code block ${i + 1} has info string \`${b.info}\`, ${enRel} has \`${a.info}\``,
        );
      } else if (a.body !== b.body) {
        problems.push(
          `${zhRel}: fenced code block ${i + 1} (${a.info || "no info string"}) is not byte-identical to ${enRel} - code blocks are copied verbatim, comments included`,
        );
      }
    });
  }

  if (en.tables.join(",") !== zh.tables.join(",")) {
    problems.push(
      `${zhRel}: table dimensions are ${zh.tables.join(" / ") || "none"}, ${enRel} has ${en.tables.join(" / ") || "none"} (rows:cell count per row) - a row or column was dropped by the translation`,
    );
  }

  if (en.lists.length !== zh.lists.length) {
    problems.push(
      `${zhRel}: ${zh.lists.length} list(s), ${enRel} has ${en.lists.length} - a list was dropped or introduced by the translation`,
    );
  } else {
    en.lists.forEach((a, i) => {
      if (a !== zh.lists[i]) {
        problems.push(
          `${zhRel}: list ${i + 1} is ${zh.lists[i]}, ${enRel} has ${a} (kind:start:items:depth) - an item was dropped or a list changed shape`,
        );
      }
    });
  }

  const linkDifference = (a, b, aRel, bRel) => {
    const onlyA = [];
    const onlyB = [];
    for (const [target, count] of a) {
      const other = b.get(target) ?? 0;
      if (other !== count) onlyA.push(`${target}${other ? ` (x${count} vs x${other})` : ""}`);
    }
    for (const [target, count] of b) if (!a.has(target)) onlyB.push(`${target} (x${count})`);
    if (onlyA.length || onlyB.length) {
      problems.push(
        `${bRel}: link targets differ from ${aRel} - only ${aRel === enRel ? "in English" : "in Chinese"}: ${onlyA.join(", ") || "none"}; only ${bRel === enRel ? "in English" : "in Chinese"}: ${onlyB.join(", ") || "none"}`,
      );
    }
  };
  linkDifference(en.links, zh.links, enRel, zhRel);

  if (en.selfLinks !== zh.selfLinks) {
    problems.push(
      `${zhRel}: ${zh.selfLinks} same-document anchor link(s), ${enRel} has ${en.selfLinks} - a cross-reference was dropped or added by the translation`,
    );
  }

  problems.push(...en.wrongLocale, ...zh.wrongLocale);
  return problems;
}
