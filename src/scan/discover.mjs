// Discovery: which third-party plugins are installed, in which profiles, and
// from where. A dependency declaration is not an installed instance: `^1.0.0`
// can resolve to different versions in two profiles, and the same textual
// `link:./plugin` points at a different directory below each profile. Group on
// what is actually installed instead.

import {
  readdirSync, existsSync, realpathSync, readlinkSync,
  opendirSync, lstatSync, openSync, closeSync, readSync, constants,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

export const OFFICIAL_SCOPE = '@deepseek-ai/';
const JSON_MAX_BYTES = 1024 * 1024;

export function profilesDir() {
  return process.env.DSH_HOME
    ? join(process.env.DSH_HOME, 'profiles')
    : join(homedir(), '.dsh', 'profiles');
}

function readBoundedRegularFile(path, maxBytes) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size < 0 || stat.size > maxBytes) return null;
  const buffer = Buffer.allocUnsafe(stat.size);
  const extra = Buffer.allocUnsafe(1);
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const fd = openSync(path, flags);
  try {
    let offset = 0;
    while (offset < stat.size) {
      const count = readSync(fd, buffer, offset, stat.size - offset, offset);
      if (count <= 0) return null;
      offset += count;
    }
    // A manifest replaced or grown after lstat must not escape the byte bound.
    if (readSync(fd, extra, 0, 1, stat.size) !== 0) return null;
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

export function readJson(path) {
  try {
    const text = readBoundedRegularFile(path, JSON_MAX_BYTES);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

const LOCAL_PREFIX = /^(link|file):(.*)$/s;
const FINGERPRINT_SKIP_DIRS = new Set(['.git', 'node_modules']);
const FINGERPRINT_MAX_ENTRIES = 4096;
const FINGERPRINT_MAX_FILES = 2048;
const FINGERPRINT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const FINGERPRINT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const FINGERPRINT_CHUNK_BYTES = 64 * 1024;

/**
 * Hash the package's own shipped files. Two profile-local pnpm copies of one
 * registry artifact have different realpaths but identical bytes, so realpath
 * cannot decide whether they are the same instance. Conversely, version alone
 * would collapse a patched or otherwise mutated copy into the published one.
 *
 * Work is bounded by entry/file/byte limits and files are streamed through one
 * 64 KiB buffer. An unreadable, changing, unsupported, or over-limit tree
 * returns null and therefore falls back to its realpath in the grouping key.
 * It is safer to show a duplicate row than to merge code we did not establish
 * was identical.
 */
function packageFingerprint(dir) {
  const hash = createHash('sha256');
  let files = 0;
  let entriesSeen = 0;
  let bytesSeen = 0;
  const chunk = Buffer.allocUnsafe(FINGERPRINT_CHUNK_BYTES);
  const extra = Buffer.allocUnsafe(1);

  const readEntries = (root) => {
    const entries = [];
    const handle = opendirSync(root);
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        entriesSeen++;
        if (entriesSeen > FINGERPRINT_MAX_ENTRIES) throw new Error('fingerprint entry limit');
        if (!FINGERPRINT_SKIP_DIRS.has(entry.name)) entries.push(entry);
      }
    } finally {
      handle.closeSync();
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  };

  const hashFile = (path, rel) => {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new Error('fingerprint file changed type');
    if (stat.size > FINGERPRINT_MAX_FILE_BYTES) throw new Error('fingerprint file byte limit');
    if (bytesSeen + stat.size > FINGERPRINT_MAX_TOTAL_BYTES) throw new Error('fingerprint total byte limit');
    files++;
    if (files > FINGERPRINT_MAX_FILES) throw new Error('fingerprint file limit');
    bytesSeen += stat.size;

    hash.update(`F\0${rel}\0${stat.mode & 0o777}\0${stat.size}\0`);
    // Read in a fixed-size buffer. stat + readFileSync would normally be fine,
    // but a file replaced or grown between those calls could defeat the memory
    // bound. O_NOFOLLOW also makes a symlink-swap fail closed where supported.
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    const fd = openSync(path, flags);
    try {
      let offset = 0;
      while (offset < stat.size) {
        const length = Math.min(chunk.length, stat.size - offset);
        const count = readSync(fd, chunk, 0, length, offset);
        if (count <= 0) throw new Error('fingerprint file shrank while reading');
        hash.update(chunk.subarray(0, count));
        offset += count;
      }
      if (readSync(fd, extra, 0, 1, stat.size) !== 0) {
        throw new Error('fingerprint file grew while reading');
      }
      hash.update('\0');
    } finally {
      closeSync(fd);
    }
  };

  const walk = (root) => {
    for (const entry of readEntries(root)) {
      const path = join(root, entry.name);
      const rel = relative(dir, path);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        const targetBytes = Buffer.byteLength(target);
        if (bytesSeen + targetBytes > FINGERPRINT_MAX_TOTAL_BYTES) throw new Error('fingerprint total byte limit');
        files++;
        if (files > FINGERPRINT_MAX_FILES) throw new Error('fingerprint file limit');
        bytesSeen += targetBytes;
        hash.update(`L\0${rel}\0${target}\0`);
      } else if (entry.isFile()) {
        hashFile(path, rel);
      } else {
        // Sockets, FIFOs and devices are not npm artifact content. Their
        // presence is unusual enough that merging must fail closed.
        throw new Error('fingerprint unsupported entry');
      }
    }
  };

  try {
    walk(dir);
    return `${files}:${hash.digest('hex')}`;
  } catch {
    return null;
  }
}

function localSource(profileDir, spec, installedDir) {
  const match = LOCAL_PREFIX.exec(spec);
  if (!match) return null;
  const target = resolve(profileDir, match[2]);
  try {
    return realpathSync(target);
  } catch {
    // A packed `file:` source may have moved since install. The installed
    // package is still real and must retain a deterministic provenance.
    return installedDir;
  }
}

/**
 * Discover installed third-party plugins, grouped by actual instance.
 *
 * - registry installs merge only when their resolved version *and shipped
 *   bytes* agree (the fingerprint also covers package.json/version);
 * - `link:` installs are keyed by the canonical live source target;
 * - `file:` installs include that source provenance but merge only when the
 *   installed version and bounded artifact fingerprint also agree. Two
 *   profiles may hold snapshots made from the same file source at different
 *   times, so source alone is insufficient;
 * - `(unlisted)` remains one row per realpath because its provenance is
 *   unknowable.
 *
 * `identity` names the current concrete instance. Snapshot reconciliation is
 * intentionally responsible for pairing a registry instance across upgrades.
 *
 * @returns {Array<{name: string, dir: string, identity: string, resolvedVersion: string|null, installs: Array<{profile: string, position: number, spec: string, linked: boolean, dir: string}>}>}
 */
export function discoverInstalls({ root = profilesDir(), includeOfficial = false } = {}) {
  const byIdentity = new Map();
  if (!existsSync(root)) return [];

  for (const profile of readdirSync(root).sort()) {
    const profileDir = join(root, profile);
    const manifest = readJson(join(root, profile, 'package.json'));
    if (!manifest) continue;
    const bundles = manifest.dsh?.profile?.bundles ?? [];

    bundles.forEach((name, position) => {
      if (!includeOfficial && name.startsWith(OFFICIAL_SCOPE)) return;
      const linkPath = join(root, profile, 'node_modules', name);
      if (!existsSync(linkPath)) return; // declared but not installed — reported separately later

      const dir = realpathSync(linkPath);
      const spec = manifest.dependencies?.[name] ?? '(unlisted)';
      const local = LOCAL_PREFIX.exec(spec);
      const resolvedVersion = readJson(join(dir, 'package.json'))?.version ?? null;

      let identity;
      if (local?.[1] === 'link') {
        const source = localSource(profileDir, spec, dir);
        identity = `${name}@link:${source}`;
      } else if (local?.[1] === 'file') {
        const source = localSource(profileDir, spec, dir);
        const fingerprint = packageFingerprint(dir);
        const artifact = fingerprint ?? `unreadable:${dir}`;
        identity = `${name}@file:${source}:${resolvedVersion ?? 'unknown'}:${artifact}`;
      } else if (spec === '(unlisted)') {
        identity = `${name}@unlisted:${dir}`;
      } else {
        const fingerprint = packageFingerprint(dir);
        // Include the physical path only on fingerprint failure. This avoids a
        // false merge without penalising normal, byte-identical profile copies.
        const artifact = fingerprint ?? `unreadable:${dir}`;
        identity = `${name}@registry:${resolvedVersion ?? 'unknown'}:${artifact}`;
      }

      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, { name, dir, identity, resolvedVersion, installs: [] });
      }
      byIdentity.get(identity).installs.push({
        profile,
        position,
        spec,
        linked: !!local,
        dir,
      });
    });
  }
  return [...byIdentity.values()];
}
