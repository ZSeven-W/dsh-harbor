// Upgrade preflight: "if this machine moved to DSH <version>, which installed
// plugins would still load?" Answered against a real copy of that DSH version
// in an isolated prefix, never by reading a changelog. Every plugin gets one
// row of facts, one boot verdict, and zero or more advisories:
//   verdict blocks-boot — its server entry fails to import against the target
//                         host; the DSH loader is fail-loud, so every profile
//                         holding this instance would not boot
//   verdict ok          — the server entry imports
//   verdict unknown     — nothing to probe (no server entry)
//   advisory dead-inject   — dsh.client.inject/external names a client module
//                            the target does not ship (skipped silently ≥ 0.1.5)
//   advisory peer-range    — a host peer range excludes the target's version
//   advisory peer-missing  — a host peer the target tree does not contain
// Advisories never change the verdict: a stale range does not stop a plugin
// from loading, and pretending otherwise would bury the one hard signal.

import { join, resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import { discoverInstalls, profilesDir, readJson } from '../scan/discover.mjs';
import {
  HOST_PACKAGE, ensureHost, hostPresetIds, installedHostVersion, listHostVersions,
  readHostInventory, readSettingsSection, resolveHostVersion,
} from './host.mjs';
import { checkInject, checkPeers, checkPresetSetting, probeImport } from './checks.mjs';
import { packPlugin } from './pack.mjs';
import { parseVersion } from './semver.mjs';

export { listHostVersions, listCachedHosts, resolveHostVersion, hostsRoot } from './host.mjs';
export { packPlugin } from './pack.mjs';

function settingsFile() {
  return process.env.DSH_HOME ? join(process.env.DSH_HOME, 'settings.yaml') : join(homedir(), '.dsh', 'settings.yaml');
}

const HOST_IMPORT_FAILURE = /@deepseek-ai\//;

/**
 * A failed import is only a host-compatibility verdict when the failure
 * names a host package (removed package, removed export). A plugin whose own
 * dependency is missing from disk — common for packed-from-registry probes
 * and for broken installs — is reported as `unresolvable`, not as blocking.
 */
function verdictFor(row) {
  if (row.import.status === 'fail') {
    const text = `${row.import.code} ${row.import.message}`;
    if (row.import.code === 'ERR_MODULE_NOT_FOUND' && !HOST_IMPORT_FAILURE.test(text)) return 'unresolvable';
    return 'blocks-boot';
  }
  return row.import.status === 'ok' ? 'ok' : 'unknown';
}

function advisoriesFor(row) {
  const out = [];
  for (const id of row.inject.ids) {
    if (id.status === 'missing') out.push({ kind: 'dead-inject', field: id.field, id: id.id });
  }
  for (const p of row.peers) {
    if (p.status === 'unsatisfied') out.push({ kind: 'peer-range', name: p.name, range: p.range, installed: p.installed });
    else if (p.status === 'missing-in-host') out.push({ kind: 'peer-missing', name: p.name, range: p.range });
  }
  return out;
}

/**
 * @param {string} target version or dist-tag (`latest`, `next`, `alpha`)
 * @param {object} [options]
 * @returns {Promise<object>} the preflight report (JSON-serialisable)
 */
export async function preflight(target, options = {}) {
  const {
    root = profilesDir(),
    hostsRoot: hostsRootDir,
    fetchImpl = globalThis.fetch,
    onLog = () => {},
    listing: providedListing = null,
    ensureHostImpl = ensureHost,
    probeImpl = probeImport,
    discover = discoverInstalls,
    settingsPath = settingsFile(),
    env = process.env,
    // Explicit subjects replace profile discovery: `plugins` are directories,
    // `packs` are npm specs fetched into `packRoot`.
    plugins: explicitPlugins = null,
    packs = null,
    packRoot = null,
    packImpl = packPlugin,
    checkSettings = true,
  } = options;

  const startedAt = new Date().toISOString();
  let listing = providedListing;
  let version = String(target ?? 'latest').trim();
  if (!parseVersion(version)) {
    onLog(`resolving dist-tag "${version}" from the registry`);
    listing = listing ?? await listHostVersions({ fetchImpl });
    version = resolveHostVersion(version, listing);
  }

  const host = await ensureHostImpl(version, { root: hostsRootDir, onLog, env });
  onLog(host.cached ? `host ${version} cached at ${host.prefix}` : `host ${version} installed at ${host.prefix}`);
  const inventory = readHostInventory(host.treeDir);
  const presetIds = hostPresetIds(host.treeDir);

  const currentHost = installedHostVersion(join(root, 'web')) ?? installedHostVersion(root) ?? null;
  let installs;
  const explicit = explicitPlugins !== null || packs !== null;
  if (explicit) {
    installs = [];
    for (const dir of explicitPlugins ?? []) {
      const manifest = readJson(join(dir, 'package.json'));
      if (!manifest) throw new Error(`no package.json in ${dir}`);
      installs.push({ name: manifest.name ?? dir, dir: resolvePath(dir), identity: `${manifest.name ?? dir}@dir:${resolvePath(dir)}`, resolvedVersion: manifest.version ?? null, installs: [] });
    }
    for (const spec of packs ?? []) {
      try {
        const packed = await packImpl(spec, { root: packRoot ?? join(host.prefix, '..', 'packs'), env, onLog });
        installs.push({ name: packed.manifest.name ?? spec, dir: packed.dir, identity: `${packed.manifest.name ?? spec}@pack:${packed.version ?? '?'}`, resolvedVersion: packed.version, installs: [], spec });
      } catch (error) {
        installs.push({ name: spec, dir: null, identity: `${spec}@pack:failed`, resolvedVersion: null, installs: [], spec, packError: String(error?.message ?? error) });
      }
    }
  } else {
    installs = discover({ root });
  }
  const plugins = [];
  for (const plugin of installs) {
    if (plugin.dir === null) {
      plugins.push({ name: plugin.name, version: null, identity: plugin.identity, dir: null, profiles: [], spec: plugin.spec,
        import: { status: 'fail', code: 'PACK_FAILED', message: plugin.packError, entry: null, resolved: [] },
        inject: { declared: false, platform: null, ids: [] }, peers: [], verdict: 'unresolvable', advisories: [] });
      continue;
    }
    const manifest = readJson(join(plugin.dir, 'package.json')) ?? {};
    onLog(`probing ${plugin.name}@${plugin.resolvedVersion ?? '?'}`);
    const importResult = await probeImpl(plugin.dir, manifest, host.treeDir, { env });
    const row = {
      name: plugin.name,
      version: plugin.resolvedVersion,
      identity: plugin.identity,
      dir: plugin.dir,
      profiles: [...new Set(plugin.installs.map((i) => i.profile))].sort(),
      ...(plugin.spec ? { spec: plugin.spec } : {}),
      import: importResult,
      inject: checkInject(manifest, inventory),
      peers: checkPeers(manifest, inventory),
    };
    row.verdict = verdictFor(row);
    row.advisories = advisoriesFor(row);
    plugins.push(row);
  }

  const settings = checkSettings && !explicit ? {
    file: settingsPath,
    agentPresets: checkPresetSetting(readSettingsSection(settingsPath, 'agent-presets'), presetIds),
  } : { file: null, agentPresets: { status: 'skipped', wanted: null, available: presetIds } };

  const counts = { 'blocks-boot': 0, ok: 0, unknown: 0, unresolvable: 0, withAdvisories: 0 };
  for (const p of plugins) {
    counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;
    if (p.advisories.length) counts.withAdvisories++;
  }
  // A blocked profile is one that holds at least one blocks-boot instance.
  const profiles = {};
  for (const p of plugins) {
    for (const profile of p.profiles) {
      const entry = profiles[profile] ?? (profiles[profile] = { boots: true, blockedBy: [] });
      if (p.verdict === 'blocks-boot') { entry.boots = false; entry.blockedBy.push(`${p.name}@${p.version ?? '?'}`); }
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    target: { requested: String(target ?? 'latest'), version, package: HOST_PACKAGE },
    host: { version, prefix: host.prefix, treeDir: host.treeDir, cached: host.cached, installedAt: host.installedAt, packages: inventory.packages.size, clientModules: inventory.clientIds.size },
    current: { version: currentHost, profilesDir: explicit ? null : root },
    subjects: explicit ? 'explicit' : 'profiles',
    listing,
    plugins,
    settings,
    summary: {
      counts,
      profiles,
      allProfilesBoot: counts['blocks-boot'] === 0,
      settingsIssues: settings.agentPresets.status === 'invalid' ? 1 : 0,
    },
  };
}
