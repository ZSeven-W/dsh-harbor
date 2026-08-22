// Reconcile declared capabilities against detected ones, and draft manifests
// for plugin authors to copy-paste into package.json.
//
// A plugin author declares dsh.capabilities (an array of capability ids) to
// claim which powers their plugin uses. The scanner detects what's actually
// present in code and configuration. Reconciliation answers: does the
// declaration match reality? Why or why not?

import { CAPABILITIES } from './detectors.mjs';

// Create a lookup table of capability id → full record.
const CAPABILITY_MAP = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));
const KNOWN_IDS = new Set(CAPABILITIES.map((c) => c.id));

/**
 * Reconcile declared capabilities against detected ones.
 *
 * Takes the full report from inspectPlugin() and returns an analysis of how
 * the declared capabilities compare to what the scanner found. The status
 * field distinguishes three cases:
 *   - 'not-declared': plugin has no dsh.capabilities declaration
 *   - 'match': declared and detected are identical (unused is OK)
 *   - 'drift': detected includes capabilities not declared, or declared
 *     ids are unknown (typos, stale versions)
 *
 * Note: unused (declared but not detected) does NOT cause drift — declaring
 * more than you use is conservative and fine.
 *
 * @param {Object} report - Output of inspectPlugin()
 * @returns {Object}
 */
export function reconcile(report) {
  const declared = report.declared.declaredCapabilities;

  // Extract detected capability ids from the Findings map.
  const detectedIds = Object.keys(report.capabilities).sort();

  // Plugin did not declare any capabilities — it did not participate.
  if (declared === null) {
    return {
      declared: null,
      detected: detectedIds,
      undeclared: detectedIds,
      unused: [],
      unknown: [],
      status: 'not-declared',
    };
  }

  const declaredSet = new Set(declared);
  const detectedSet = new Set(detectedIds);

  // Partition declared capabilities by their status.
  const undeclared = detectedIds.filter((id) => !declaredSet.has(id));
  const unused = declared.filter((id) => !detectedSet.has(id)).sort();
  const unknown = declared.filter((id) => !KNOWN_IDS.has(id)).sort();

  // Drift exists if the author missed declaring any detected capability,
  // or made a typo/stale-version mistake in a declaration.
  const hasDrift = undeclared.length > 0 || unknown.length > 0;

  return {
    declared: declared.slice().sort(),
    detected: detectedIds,
    undeclared: undeclared.sort(),
    unused,
    unknown,
    status: hasDrift ? 'drift' : 'match',
  };
}

/**
 * Draft a capabilities declaration for the author to copy into package.json.
 *
 * Takes a report and generates both the JSON snippet and a checklist of notes
 * so the author can review what the scanner found before pasting.
 *
 * @param {Object} report - Output of inspectPlugin()
 * @returns {Object}
 */
export function draftManifest(report) {
  // Detected capabilities, sorted.
  const detected = Object.keys(report.capabilities).sort();

  // Format the JSON snippet: a code block ready to paste.
  const jsonLines = [
    '"dsh": {',
    '  "capabilities": [',
    ...detected.map((id) => `    "${id}",`),
  ];
  // Remove trailing comma from the last entry.
  jsonLines[jsonLines.length - 1] = jsonLines[jsonLines.length - 1].slice(0, -1);
  jsonLines.push('  ]', '}');

  const json = jsonLines.join('\n');

  // Notes: one line per capability to let the author verify each.
  const notes = detected.map((id) => {
    const cap = CAPABILITY_MAP[id];
    if (!cap) {
      // Should not happen if the scanner is working, but be safe.
      return `${id} (unknown)`;
    }
    return `${id} - ${cap.label.zh}: ${cap.note}`;
  });

  return {
    capabilities: detected,
    json,
    notes,
  };
}
