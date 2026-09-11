// Bring a plugin that is not installed in any profile into probe-able shape:
// an npm package (name or name@version) is packed from the registry, unpacked
// into a scratch directory, and its own runtime dependencies are installed
// with scripts disabled. Host packages (`@deepseek-ai/*`) are never installed
// here — the resolve hook supplies them from the target tree — so the only
// thing on disk is the plugin and the third-party modules it imports.

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn as spawnProcess } from 'node:child_process';
import { readJson } from '../scan/discover.mjs';
import { HOST_SCOPE } from './host.mjs';

const STEP_TIMEOUT_MS = 5 * 60 * 1000;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, { cwd, env = process.env, onLog = () => {}, spawnImpl = null, timeoutMs = STEP_TIMEOUT_MS } = {}) {
  return new Promise((done, fail) => {
    const options = { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', windowsHide: true };
    const child = spawnImpl ? spawnImpl(cmd, args, options) : spawnProcess(cmd, args, options);
    const out = [];
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } fail(new Error(`${cmd} ${args[0]} timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    const forward = (chunk) => { for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) { out.push(line); onLog(line); } };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.on('error', (error) => { clearTimeout(timer); fail(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return done(out);
      const tail = out.filter((l) => !/^npm (warn|notice)/i.test(l)).slice(-8).join(' | ');
      fail(new Error(`${cmd} ${args[0]} exited with code ${code}${tail ? `: ${tail}` : ''}`));
    });
  });
}

/** Strip `@deepseek-ai/*` from every dependency field so npm never installs a second host. */
function withoutHostDependencies(manifest) {
  const copy = { ...manifest };
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
    if (!copy[field] || typeof copy[field] !== 'object') continue;
    copy[field] = Object.fromEntries(Object.entries(copy[field]).filter(([name]) => !name.startsWith(HOST_SCOPE)));
  }
  delete copy.peerDependenciesMeta;
  return copy;
}

/**
 * Pack `spec` (name or name@version) into `<root>/<safe>/node_modules/<name>`
 * — the same shape a profile gives it, so a package importing itself by name
 * resolves — and install its non-host runtime dependencies as siblings under
 * `<root>/<safe>/node_modules`.
 * @returns {Promise<{dir: string, manifest: object, spec: string, version: string|null}>}
 */
export async function packPlugin(spec, { root, env = process.env, onLog = () => {}, spawnImpl = null, install = true } = {}) {
  if (typeof spec !== 'string' || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^\s/]+)?$/i.test(spec)) {
    throw new Error(`invalid npm package spec: ${spec}`);
  }
  const safe = spec.replace(/[@/]/g, '_').replace(/[^0-9A-Za-z._-]/g, '_');
  const dir = resolve(root, safe);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  onLog(`npm pack ${spec}`);
  await run(NPM, ['pack', spec, '--pack-destination', dir, '--ignore-scripts', '--silent'], { cwd: dir, env, onLog, spawnImpl });
  const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error(`npm pack produced no tarball for ${spec}`);
  const extract = join(dir, 'extract');
  mkdirSync(extract, { recursive: true });
  await run('tar', ['-xzf', join(dir, tarball), '-C', extract], { cwd: dir, env, onLog, spawnImpl });
  const manifest = readJson(join(extract, 'package', 'package.json'));
  if (!manifest) throw new Error(`packed ${spec} has no readable package.json`);
  const name = typeof manifest.name === 'string' && manifest.name ? manifest.name : spec.replace(/@[^@/]+$/, '');
  const pkgDir = join(dir, 'node_modules', name);
  const { renameSync, writeFileSync } = await import('node:fs');
  // Dependencies first, plugin second: npm prunes anything in node_modules
  // that the staging manifest does not list, so the plugin must move in after.
  if (install) {
    const trimmed = withoutHostDependencies(manifest);
    const hasDeps = Object.keys(trimmed.dependencies ?? {}).length > 0 || Object.keys(trimmed.optionalDependencies ?? {}).length > 0;
    if (hasDeps) {
      // The staging manifest at <dir> lists only third-party deps; npm puts
      // them in <dir>/node_modules beside the plugin, exactly like a profile.
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'harbor-pack-stage', private: true, dependencies: trimmed.dependencies ?? {}, optionalDependencies: trimmed.optionalDependencies ?? {} }));
      onLog(`npm install (dependencies of ${spec}, scripts disabled)`);
      await run(NPM, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--omit=peer', '--loglevel', 'error'], { cwd: dir, env, onLog, spawnImpl });
    }
  }
  mkdirSync(join(pkgDir, '..'), { recursive: true });
  renameSync(join(extract, 'package'), pkgDir);
  return { dir: pkgDir, manifest, spec, version: manifest.version ?? null };
}
