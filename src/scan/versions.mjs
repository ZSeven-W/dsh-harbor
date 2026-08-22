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
import { join } from 'node:path';
import { homedir } from 'node:os';
import { stateDir } from './snapshot.mjs';

const CACHE_FILE = 'versions.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // registries move slowly; six hours is plenty
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const REQUEST_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------- semver

/**
 * Compare two semver strings. Returns >0 when a is newer, <0 when b is, 0 when
 * equal or unparseable. Prerelease rules matter here: harbor's whole ecosystem
 * is on `-rc.N`, and a naive string compare puts rc.10 before rc.9.
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
    return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
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
 * - `behind` — strictly below `newest` (`compareVersions(newest, version) > 0`).
 *   Equal or higher is false. It must be "strictly below", never "not equal":
 *   a link/file working tree ahead of the published baseline is the normal
 *   state on a developer machine, not drift — flagging it would highlight
 *   exactly the row that is fine.
 * - `kind` — provenance of the row's installs, judged from the spec prefix:
 *   'link' | 'file' | 'registry'. A more precise complement to the legacy
 *   `linked` boolean, which cannot tell a link: install from a file: one.
 *
 * @param {Array<{name: string, version: string, installs: Array<{profile: string, spec: string, linked: boolean}>}>} reports
 * @returns {Array<{name: string, newest: string, rows: Array<{version: string, linked: boolean, kind: 'link'|'file'|'registry', behind: boolean, profiles: string[]}>}>}
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
    const versions = new Set(registryRows.map((r) => r.version));
    if (versions.size < 2) continue;

    const sorted = [...rows].sort((a, b) => compareVersions(b.version, a.version));
    // The baseline deliberately skips all-local rows: published versions only.
    const newest = sorted.find((r) => !(r.installs ?? []).every((i) => i.linked))?.version ?? sorted[0].version;
    findings.push({
      name,
      newest,
      rows: sorted.map((r) => {
        const installs = r.installs ?? [];
        // One row is one provenance identity (`name@spec`), so every install
        // in the row shares a spec; the first one decides the kind.
        const spec = installs[0]?.spec ?? '';
        return {
          version: r.version,
          linked: installs.every((i) => i.linked),
          kind: spec.startsWith('link:') ? 'link' : spec.startsWith('file:') ? 'file' : 'registry',
          // Strictly below, not merely different: a working tree running ahead
          // of the published baseline is the norm, not drift.
          behind: compareVersions(newest, r.version) > 0,
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
  try { return JSON.parse(readFileSync(join(dir, CACHE_FILE), 'utf8')); } catch { return { entries: {} }; }
}

function writeCache(dir, cache) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, CACHE_FILE), JSON.stringify(cache, null, 2) + '\n');
  } catch { /* a read-only config dir must not fail the check */ }
}

/**
 * Ask the registry what the newest published version is, for every install
 * that has an upstream at all.
 *
 * Status is three-valued on purpose. `link:` and `file:` installs have no
 * upstream to compare against, and rendering them as "up to date" would be a
 * lie — the working tree is whatever the developer last saved.
 *
 * @param {Array<{name: string, version: string, identity: string, installs: Array<{spec: string, linked: boolean}>}>} reports
 * @param {{dir?: string, ttlMs?: number, now?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<{checkedAt: string, results: Array<object>, registryHosts: string[]}>}
 */
export async function checkUpstream(reports, options = {}) {
  const {
    dir = stateDir(),
    ttlMs = CACHE_TTL_MS,
    now = Date.now(),
    fetchImpl = globalThis.fetch,
  } = options;

  const cache = readCache(dir);
  cache.entries ??= {};
  const npmrc = readNpmrc();
  const hosts = new Set();

  // One request per package name, not per install: three profiles holding the
  // same package ask the registry once.
  const wanted = new Map();
  for (const r of reports) {
    const local = (r.installs ?? []).every((i) => i.linked);
    if (local) continue;
    wanted.set(r.name, resolveRegistry(r.name, npmrc));
  }

  const latest = new Map();
  for (const [name, registry] of wanted) {
    try { hosts.add(new URL(registry).host); } catch { /* malformed registry: reported per-package below */ }
    const cached = cache.entries[name];
    if (cached && now - (cached.at ?? 0) < ttlMs) {
      latest.set(name, { latest: cached.latest, cached: true });
      continue;
    }
    try {
      // Abbreviated metadata: an order of magnitude smaller than the full
      // packument, and it carries dist-tags, which is all we need.
      const res = await fetchImpl(`${registry}/${name}`, {
        headers: { accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const meta = await res.json();
      const tag = meta?.['dist-tags']?.latest ?? null;
      latest.set(name, { latest: tag, cached: false });
      cache.entries[name] = { latest: tag, at: now };
    } catch (err) {
      latest.set(name, { latest: null, error: err?.message ?? String(err) });
    }
  }

  const results = reports.map((r) => {
    const local = (r.installs ?? []).every((i) => i.linked);
    if (local) {
      return { identity: r.identity, name: r.name, installed: r.version, status: 'local', latest: null };
    }
    const hit = latest.get(r.name);
    if (!hit || hit.latest === null) {
      return { identity: r.identity, name: r.name, installed: r.version, status: 'unknown', latest: null, error: hit?.error ?? null };
    }
    const delta = compareVersions(hit.latest, r.version);
    return {
      identity: r.identity,
      name: r.name,
      installed: r.version,
      latest: hit.latest,
      cached: !!hit.cached,
      // Ahead of the registry is a real state on a maintainer's machine
      // (published later, or a local build), so it gets its own name instead
      // of being flattened into "current".
      status: delta > 0 ? 'behind' : delta < 0 ? 'ahead' : 'current',
    };
  });

  writeCache(dir, { checkedAt: new Date(now).toISOString(), entries: cache.entries });
  return { checkedAt: new Date(now).toISOString(), results, registryHosts: [...hosts].sort() };
}
