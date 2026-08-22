// Source walking and evidence extraction.
//
// Every claim harbor makes carries a file:line and the line itself. Without
// that, a report is just an opinion — the author cannot check it and the user
// cannot trust it.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_EXT = /\.(mjs|cjs|js|ts|tsx|mts|cts)$/;
const MAX_FILE_BYTES = 2_000_000;
const MAX_EVIDENCE_PER_CAP = 6;

// ---------------------------------------------------------------------------
// File classification: which files in a plugin tree are the author's own
// source, and which are not?
//
// Why this exists (measured on a batch scan of the top 140 real dsh-plugin
// packages on npm, the numbers behind the 0.1.0-rc.1 fix): 800 of 1405
// evidence lines (56.9%), spread across 110 packages, came from bundled build
// output — paths under dist/ lib/ build/ out/ bundle/ or *.min.js — and 21
// packages had the same evidence counted once in src/ and once again in
// dist/. A capability profile built from that data describes which
// third-party libraries got bundled in, not what the plugin itself does: the
// worst example, pi2dsh, had 1004 credential-handling hits that all point at
// dist/anthropic-messages-CaYTgvLF.mjs — the bundled Anthropic SDK, not
// plugin-authored code. Another 2.7% of evidence came from test and fixture
// files (dsh-config-manager's credential hits live inside assertions in
// src/ui/errors.test.ts). harbor's core promise is trustworthy evidence, so
// these classes never enter the author-source scan:
//
//   skip       never scanned, under any circumstances — dependency trees,
//              VCS internals, and tooling output that is nobody's shipped
//              code (a capability claim must never rest on coverage output);
//   artifact   the plugin's own build output — excluded from the normal
//              scan, but the only fallback candidates when a package ships
//              no source at all (see scanSources in inspect.mjs); findings
//              drawn from them are flagged as bundled, never source;
//   test       test/fixture code — excluded always. Falling back to tests
//              would re-import exactly the noise this table removes.
//
// The rules live here, as one table plus one judgment function, so the
// exclusion policy has a single home instead of being scattered across the
// scanner.

// Never scanned, at any depth. node_modules is pruned during the walk itself
// (it dwarfs every other tree and yields nothing); the rest are pruned here
// so the walk never descends into them either.
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '.git', '.client-build', 'coverage']);

// Build-output directories: the plugin's own compiled/bundled artifacts.
// Matched at any depth — monorepo packages/*/dist follow the same contract —
// because the name is the contract: a directory carrying one of these names
// holds build output wherever it appears. 'dist-test' is this repo's
// pre-.client-build output name, kept for legacy trees.
const ARTIFACT_DIRS = new Set(['dist', 'build', 'out', 'bundle', '.output', 'dist-test']);

// Test/fixture directories. Only exact names: a src/test-utils/ helper dir is
// hand-written source and stays in.
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', '__mocks__']);

// Minified bundles — the classic pre-bundled distribution form.
const MINIFIED_FILE = /\.min\.(?:js|mjs|cjs)$/;
// *.test.* / *.spec.* files in any scanned extension.
const TEST_FILE = /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx|mts|cts)$/;

/**
 * Is lib/ build output for this package?
 *
 * lib/ is ambiguous by nature: harbor itself ships lib/client.js as a build
 * artifact, but plenty of packages keep hand-written source in lib/. Blanket
 * exclusion would erase the only copy of the code for packages that publish
 * no src/ tree — dsh-quant, for example, ships only lib/ with the entry at
 * lib/index.js, and all 46 of its tool registrations live there; zero
 * detections are a worse lie than double counting. The judgment therefore
 * rests on evidence that a *separate* source tree exists: a src/ directory in
 * the package, or a main/exports entry pointing into src/. With that
 * evidence, lib/ is a compiled copy of code the scan already covers; without
 * it, lib/ is the only copy and must be read as source.
 *
 * @param {{hasSrc: boolean, entryInSrc: boolean}} hints
 * @returns {boolean}
 */
export function libIsArtifact({ hasSrc, entryInSrc }) {
  return hasSrc || entryInSrc;
}

/**
 * Classify one plugin file by its path relative to the plugin root.
 * @param {string} rel plugin-root-relative path
 * @param {{libArtifact?: boolean}} [opts] the lib/ judgment from libIsArtifact
 * @returns {'source' | 'artifact' | 'test' | 'skip'}
 */
