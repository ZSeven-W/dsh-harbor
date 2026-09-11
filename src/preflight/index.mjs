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

import { join } from 'node:path';
import { homedir } from 'node:os';
import { discoverInstalls, profilesDir, readJson } from '../scan/discover.mjs';
import {
  HOST_PACKAGE, ensureHost, hostPresetIds, installedHostVersion, listHostVersions,
  readHostInventory, readSettingsSection, resolveHostVersion,
} from './host.mjs';
import { checkInject, checkPeers, checkPresetSetting, probeImport } from './checks.mjs';
import { parseVersion } from './semver.mjs';

export { listHostVersions, listCachedHosts, resolveHostVersion, hostsRoot } from './host.mjs';

function settingsFile() {
  return process.env.DSH_HOME ? join(process.env.DSH_HOME, 'settings.yaml') : join(homedir(), '.dsh', 'settings.yaml');
}

function verdictFor(row) {
  if (row.import.status === 'fail') return 'blocks-boot';
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
  const installs = discover({ root });
  const plugins = [];
  for (const plugin of installs) {
    const manifest = readJson(join(plugin.dir, 'package.json')) ?? {};
    onLog(`probing ${plugin.name}@${plugin.resolvedVersion ?? '?'}`);
    const importResult = await probeImpl(plugin.dir, manifest, host.treeDir, { env });
    const row = {
      name: plugin.name,
      version: plugin.resolvedVersion,
      identity: plugin.identity,
      dir: plugin.dir,
      profiles: [...new Set(plugin.installs.map((i) => i.profile))].sort(),
      import: importResult,
      inject: checkInject(manifest, inventory),
      peers: checkPeers(manifest, inventory),
    };
    row.verdict = verdictFor(row);
    row.advisories = advisoriesFor(row);
    plugins.push(row);
  }

  const settings = {
    file: settingsPath,
    agentPresets: checkPresetSetting(readSettingsSection(settingsPath, 'agent-presets'), presetIds),
  };

  const counts = { 'blocks-boot': 0, ok: 0, unknown: 0, withAdvisories: 0 };
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
    current: { version: currentHost, profilesDir: root },
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
