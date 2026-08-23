// Two version questions, deliberately kept apart.
//
//   drift    — this machine disagrees with itself: the same plugin sits at
//              different versions in different profiles. Pure local fact, free,
//              always computed.
//   upstream — the registry has something newer than what is installed. This
//              one leaves the machine, so it is never part of scan(): the CLI
//              needs --check-updates and the panel needs a button press.
//
// harbor reads every plugin's source, which makes it the most privileged thing
// in the room. Keeping the default posture offline is what earns that.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { stateDir } from './snapshot.mjs';

const CACHE_FILE = 'versions.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // registries move slowly; six hours is plenty
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- semver

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(value) {
  const m = SEMVER.exec(String(value ?? '').trim());
  if (m?.[4]?.split('.').some((id) => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) return null;
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
}

/**
 * Compare two semver strings. Returns >0 when a is newer, <0 when b is, 0 when
 * equal or unparseable. Prerelease rules matter here: harbor's whole ecosystem
 * is on `-rc.N`, and a naive string compare puts rc.10 before rc.9.
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0; // unparseable: say nothing rather than guess
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // A release outranks any prerelease of the same numbers.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;

  const ida = pa.pre.split('.');
  const idb = pb.pre.split('.');
  for (let i = 0; i < Math.max(ida.length, idb.length); i++) {
    const x = ida[i];
    const y = idb[i];
    if (x === undefined) return -1; // fewer identifiers sorts lower
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x - +y; continue; }
    if (nx !== ny) return nx ? -1 : 1; // numeric identifiers sort below alphanumeric
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ------------------------------------------------------------- axis ②: drift

/**
 * Same plugin, different versions across profiles. Only registry installs are
 * compared against each other: a `link:` working tree is expected to run ahead,
 * so folding it in would cry drift on every developer machine. It is still
 * listed alongside, marked, so the picture stays complete.
 *
 * Each row adds two derived fields on top of the raw install data:
 * - `behind` — a comparable registry row strictly below `highestInstalled`.
 *   Equal or higher is false; link/file rows are context only and never behind.
 * - `kind` — provenance of the row's installs, judged from the spec prefix:
 *   'link' | 'file' | 'registry'. A more precise complement to the legacy
 *   `linked` boolean, which cannot tell a link: install from a file: one.
 *
 * @param {Array<{name: string, version: string, installs: Array<{profile: string, spec: string, linked: boolean}>}>} reports
 * @returns {Array<{name: string, highestInstalled: string, baseline: {kind: 'installed-registry', version: string}, newest: string, rows: Array<{version: string, linked: boolean, kind: 'link'|'file'|'registry', comparable: boolean, behind: boolean, profiles: string[]}>}>}
 */
export function crossProfileDrift(reports) {
  const byName = new Map();
  for (const r of reports) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }

  const findings = [];
  for (const [name, rows] of byName) {
    const registryRows = rows.filter((r) => !(r.installs ?? []).every((i) => i.linked));
    const comparableRows = registryRows.filter((r) => parseVersion(r.version));
    const versions = new Set(comparableRows.map((r) => r.version));
    if (versions.size < 2) continue;

    const sorted = [...rows].sort((a, b) => {
      const av = !!parseVersion(a.version);
      const bv = !!parseVersion(b.version);
      if (av !== bv) return av ? -1 : 1;
      return compareVersions(b.version, a.version);
    });
    // This is a local baseline, never a registry claim. Only checkUpstream()
    // knows what is currently published.
    const highestInstalled = comparableRows.reduce((highest, row) => (
      compareVersions(row.version, highest) > 0 ? row.version : highest
    ), comparableRows[0].version);
    findings.push({
      name,
      highestInstalled,
      baseline: { kind: 'installed-registry', version: highestInstalled },
      // Kept for one compatibility cycle. Consumers must prefer
      // highestInstalled; calling this "latest published" is incorrect.
      newest: highestInstalled,
      rows: sorted.map((r) => {
        const installs = r.installs ?? [];
        // One row is one provenance identity (`name@spec`), so every install
        // in the row shares a spec; the first one decides the kind.
        const spec = installs[0]?.spec ?? '';
        const linked = installs.every((i) => i.linked);
        const comparable = !linked && !!parseVersion(r.version);
        return {
          version: r.version,
          linked,
          kind: spec.startsWith('link:') ? 'link' : spec.startsWith('file:') ? 'file' : 'registry',
          comparable,
          // Local link/file rows are context only; they never participate in
          // registry-install drift, regardless of whether their package.json
          // version happens to be lower or higher than the local baseline.
          behind: comparable && compareVersions(highestInstalled, r.version) > 0,
          profiles: installs.map((i) => i.profile),
        };
      }),
    });
  }
  return findings.sort((a, b) => (a.name < b.name ? -1 : 1));
}

