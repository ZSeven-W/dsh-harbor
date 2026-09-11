// The four preflight checks, each a pure function over (plugin, host tree).
// Verdict vocabulary is fixed so the CLI, hub and panel render the same facts:
//   import:  ok | fail            (hard signal — a failing import kills the profile)
//   inject:  present | missing    (per client id)
//   peers:   satisfied | unsatisfied | missing-in-host | unparseable
//   preset:  ok | invalid | unknown

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn as spawnProcess } from 'node:child_process';
import { satisfies } from './semver.mjs';
import { HOST_SCOPE, hostAnchorUrl } from './host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE_TIMEOUT_MS = 20_000;
const MAX_ERROR_LENGTH = 2000;

/** The server entry a plugin's manifest names, resolved to an absolute path. */
export function serverEntry(pluginDir, manifest) {
  const exportsField = manifest?.exports;
  let candidate = null;
  if (typeof exportsField === 'string') candidate = exportsField;
  else if (exportsField && typeof exportsField === 'object' && '.' in exportsField) {
    const dot = exportsField['.'];
    candidate = typeof dot === 'string' ? dot : (dot?.import ?? dot?.default ?? null);
  }
  candidate = candidate ?? manifest?.main ?? null;
  if (typeof candidate !== 'string' || candidate === '') return null;
  return resolve(pluginDir, candidate);
}

/**
 * Import the plugin entry in a child process whose `@deepseek-ai/*` imports
 * resolve inside the target host tree. The child is disposable: the probe
 * never runs in the caller's process, so a crashing plugin cannot take the
 * hub down, and the host's own module cache is never touched.
 */
export async function probeImport(pluginDir, manifest, treeDir, {
  nodeBin = process.execPath,
  spawnImpl = null,
  timeoutMs = PROBE_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const entry = serverEntry(pluginDir, manifest);
  if (!entry) return { status: 'skipped', reason: 'no server entry in package.json', entry: null, resolved: [] };
  if (!existsSync(entry)) return { status: 'fail', code: 'ENTRY_MISSING', message: `entry not found: ${entry}`, entry, resolved: [] };

  const stdout = [];
  const stderr = [];
  const result = await new Promise((done) => {
    let child;
    try {
      const args = [
        '--no-warnings',
        '--import', pathToFileURL(join(HERE, 'hook-register.mjs')).href,
        join(HERE, 'probe-main.mjs'),
        entry,
      ];
      const spawnOptions = {
        cwd: pluginDir,
        env: { ...env, HARBOR_HOST_ANCHOR: hostAnchorUrl(treeDir) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      };
      child = spawnImpl ? spawnImpl(nodeBin, args, spawnOptions) : spawnProcess(nodeBin, args, spawnOptions);
    } catch (error) {
      return done({ ok: false, code: 'SPAWN_FAILED', message: String(error?.message ?? error) });
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      done({ ok: false, code: 'PROBE_TIMEOUT', message: `import did not settle within ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) stderr.push(line);
    });
    child.on('error', (error) => { clearTimeout(timer); done({ ok: false, code: 'SPAWN_FAILED', message: String(error?.message ?? error) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const last = stdout.join('').split('\n').map((l) => l.trim()).filter(Boolean).pop();
      if (last) {
        try { return done(JSON.parse(last)); } catch { /* fall through */ }
      }
      done({ ok: false, code: 'PROBE_NO_REPORT', message: `probe exited with code ${code} without a report${stderr.length ? `: ${stderr.slice(-5).join(' | ')}` : ''}` });
    });
  });

  const hostResolved = Array.isArray(result.resolved) ? [...new Set(result.resolved.map(String))].sort() : [];
  if (result.ok) return { status: 'ok', entry, exports: result.exports ?? [], resolved: hostResolved };
  return {
    status: 'fail',
    entry,
    code: String(result.code ?? 'Error'),
    message: String(result.message ?? '').slice(0, MAX_ERROR_LENGTH),
    resolved: hostResolved,
  };
}

/**
 * Every id in `dsh.client.inject` / `external` must be a client module the
 * target host can serve. DSH ≥ 0.1.5 silently skips unknown ids, so a dead
 * inject never errors — it only means the plugin stopped waiting on a package
 * that no longer exists, which is exactly the drift this check surfaces.
 */
export function checkInject(manifest, inventory) {
  const client = manifest?.dsh?.client;
  if (!client || typeof client !== 'object') return { declared: false, platform: null, ids: [] };
  const ids = [];
  const check = (field) => {
    const list = Array.isArray(client[field]) ? client[field] : [];
    for (const raw of list) {
      const id = String(raw).replace(/\/client$/u, '');
      const status = inventory.clientIds.has(id) ? 'present'
        : inventory.packages.has(id) ? 'not-a-client-module'
          : id.startsWith(HOST_SCOPE) ? 'missing' : 'third-party';
      ids.push({ field, id: String(raw), status });
    }
  };
  check('inject');
  check('external');
  return { declared: true, platform: client.platform ?? null, ids };
}

/** Host peer ranges against the versions the target tree actually ships. */
export function checkPeers(manifest, inventory) {
  const rows = [];
  for (const field of ['peerDependencies', 'dependencies', 'optionalDependencies']) {
    const deps = manifest?.[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith(HOST_SCOPE)) continue;
      const installed = inventory.packages.get(name)?.version ?? null;
      let status;
      if (installed === null) status = 'missing-in-host';
      else status = satisfies(installed, String(range));
      rows.push({ field, name, range: String(range), installed, status });
    }
  }
  return rows;
}

/**
 * The one user-settings check with a known upgrade casualty: the built-in
 * preset id renamed (`code` → `ptc`) and `agent-presets.default` kept the old
 * value, which makes every new session fail with agent-preset/not-found.
 */
export function checkPresetSetting(settingsValues, presetIds) {
  const wanted = settingsValues?.default;
  if (typeof wanted !== 'string' || wanted === '') return { status: 'unset', wanted: null, available: presetIds };
  if (presetIds.length === 0) return { status: 'unknown', wanted, available: [] };
  return { status: presetIds.includes(wanted) ? 'ok' : 'invalid', wanted, available: presetIds };
}
