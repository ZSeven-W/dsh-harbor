// Contract diff between two DSH host trees: packages added/removed, web client
// modules added/removed, and per-package export names added/removed. This is
// the machine-readable changelog the release notes do not carry — the
// settingsNamespace removal in 0.1.5 shows up here as an export removal.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as spawnProcess } from 'node:child_process';
import { ensureHost, readHostInventory, hostPresetIds } from './host.mjs';
import { serverEntry } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPORTS_TIMEOUT_MS = 120_000;

/** Export names of every package in a tree, gathered in one child per tree. */
export async function collectExports(inventory, { nodeBin = process.execPath, spawnImpl = null, env = process.env } = {}) {
  const files = [];
  for (const [name, pkg] of inventory.packages) {
    const entry = serverEntry(pkg.dir, pkg.manifest);
    if (entry) files.push([name, entry]);
  }
  const args = [join(HERE, 'exports-main.mjs'), JSON.stringify(files)];
  const options = { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
  return new Promise((done, fail) => {
    const child = spawnImpl ? spawnImpl(nodeBin, args, options) : spawnProcess(nodeBin, args, options);
    const out = [];
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } fail(new Error('export collection timed out')); }, EXPORTS_TIMEOUT_MS);
    child.stdout.on('data', (c) => out.push(String(c)));
    child.stderr.on('data', () => {});
    child.on('error', (e) => { clearTimeout(timer); fail(e); });
    child.on('close', () => {
      clearTimeout(timer);
      const text = out.join('').trim().split('\n').pop();
      try { done(JSON.parse(text || '{}')); } catch { fail(new Error('export collection produced no JSON')); }
    });
  });
}

function diffSets(a, b) {
  const added = [...b].filter((x) => !a.has(x)).sort();
  const removed = [...a].filter((x) => !b.has(x)).sort();
  return { added, removed };
}

/**
 * @param {string} from  DSH version
 * @param {string} to    DSH version
 */
export async function hostDiff(from, to, { onLog = () => {}, ensureHostImpl = ensureHost, collectExportsImpl = collectExports, hostsRoot: root } = {}) {
  const a = await ensureHostImpl(from, { root, onLog });
  const b = await ensureHostImpl(to, { root, onLog });
  const invA = readHostInventory(a.treeDir);
  const invB = readHostInventory(b.treeDir);
  onLog(`collecting exports of ${invA.packages.size} + ${invB.packages.size} packages`);
  const [exA, exB] = await Promise.all([collectExportsImpl(invA), collectExportsImpl(invB)]);

  const packages = diffSets(new Set(invA.packages.keys()), new Set(invB.packages.keys()));
  const clientModules = diffSets(invA.clientIds, invB.clientIds);
  const presets = diffSets(new Set(hostPresetIds(a.treeDir)), new Set(hostPresetIds(b.treeDir)));
  const exportsChanged = [];
  for (const name of [...invA.packages.keys()].filter((n) => invB.packages.has(n)).sort()) {
    const ea = exA[name]?.exports;
    const eb = exB[name]?.exports;
    if (!ea || !eb) continue;
    const d = diffSets(new Set(ea), new Set(eb));
    if (d.added.length || d.removed.length) exportsChanged.push({ name, ...d });
  }
  const versionChanged = [...invB.packages.keys()].filter((n) => invA.packages.has(n) && invA.packages.get(n).version !== invB.packages.get(n).version).length;
  return {
    from: { version: from, packages: invA.packages.size, clientModules: invA.clientIds.size },
    to: { version: to, packages: invB.packages.size, clientModules: invB.clientIds.size },
    packages,
    clientModules,
    presets,
    exports: exportsChanged,
    unreadable: { from: Object.entries(exA).filter(([, v]) => v.error).map(([n, v]) => ({ name: n, error: v.error })), to: Object.entries(exB).filter(([, v]) => v.error).map(([n, v]) => ({ name: n, error: v.error })) },
    summary: {
      packagesRemoved: packages.removed.length,
      packagesAdded: packages.added.length,
      clientModulesRemoved: clientModules.removed.length,
      exportsRemovedIn: exportsChanged.filter((e) => e.removed.length).length,
      versionBumps: versionChanged,
      breaking: packages.removed.length > 0 || clientModules.removed.length > 0 || exportsChanged.some((e) => e.removed.length > 0) || presets.removed.length > 0,
    },
  };
}

/** Markdown rendering shared by the CLI and the release watcher. */
export function renderHostDiffMarkdown(d) {
  const lines = [`## DSH ${d.from.version} → ${d.to.version}`, ''];
  lines.push(`${d.from.packages} → ${d.to.packages} packages, ${d.from.clientModules} → ${d.to.clientModules} web client modules. ${d.summary.breaking ? '**Contains removals plugins can depend on.**' : 'No removals detected.'}`, '');
  const list = (title, items, fmt = (x) => `\`${x}\``) => { if (items.length) { lines.push(`### ${title}`, '', ...items.map((x) => `- ${fmt(x)}`), ''); } };
  list('Packages removed', d.packages.removed);
  list('Packages added', d.packages.added);
  list('Web client modules removed', d.clientModules.removed);
  list('Web client modules added', d.clientModules.added);
  list('Built-in presets removed', d.presets.removed);
  list('Built-in presets added', d.presets.added);
  const removedExports = d.exports.filter((e) => e.removed.length);
  if (removedExports.length) {
    lines.push('### Exports removed', '');
    for (const e of removedExports) lines.push(`- \`${e.name}\`: ${e.removed.map((x) => `\`${x}\``).join(', ')}`);
    lines.push('');
  }
  const addedExports = d.exports.filter((e) => e.added.length);
  if (addedExports.length) {
    lines.push('### Exports added', '');
    for (const e of addedExports) lines.push(`- \`${e.name}\`: ${e.added.map((x) => `\`${x}\``).join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
