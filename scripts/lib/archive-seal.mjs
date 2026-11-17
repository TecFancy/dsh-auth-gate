/**
 * Pure helpers for the archive seals: a manifest of SHA-256 hashes, one per
 * frozen artifact, that may only grow.
 *
 * Two archives are sealed in this repository and they do not share a manifest
 * shape, so the shape lives in a `seal` descriptor instead of in the helpers:
 *
 *   - `VERSIONED_SEAL` - `.agents/notes/archived/manifest.json`, the Agent Note
 *     archive. `{version: 1, files: {"{class}/{file}": "sha256:<hex>"}}`.
 *   - `LEGACY_SEAL` - `docs/decisions/archived/.manifest.json`, the retired ADR
 *     archive that predates the notes tree. A flat `{"<file>": "<hex>"}` map
 *     with no version field, kept byte-compatible with the file already
 *     committed so the gate adopts it without rewriting history.
 *
 * No filesystem and no git here, so every rule can be exercised with in-memory
 * fixtures; `scripts/check-archives.mjs` owns the reading.
 *
 * Why a manifest and not the bilingual sidecar: the `.i18n.yaml` sidecar records
 * blob hashes of the two language files, and `bilingual:re-record` rewrites it
 * on demand, so it proves the pair agrees with itself rather than that the pair
 * is unchanged. The manifest is written once, when a triplet is archived, and a
 * later edit to a sealed file (or to its seal) fails against it.
 */

import { createHash } from "node:crypto";

/** `{class}/{file}`: one class directory, then a flat file name. */
const CLASSED_PATH_RE = /^[a-z][a-z0-9-]*\/[^/\\]+$/;
/** A flat file name: the legacy ADR archive has no class directories. */
const FLAT_PATH_RE = /^[^/\\]+$/;
const VERSIONED_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const LEGACY_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Exact old-to-new hash pairs a sealed artifact is allowed to change through.
 *
 * Empty on purpose. A frozen file can still be wrong in a way that has to be
 * fixed (a leaked secret, a link that must go), and without a sanctioned route
 * the only options are to weaken the verifier or to delete the seal. An entry
 * here permits exactly one content change, named by the archive it belongs to,
 * the hash it starts from and the hash it ends at, and nothing else: no other
 * file, no reversal, no deletion. Add one only with an Agent Note that says why.
 *
 * @type {ReadonlyArray<{archive: string, path: string, before: string, after: string}>}
 */
export const AUTHORIZED_RESEALS = [];

/** Hash raw bytes. The seal is over the file as stored, never a normalised view. */
const hex = (content) => createHash("sha256").update(content).digest("hex");

/**
 * Hash raw bytes into the form one seal records.
 *
 * @param {Buffer} content
 * @returns {string} `sha256:<hex>` for the versioned seal, bare `<hex>` for the
 *   legacy one.
 */
export function sealHash(content) {
  return `sha256:${hex(content)}`;
}

// Plain code-unit order, not `localeCompare`: the manifest is committed, so its
// ordering must be the same on every machine and in every CI locale.
const byPath = ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const sortByPath = (files) => Object.fromEntries(Object.entries(files).sort(byPath));

/**
 * Validate a manifest's `files` map against one seal's closed schema.
 *
 * @param {unknown} value
 * @param {RegExp} artifactPathRe
 * @param {RegExp} hashRe
 * @param {string} pathHint Appended to the error for a bad artifact path.
 * @returns {Record<string, string>}
 */
function readFiles(value, artifactPathRe, hashRe, pathHint) {
  if (!isRecord(value)) throw new Error("`files` must be an object");
  const files = {};
  for (const [artifact, hash] of Object.entries(value)) {
    if (!artifactPathRe.test(artifact)) {
      throw new Error(`invalid artifact path ${JSON.stringify(artifact)} (${pathHint})`);
    }
    if (typeof hash !== "string" || !hashRe.test(hash)) {
      throw new Error(`invalid content hash for ${artifact}`);
    }
    files[artifact] = hash;
  }
  return files;
}

/**
 * The Agent Note archive's manifest: versioned, classed paths, prefixed hashes.
 *
 * @type {{
 *   id: string,
 *   manifestName: string,
 *   artifactPathRe: RegExp,
 *   hash: (content: Buffer) => string,
 *   empty: () => {version: 1, files: Record<string, string>},
 *   parse: (content: string) => {version: 1, files: Record<string, string>},
 *   render: (files: Record<string, string>) => string,
 * }}
 */
