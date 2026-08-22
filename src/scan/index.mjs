// Scanner entry point. Composition only — every decision lives in a dedicated
// module so the CLI and the DSH settings page consume exactly the same core.

import { discoverInstalls, profilesDir } from './discover.mjs';
import { inspectPlugin } from './inspect.mjs';
import { findConflicts } from './conflicts.mjs';
import { diffAndStore } from './snapshot.mjs';
import { reconcile, draftManifest } from './manifest.mjs';
import { CAPABILITIES, byId } from './detectors.mjs';
import { crossProfileDrift, checkUpstream, compareVersions } from './versions.mjs';

export {
  discoverInstalls, profilesDir, inspectPlugin, findConflicts,
  diffAndStore, reconcile, draftManifest, CAPABILITIES, byId,
  crossProfileDrift, checkUpstream, compareVersions,
};

/**
 * Scan every installed plugin.
 * @param {{root?: string, snapshot?: boolean, stateDir?: string}} [options]
 */
export async function scan(options = {}) {
  const installs = discoverInstalls(options);
  const plugins = installs.map((install) => {
    const report = inspectPlugin(install);
    report.reconciliation = reconcile(report);
    return report;
  });

  const conflicts = findConflicts(plugins);
  // Local and free, so it is always on. The upstream check is not: it leaves
  // the machine, and scan() is the offline half of harbor.
  const versionDrift = crossProfileDrift(plugins);
  const { firstRun, changes, previousScanAt, warning } = options.snapshot === false
    ? { firstRun: false, changes: [], previousScanAt: null }
    : diffAndStore(plugins, options.stateDir ? { dir: options.stateDir } : {});

  return {
    scannedAt: new Date().toISOString(),
    profilesDir: options.root ?? profilesDir(),
    plugins,
    conflicts,
    versionDrift,
    snapshot: { firstRun, changes, previousScanAt, warning },
  };
}