// ---------------------------------------------------------- axis ③: upstream

/**
 * Registry for a package, honouring the user's own npm configuration: a scoped
 * override first, then the global default. Hardcoding npmjs.org would silently
 * report "unknown" for every plugin on a mirror or a private registry.
 */
export function resolveRegistry(pkgName, npmrc = readNpmrc()) {
  const scope = pkgName.startsWith('@') ? pkgName.slice(0, pkgName.indexOf('/')) : null;
  const url = (scope && npmrc[`${scope}:registry`]) || npmrc.registry || DEFAULT_REGISTRY;
  return String(url).replace(/\/+$/, '');
}

function readNpmrc() {
  const conf = {};
  // Later files win, matching npm's own precedence (global < user < env).
  for (const path of ['/usr/local/etc/npmrc', join(homedir(), '.npmrc')]) {
    if (!existsSync(path)) continue;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^\s*([^#;=\s]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) conf[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  if (process.env.npm_config_registry) conf.registry = process.env.npm_config_registry;
  return conf;
}

function readCache(dir) {
  try {
    const value = JSON.parse(readFileSync(join(dir, CACHE_FILE), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

function writeCache(dir, cache) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n');
  } catch { /* a read-only config dir must not fail the check */ }
}

// A package name alone is not a cache identity: changing .npmrc from a private
// registry to npmjs must never reuse the private registry's answer.
const cacheKey = (registry, name) => {
  // Registry URLs can legally carry credentials. Hash the full identity so
  // cache isolation remains exact without persisting secrets in versions.json.
  const registryHash = createHash('sha256').update(registry).digest('hex');
  return `${registryHash}:${name}`;
};

function redactRegistryError(error, registry) {
  let message;
  try { message = String(error?.message ?? error); } catch { return 'registry request failed'; }
  const replace = (needle) => {
    if (needle && message.includes(needle)) message = message.split(needle).join('[redacted]');
  };

  try {
    const url = new URL(registry);
    const encodedUser = url.username;
    const encodedPassword = url.password;
    let decodedUser = encodedUser;
    let decodedPassword = encodedPassword;
    try { decodedUser = decodeURIComponent(encodedUser); } catch { /* keep encoded value */ }
    try { decodedPassword = decodeURIComponent(encodedPassword); } catch { /* keep encoded value */ }

    for (const pair of new Set([
      encodedUser || encodedPassword ? `${encodedUser}:${encodedPassword}` : '',
      decodedUser || decodedPassword ? `${decodedUser}:${decodedPassword}` : '',
    ])) replace(pair);

    // Userinfo is credential material even when an HTTP implementation reports
    // it outside the URL. Very short values would make surgical replacement
    // destroy arbitrary prose, so fall back to a safe generic message.
    for (const credential of new Set([
      encodedUser, decodedUser, encodedPassword, decodedPassword,
    ])) {
      if (!credential || !message.includes(credential)) continue;
      if (credential.length < 3) return 'registry request failed (credentials redacted)';
      replace(credential);
    }
  } catch { /* malformed registries are still handled by the generic URL scrub below */ }

  // Covers credentials embedded in any URL carried by a nested fetch error,
  // including a package suffix appended to the configured registry string.
  message = message.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@');
  return message || 'registry request failed';
}

/**
 * Ask the registry what the newest published version is, for every install
 * that has an upstream at all.
 *
 * Registry comparisons use behind/current/ahead, with unknown for data that
 * cannot be compared. `link:` and `file:` installs are local: rendering them
 * as "up to date" would be a lie — the working tree is whatever the developer
 * last saved.
 *
 * @param {Array<{name: string, version: string, identity: string, installs: Array<{spec: string, linked: boolean}>}>} reports
 * @param {{dir?: string, ttlMs?: number, now?: number, fetchImpl?: typeof fetch, npmrc?: Record<string, string>}} [options]
 * @returns {Promise<{checkedAt: string, requestedAt: string, results: Array<object>, registryHosts: string[]}>}
 */
export async function checkUpstream(reports, options = {}) {
  const {
    dir = stateDir(),
    ttlMs = CACHE_TTL_MS,
    now = Date.now(),
    fetchImpl = globalThis.fetch,
    npmrc = readNpmrc(),
  } = options;

  const cache = readCache(dir);
  if (!cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) cache.entries = {};
  const hosts = new Set();
  const requestedAt = new Date(now).toISOString();
  let cacheDirty = false;

  // One request per package + resolved registry, not per install: three
  // profiles holding the same package ask the registry once.
  const wanted = new Map();
  for (const r of reports) {
    const local = (r.installs ?? []).every((i) => i.linked);
    if (local) continue;
    wanted.set(r.name, resolveRegistry(r.name, npmrc));
  }

  const latest = new Map();
  for (const [name, registry] of wanted) {
    const key = cacheKey(registry, name);
    const cached = cache.entries[key];
    const cachedAt = Number(cached?.at);
    if (cached && Number.isFinite(cachedAt) && cachedAt <= now && now - cachedAt < ttlMs) {
      latest.set(name, {
        latest: cached.latest ?? null,
        cached: true,
        checkedAt: cached.checkedAt ?? new Date(cachedAt).toISOString(),
      });
      continue;
    }
    try {
      // registryHosts means hosts contacted by this request. Cache hits must
      // not appear here: doing so made an offline cache read look networked.
      try { hosts.add(new URL(registry).host); } catch { /* fetch reports the malformed URL below */ }
      // Abbreviated metadata: an order of magnitude smaller than the full
      // packument, and it carries dist-tags, which is all we need.
      const res = await fetchImpl(`${registry}/${name}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json();
      const tag = meta?.['dist-tags']?.latest ?? null;
      latest.set(name, { latest: tag, cached: false, checkedAt: requestedAt });
      cache.entries[key] = { name, latest: tag, at: now, checkedAt: requestedAt };
      cacheDirty = true;
    } catch (err) {
      latest.set(name, {
        latest: null,
        cached: false,
        checkedAt: requestedAt,
        error: redactRegistryError(err, registry),
      });
    }
  }

  const results = reports.map((r) => {
    const local = (r.installs ?? []).every((i) => i.linked);
    if (local) {
      return {
        identity: r.identity, name: r.name, installed: r.version,
        status: 'local', latest: null, cached: null, checkedAt: null,
      };
    }
    const hit = latest.get(r.name);
    if (!hit || hit.latest === null) {
      return {
        identity: r.identity, name: r.name, installed: r.version,
        status: 'unknown', latest: null, cached: !!hit?.cached,
        checkedAt: hit?.checkedAt ?? null,
        error: hit?.error ?? 'registry 未提供可比较的 latest 版本',
      };
    }
    if (!parseVersion(r.version)) {
      return {
        identity: r.identity, name: r.name, installed: r.version,
        status: 'unknown', latest: hit.latest, cached: !!hit.cached,
        checkedAt: hit.checkedAt,
        error: `无法解析已安装版本: ${r.version ?? '(missing)'}`,
      };
    }
    if (!parseVersion(hit.latest)) {
      return {
        identity: r.identity, name: r.name, installed: r.version,
        status: 'unknown', latest: hit.latest, cached: !!hit.cached,
        checkedAt: hit.checkedAt,
        error: `无法解析 registry latest 版本: ${hit.latest}`,
      };
    }
    const delta = compareVersions(hit.latest, r.version);
    return {
      identity: r.identity,
      name: r.name,
      installed: r.version,
      latest: hit.latest,
      cached: !!hit.cached,
      checkedAt: hit.checkedAt,
      // Ahead of the registry is a real state on a maintainer's machine
      // (published later, or a local build), so it gets its own name instead
      // of being flattened into "current".
      status: delta > 0 ? 'behind' : delta < 0 ? 'ahead' : 'current',
    };
  });

  if (cacheDirty) writeCache(dir, { updatedAt: requestedAt, entries: cache.entries });
  return { checkedAt: requestedAt, requestedAt, results, registryHosts: [...hosts].sort() };
}