export const VERSIONED_SEAL = {
  id: "versioned",
  manifestName: "manifest.json",
  artifactPathRe: CLASSED_PATH_RE,
  hash: sealHash,
  empty: () => ({ version: 1, files: {} }),
  parse(content) {
    const value = JSON.parse(content);
    if (!isRecord(value)) throw new Error("expected a JSON object");
    if (Object.keys(value).sort().join(",") !== "files,version") {
      throw new Error("expected exactly the fields `version` and `files`");
    }
    if (value.version !== 1) throw new Error("unsupported manifest version (expected 1)");
    return {
      version: 1,
      files: readFiles(value.files, CLASSED_PATH_RE, VERSIONED_HASH_RE, "want {class}/{file}"),
    };
  },
  render(files) {
    return `${JSON.stringify({ version: 1, files: sortByPath(files) }, null, 2)}\n`;
  },
};

/**
 * The retired ADR archive's manifest: flat, no version field, bare hex hashes.
 *
 * The shape is not a preference, it is the file already committed at
 * `docs/decisions/archived/.manifest.json`. Adopting it as-is is what lets the
 * gate cover the legacy archive without a rewrite that would itself be an
 * unsealed edit.
 *
 * @type {{
 *   id: string,
 *   manifestName: string,
 *   artifactPathRe: RegExp,
 *   hash: (content: Buffer) => string,
 *   empty: () => {files: Record<string, string>},
 *   parse: (content: string) => {files: Record<string, string>},
 *   render: (files: Record<string, string>) => string,
 * }}
 */
export const LEGACY_SEAL = {
  id: "legacy",
  manifestName: ".manifest.json",
  artifactPathRe: FLAT_PATH_RE,
  hash: hex,
  empty: () => ({ files: {} }),
  parse(content) {
    const value = JSON.parse(content);
    if (!isRecord(value)) throw new Error("expected a JSON object");
    return { files: readFiles(value, FLAT_PATH_RE, LEGACY_HASH_RE, "want a flat file name") };
  },
  render(files) {
    return `${JSON.stringify(sortByPath(files), null, 2)}\n`;
  },
};

/**
 * Compare the manifest as committed at the trusted baseline with the one in the
 * tree. Every sealed entry must survive unchanged. New entries are fine. A hash
 * may change only through an exact `authorized` pair.
 *
 * This is what stops "edit the sealed file, then edit its hash to match": the
 * content check below passes for that tree, the baseline comparison does not.
 *
 * @param {{files: Record<string, string>}} baseline
 * @param {{files: Record<string, string>}} current
 * @param {ReadonlyArray<{path: string, before: string, after: string}>} [authorized]
 *   Already filtered to the archive being checked.
 * @returns {string[]} problems
 */
export function validateExtension(baseline, current, authorized = AUTHORIZED_RESEALS) {
  const problems = [];
  for (const [artifact, expected] of Object.entries(baseline.files)) {
    const actual = current.files[artifact];
    if (actual === undefined) {
      problems.push(`${artifact}: sealed manifest entry is missing`);
    } else if (
      actual !== expected &&
      !authorized.some((a) => a.path === artifact && a.before === expected && a.after === actual)
    ) {
      problems.push(`${artifact}: sealed manifest hash changed`);
    }
  }
  return problems;
}

/**
 * Check every sealed artifact against its recorded hash and append hashes for
 * artifacts not yet sealed. Existing entries are never rewritten.
 *
 * @param {{files: Record<string, string>}} existing
 * @param {ReadonlyMap<string, Buffer>} artifacts path under the archive -> bytes
 * @param {{hash: (content: Buffer) => string}} seal
 * @returns {{files: Record<string, string>, added: string[], problems: string[]}}
 */
export function extendManifest(existing, artifacts, seal) {
  const problems = [];
  const files = { ...existing.files };
  for (const [artifact, expected] of Object.entries(existing.files)) {
    const content = artifacts.get(artifact);
    if (content === undefined) problems.push(`${artifact}: sealed artifact is missing`);
    else if (seal.hash(content) !== expected) problems.push(`${artifact}: sealed content changed`);
  }
  const added = [];
  for (const [artifact, content] of [...artifacts].sort(byPath)) {
    if (files[artifact] !== undefined) continue;
    files[artifact] = seal.hash(content);
    added.push(artifact);
  }
  return { files, added, problems };
}
