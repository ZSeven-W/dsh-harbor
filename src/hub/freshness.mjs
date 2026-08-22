// Code-freshness probes for dsh-harbor. Zero non-builtin dependencies so this
// module can always be imported, even inside the host's single module realm.
//
// The problem this solves: the hub's scanning code (src/scan/*.mjs, plus this
// file) is loaded into memory when the DSH instance boots, while the panel
// bundle (lib/client.js) is re-read from disk every time the settings page
// opens. After an upgrade without a restart, the panel is new but the running
// hub still executes the modules it loaded at boot — the page then renders
// quietly incomplete data with zero errors, the worst failure mode for a
// governance tool. These two functions let the hub detect that state.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const HEX_LEN = 16;

/**
 * Recursively collect every .mjs file under a directory, as repo-root-
 * relative paths with forward slashes so the fingerprint is identical
 * across platforms.
 */
async function collectMjs(rootDir, dir, state) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // A whole unreadable directory counts as one skip (see fingerprintSource).
    state.skipped += 1;
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMjs(rootDir, full, state);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      state.files.push(relative(rootDir, full).split(/[\\/]/u).join('/'));
    }
  }
}

/**
 * Fingerprint the source code the hub actually executes: every .mjs under
 * src/scan/ and src/hub/ (this file included).
 *
 * What it measures: the *content* of the files, not their mtime. A
 * git checkout rewrites files and bumps mtimes without changing content;
 * hashing content keeps that from producing a false "code changed" signal.
 *
 * Why the skip count is part of the hash: a file that cannot be read is
 * skipped instead of throwing (one bad file must not kill the report route),
 * but if only the successfully-read files were fed into the hash, a file
 * becoming unreadable — or silently disappearing — could leave the digest
 * unchanged while the executed code changed. Mixing the skip count in makes
 * every such degradation visible as a fingerprint change.
 *
 * @param {string} rootDir repository root containing src/ and lib/
 * @returns {Promise<string>} first 16 hex chars of the sha256 digest
 */
export async function fingerprintSource(rootDir) {
  const state = { files: [], skipped: 0 };
  await collectMjs(rootDir, join(rootDir, 'src', 'scan'), state);
  await collectMjs(rootDir, join(rootDir, 'src', 'hub'), state);
  state.files.sort();

  const hash = createHash('sha256');
  for (const rel of state.files) {
    let content;
    try {
      content = await readFile(join(rootDir, rel), 'utf8');
    } catch {
      // Same contract as a missing directory: never throw, always count.
      state.skipped += 1;
      continue;
    }
    // Feed the relative path then the content; NUL separators keep path and
    // payload unambiguous (e.g. "a/b.mjs" + "c" vs "a" + "b.mjsc").
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
  }
  hash.update('skipped:' + state.skipped);
  return hash.digest('hex').slice(0, HEX_LEN);
}

/**
 * Read the build identifier that scripts/build-client.mjs appends to
 * lib/client.js as a trailing comment line
 * (//__HARBOR_CLIENT_BUILD__=<hex>).
 *
 * What it measures: which bundle build currently sits on disk — the one the
 * next page load will run. The hub compares it against the id baked into the
 * *running* panel so the page can tell the user "you are executing an older
 * build of me, reload". A content hash of the bundle is used (no timestamps):
 * rebuilding identical sources must yield the identical id, or every rebuild
 * would falsely claim the panel is stale.
 *
 * @param {string} rootDir repository root containing lib/client.js
 * @returns {Promise<string | null>} the hex id, or null when the file is
 *   missing/unreadable or carries no identifier (older bundle format)
 */
export async function readClientBuildId(rootDir) {
  let text;
  try {
    text = await readFile(join(rootDir, 'lib', 'client.js'), 'utf8');
  } catch {
    return null;
  }
  const match = /\/\/__HARBOR_CLIENT_BUILD__=([0-9a-f]{16})/u.exec(text);
  return match === null ? null : match[1];
}