export function classifySourcePath(rel, { libArtifact = false } = {}) {
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1];
  // Skip dirs beat everything: they are never scanned, not even as fallback
  // candidates, so their contents have no class at all.
  for (const part of parts.slice(0, -1)) {
    if (ALWAYS_SKIP_DIRS.has(part)) return 'skip';
  }
  // File-name patterns next: a minified bundle or a test file is what it is
  // wherever it lives, even inside an artifact directory.
  if (MINIFIED_FILE.test(name)) return 'artifact';
  if (TEST_FILE.test(name)) return 'test';
  // Directory segments, root-first. A test dir beats an artifact dir (a
  // fixture inside dist/ is still a fixture).
  let sawArtifact = false;
  for (const part of parts.slice(0, -1)) {
    if (TEST_DIRS.has(part)) return 'test';
    if (ARTIFACT_DIRS.has(part)) sawArtifact = true;
  }
  if (sawArtifact) return 'artifact';
  // lib/ is judged only at the top level: src/lib/ is hand-written source in
  // the normal layout, never build output.
  if (parts[0] === 'lib' && libArtifact) return 'artifact';
  return 'source';
}

/**
 * Walk a plugin's own files, never its dependencies. Each entry carries the
 * classification above; callers decide which kinds to scan (see scanSources
 * in inspect.mjs for the artifact fallback).
 */
export function* walkSource(dir, { libArtifact = false } = {}) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Prune never-scanned trees during the walk itself: node_modules is
        // enormous and walking it would dominate the scan for zero yield.
        if (!ALWAYS_SKIP_DIRS.has(entry.name)) stack.push(join(current, entry.name));
        continue;
      }
      if (!SOURCE_EXT.test(entry.name)) continue;
      const path = join(current, entry.name);
      let size;
      try { size = statSync(path).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) continue;
      const rel = relative(dir, path);
      const kind = classifySourcePath(rel, { libArtifact });
      if (kind === 'skip') continue;
      yield { path, rel, size, kind };
    }
  }
}

/**
 * A published plugin often ships only its build output. Pattern matching still
 * works there, but the result deserves a weaker tier and a visible label — a
 * conclusion drawn from a bundle is a conclusion drawn from rubble.
 */
export function looksBundled(text) {
  if (text.length < 20_000) return false;
  const head = text.split('\n', 60);
  const longLines = head.filter((l) => l.length > 500).length;
  return longLines > 0 || head.length < 5;
}

export function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Strip terminal control bytes from a line lifted out of a plugin's own source.
 *
 * This is sanitisation of UNTRUSTED input, not formatting: the scanned plugin is
 * attacker-controlled, and a raw source line handed to a terminal can carry ANSI
 * escape sequences (ESC ]0;… BEL retitles the window, ESC[8m hides text, CSI
 * forges output) plus other C0 controls (CR, BEL, DEL) that scramble the readout.
 * We keep \t — a formatting byte, not an injection vector — and \n never reaches
 * us here (lineAt slices it away at the boundaries).
 *
 * The `detail` field is not run through this on purpose: the hosts and env-var
 * names it interpolates come from /https?:\/\/([a-z0-9.-]+)/gi and
 * /process\.env\.([A-Z][A-Z0-9_]{2,})/g, whose capture groups are already
 * restricted to safe character sets, so there is nothing left to strip.
 */
function sanitizeLine(text) {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

export function lineAt(text, index, limit = 180) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  const slice = sanitizeLine(text.slice(start, end).trim());
  return slice.length > limit ? `${slice.slice(0, limit)}…` : slice;
}

/** Accumulates capability findings, keeping the strongest tier and a few citations. */
export class Findings {
  constructor() { this.map = new Map(); }

  add(capId, { tier, file, line = 0, excerpt = '', detail = '' }) {
    if (!this.map.has(capId)) this.map.set(capId, { tier, evidence: [], omitted: 0, details: [] });
    const entry = this.map.get(capId);
    // 'static' beats 'heuristic': one solid citation lifts the whole finding
    if (tier === 'static' && entry.tier === 'heuristic') entry.tier = 'static';
    if (detail && !entry.details.includes(detail)) entry.details.push(detail);
    if (!file) return;
    if (entry.evidence.length < MAX_EVIDENCE_PER_CAP) entry.evidence.push({ file, line, excerpt });
    else entry.omitted += 1;
  }

  has(capId) { return this.map.has(capId); }
  toJSON() { return Object.fromEntries(this.map); }
}
