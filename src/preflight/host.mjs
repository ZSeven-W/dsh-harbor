// Target host trees for upgrade preflight: which DSH versions exist upstream,
// installing one into an isolated prefix under Harbor's state directory, and
// reading the package inventory of an installed tree. Nothing here touches a
// real profile or the global npm prefix.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn as spawnProcess } from 'node:child_process';
import { resolveRegistry } from '../scan/versions.mjs';
import { stateDir } from '../scan/snapshot.mjs';
import { readJson } from '../scan/discover.mjs';
import { parseVersion, compareVersions } from './semver.mjs';

export const HOST_PACKAGE = '@deepseek-ai/dsh';
export const HOST_SCOPE = '@deepseek-ai/';
const REQUEST_TIMEOUT_MS = 8000;
const COMPLETE_MARKER = '.harbor-host-complete.json';
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

export function hostsRoot(dir = stateDir()) {
  return join(dir, 'hosts');
}

/**
 * Upstream DSH versions: dist-tags plus the newest published versions, from
 * the registry the user's npm configuration selects for the host scope.
 * Explicit network; callers decide when it is acceptable to go online.
 */
export async function listHostVersions({ fetchImpl = globalThis.fetch, limit = 12 } = {}) {
  const registry = resolveRegistry(HOST_PACKAGE);
  const res = await fetchImpl(`${registry}/${HOST_PACKAGE}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registry HTTP ${res.status}`);
  const meta = await res.json();
  const tags = meta?.['dist-tags'] && typeof meta['dist-tags'] === 'object' ? meta['dist-tags'] : {};
  const versions = Object.keys(meta?.versions ?? {})
    .filter((v) => parseVersion(v))
    .sort((a, b) => compareVersions(b, a))
    .slice(0, limit);
  let host = null;
  try { host = new URL(registry).host; } catch { /* reported as-is */ }
  return { registry: host, tags: { ...tags }, versions, checkedAt: new Date().toISOString() };
}

/** Resolve a dist-tag or version string to a concrete version. */
export function resolveHostVersion(requested, listing) {
  const value = String(requested ?? '').trim();
  if (parseVersion(value)) return value;
  const tagged = listing?.tags?.[value];
  if (typeof tagged === 'string' && parseVersion(tagged)) return tagged;
  throw new Error(`unknown DSH version or dist-tag: ${value || '(empty)'}`);
}

/** Version of the DSH host that a profile directory is currently bound to. */
export function installedHostVersion(profileDir) {
  const manifest = readJson(join(profileDir, '..', 'node_modules', HOST_PACKAGE, 'package.json'))
    ?? readJson(join(profileDir, 'node_modules', HOST_PACKAGE, 'package.json'));
  return manifest?.version ?? null;
}

function prefixDir(version, root) {
  return join(root, version.replace(/[^0-9A-Za-z.+-]/g, '_'));
}

/** Directory holding the `@deepseek-ai/*` packages of an installed prefix. */
export function hostTreeDir(prefix) {
  const posix = join(prefix, 'lib', 'node_modules', HOST_PACKAGE, 'node_modules', '@deepseek-ai');
  const win32 = join(prefix, 'node_modules', HOST_PACKAGE, 'node_modules', '@deepseek-ai');
  if (existsSync(posix)) return posix;
  if (existsSync(win32)) return win32;
  return null;
}

/** file: URL the resolve hook uses as the parent of every host import. */
export function hostAnchorUrl(treeDir) {
  return pathToFileURL(join(resolve(treeDir), 'dsh-harbor-anchor.mjs')).href;
}

function readMarker(prefix) {
  return readJson(join(prefix, COMPLETE_MARKER));
}

/**
 * Ensure `@deepseek-ai/dsh@<version>` is installed under an isolated prefix.
 * A completed install is reused; an interrupted one is removed and redone.
 * `onLog` receives npm's output lines for progress display.
 */
export async function ensureHost(version, {
  root = hostsRoot(),
  npm = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  env = process.env,
  onLog = () => {},
  spawnImpl = null,
  timeoutMs = INSTALL_TIMEOUT_MS,
} = {}) {
  if (!parseVersion(version)) throw new Error(`invalid host version: ${version}`);
  const prefix = prefixDir(version, root);
  const marker = readMarker(prefix);
  const existingTree = hostTreeDir(prefix);
  if (marker?.version === version && existingTree) {
    return { version, prefix, treeDir: existingTree, cached: true, installedAt: marker.installedAt ?? null };
  }
  rmSync(prefix, { recursive: true, force: true });
  mkdirSync(prefix, { recursive: true });
  onLog(`npm install ${HOST_PACKAGE}@${version} → ${prefix}`);

  await new Promise((resolveInstall, rejectInstall) => {
    const args = [
      'install', '-g', '--prefix', prefix, `${HOST_PACKAGE}@${version}`,
      '--no-audit', '--no-fund', '--loglevel', 'warn',
    ];
    const spawnOptions = {
      env,
      cwd: prefix,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
    };
    // Tests inject spawnImpl; production launches npm through the real binding.
    const child = spawnImpl ? spawnImpl(npm, args, spawnOptions) : spawnProcess(npm, args, spawnOptions);
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      rejectInstall(new Error(`npm install timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    const forward = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) onLog(line);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.on('error', (error) => { clearTimeout(timer); rejectInstall(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveInstall();
      else rejectInstall(new Error(`npm install exited with code ${code}`));
    });
  });

  const treeDir = hostTreeDir(prefix);
  if (!treeDir) throw new Error(`install finished but no host tree found under ${prefix}`);
  const installedAt = new Date().toISOString();
  writeFileSync(join(prefix, COMPLETE_MARKER), `${JSON.stringify({ version, installedAt }, null, 2)}\n`);
  return { version, prefix, treeDir, cached: false, installedAt };
}

/** Installed hosts under the cache root, newest first. */
export function listCachedHosts(root = hostsRoot()) {
  if (!existsSync(root)) return [];
  const rows = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const prefix = join(root, entry.name);
    const marker = readMarker(prefix);
    if (!marker?.version || !hostTreeDir(prefix)) continue;
    rows.push({ version: marker.version, prefix, installedAt: marker.installedAt ?? null });
  }
  return rows.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Inventory of one host tree: every `@deepseek-ai/*` package with its version
 * and manifest, plus the ids that exist as web client modules.
 * @returns {{packages: Map<string, {version: string|null, dir: string, manifest: object}>, clientIds: Set<string>}}
 */
export function readHostInventory(treeDir) {
  const packages = new Map();
  const clientIds = new Set();
  for (const entry of readdirSync(treeDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = join(treeDir, entry.name);
    const manifest = readJson(join(dir, 'package.json'));
    if (!manifest?.name) continue;
    packages.set(manifest.name, { version: manifest.version ?? null, dir, manifest });
    const client = manifest.dsh?.client;
    if (client && typeof client === 'object' && client.platform === 'web') clientIds.add(manifest.name);
  }
  return { packages, clientIds };
}

/** Built-in agent preset ids shipped by a host tree (empty when unknown). */
export function hostPresetIds(treeDir) {
  const dir = join(treeDir, 'dsh-agent-presets', 'presets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'preset.yml')))
    .map((entry) => entry.name)
    .sort();
}

/** Read a two-level `section:\n  key: value` mapping from a settings YAML file. */
export function readSettingsSection(file, section) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === `${section}:`);
  if (start === -1) return null;
  const values = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s+/.test(line)) break;
    const m = /^\s{2}([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    values[m[1]] = value;
  }
  return values;
}
