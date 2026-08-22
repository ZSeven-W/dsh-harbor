// Discovery: which third-party plugins are installed, in which profiles, and
// from where. Installations are grouped by provenance, not by physical path: a
// plain-semver npm install is one row no matter how many profiles hold a copy
// (pnpm materialises one per profile), while each `link:`/`file:` target and
// each `(unlisted)` realpath is its own row — a working tree and an npm publish
// are different code and must not collapse into one.

import { readdirSync, existsSync, realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const OFFICIAL_SCOPE = '@deepseek-ai/';

export function profilesDir() {
  return process.env.DSH_HOME
    ? join(process.env.DSH_HOME, 'profiles')
    : join(homedir(), '.dsh', 'profiles');
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Discover installed third-party plugins, grouped by provenance.
 *
 * The grouping key ("identity") is the source, not the physical path:
 * - a plain semver spec (e.g. "0.1.0-rc.1") → `${name}@${spec}`, so the same
 *   npm version installed in several profiles collapses to one row whose
 *   `installs` lists every profile — pnpm stores a separate physical copy per
 *   profile, so keying by realpath alone would split them;
 * - a `link:` or `file:` spec → `${name}@${spec}`, so distinct link targets
 *   stay distinct rows and never merge with the npm copy (different code);
 * - `(unlisted)` → the realpath, preserving the old behaviour when the spec is
 *   unknown.
 *
 * `dir` is the first realpath seen for that identity; copies of the same npm
 * version are interchangeable, so any one will do.
 *
 * @returns {Array<{name: string, dir: string, identity: string, installs: Array<{profile: string, position: number, spec: string, linked: boolean}>}>}
 */
export function discoverInstalls({ root = profilesDir(), includeOfficial = false } = {}) {
  const byIdentity = new Map();
  if (!existsSync(root)) return [];

  for (const profile of readdirSync(root)) {
    const manifest = readJson(join(root, profile, 'package.json'));
    if (!manifest) continue;
    const bundles = manifest.dsh?.profile?.bundles ?? [];

    bundles.forEach((name, position) => {
      if (!includeOfficial && name.startsWith(OFFICIAL_SCOPE)) return;
      const linkPath = join(root, profile, 'node_modules', name);
      if (!existsSync(linkPath)) return; // declared but not installed — reported separately later

      const dir = realpathSync(linkPath);
      const spec = manifest.dependencies?.[name] ?? '(unlisted)';
      const identity = spec === '(unlisted)' ? dir : `${name}@${spec}`;
      // The identity is exported: the snapshot keys its records by it, so a
      // merged row keeps a stable fingerprint even when the first-encountered
      // realpath changes with directory order.
      if (!byIdentity.has(identity)) byIdentity.set(identity, { name, dir, identity, installs: [] });
      byIdentity.get(identity).installs.push({
        profile,
        position,
        spec,
        // Spec alone decides: root may itself be a symlink, so comparing it
        // against realpathSync(dir) never matches reliably.
        linked: spec.startsWith('link:') || spec.startsWith('file:'),
      });
    });
  }
  return [...byIdentity.values()];
}
