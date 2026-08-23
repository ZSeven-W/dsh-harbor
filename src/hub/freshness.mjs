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
import { constants as FS } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const HEX_LEN = 16;
const OPEN_FLAGS = FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0) | (FS.O_NONBLOCK ?? 0);
const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxDirectories: 64,
  maxEntriesPerDirectory: 512,
  maxFiles: 256,
  maxFileBytes: 512 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
});
const READ_CHUNK_BYTES = 64 * 1024;
const CLIENT_TAIL_BYTES = 4096;

/**
 * Recursively collect every .mjs file under a directory, as repo-root-
 * relative paths with forward slashes so the fingerprint is identical
 * across platforms.
 */
async function collectMjs(rootDir, dir, state, limits, depth = 0) {
  if (depth > limits.maxDepth || state.directories >= limits.maxDirectories) {
    state.limited += 1;
    return;
  }
  state.directories += 1;
  let handle;
  try { handle = await opendir(dir); }
  catch { state.skipped += 1; return; }

  const entries = [];
  try {
    for await (const entry of handle) {
      if (entries.length >= limits.maxEntriesPerDirectory) {
        state.limited += 1;
        break;
      }
      entries.push(entry);
    }
  } catch { state.skipped += 1; }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMjs(rootDir, full, state, limits, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      if (state.files.length >= limits.maxFiles) state.limited += 1;
      else state.files.push(relative(rootDir, full).split(/[\\/]/u).join('/'));
    } else if (entry.isSymbolicLink() || entry.name.endsWith('.mjs')) {
      // Symlinks and special files are never opened through the freshness path.
      state.skipped += 1;
    }
  }
}

async function hashRegularFile(rootDir, rel, state, limits, hash) {
  let handle;
  let before;
  try {
    before = await lstat(join(rootDir, rel));
    if (!before.isFile() || before.isSymbolicLink()) { state.skipped += 1; return; }
    handle = await open(join(rootDir, rel), OPEN_FLAGS);
  }
  catch { state.skipped += 1; return; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) { state.skipped += 1; return; }
    if (stat.dev !== before.dev || stat.ino !== before.ino) { state.skipped += 1; return; }
    const budget = Math.min(limits.maxFileBytes, limits.maxTotalBytes - state.bytes);
    hash.update('file\0' + rel + '\0');
    if (budget <= 0 || stat.size > budget) {
      state.limited += 1;
      hash.update(`bounded:${stat.size}:${stat.mtimeMs}`);
      return;
    }

    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(1, budget)));
    let position = 0;
    while (position < budget) {
      const length = Math.min(buffer.length, budget - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const grewPastBudget = position === budget
      && (await handle.read(extra, 0, 1, position)).bytesRead !== 0;
    if (grewPastBudget) {
      state.limited += 1;
      const latest = await handle.stat();
      hash.update(`\0bounded:${latest.size}:${latest.mtimeMs}`);
    }
    state.bytes += position;
    hash.update('\0end');
  } catch { state.skipped += 1; }
  finally { try { await handle.close(); } catch {} }
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
export async function fingerprintSource(rootDir, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const state = { files: [], skipped: 0, limited: 0, directories: 0, bytes: 0 };
  await collectMjs(rootDir, join(rootDir, 'src', 'scan'), state, limits);
  await collectMjs(rootDir, join(rootDir, 'src', 'hub'), state, limits);
  state.files.sort();

  const hash = createHash('sha256');
  for (const rel of state.files) {
    await hashRegularFile(rootDir, rel, state, limits, hash);
  }
  hash.update(`state:${state.skipped}:${state.limited}:${state.directories}:${state.files.length}:${state.bytes}`);
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
  const path = join(rootDir, 'lib', 'client.js');
  let handle;
  let before;
  try {
    before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) return null;
    handle = await open(path, OPEN_FLAGS);
  }
  catch { return null; }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) return null;
    if (stat.dev !== before.dev || stat.ino !== before.ino) return null;
    const length = Math.min(CLIENT_TAIL_BYTES, stat.size);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, stat.size - length);
    const match = /\/\/__HARBOR_CLIENT_BUILD__=([0-9a-f]{16})/u.exec(buffer.subarray(0, bytesRead).toString('utf8'));
    return match === null ? null : match[1];
  } catch { return null; }
  finally { try { await handle.close(); } catch {} }
}
