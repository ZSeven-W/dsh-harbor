// Source walking and evidence extraction.
//
// Every claim harbor makes carries a file:line and the line itself. Without
// that, a report is just an opinion — the author cannot check it and the user
// cannot trust it.

import {
  closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, opendirSync, readSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_EXT = /\.(mjs|cjs|js|ts|tsx|mts|cts)$/;
const MAX_EVIDENCE_PER_CAP = 6;
const READ_CHUNK_BYTES = 64 * 1024;

/** Hard ceilings for one plugin scan. Optional caller limits may lower these
 * values for tests or tighter hosts, but can never expand them. */
export const SOURCE_SCAN_LIMITS = Object.freeze({
  maxFileBytes: 2_000_000,
  maxEntries: 50_000,
  maxFiles: 5_000,
  maxTotalBytes: 100_000_000,
  maxDepth: 32,
});

function boundedLimit(requested, ceiling) {
  return Number.isSafeInteger(requested) && requested >= 0
    ? Math.min(requested, ceiling)
    : ceiling;
}

function effectiveLimits(overrides = {}) {
  return Object.fromEntries(Object.entries(SOURCE_SCAN_LIMITS).map(([key, ceiling]) => (
    [key, boundedLimit(overrides[key], ceiling)]
  )));
}

function increment(coverage, key, amount = 1) {
  if (coverage) coverage[key] = (coverage[key] ?? 0) + amount;
}

function skipFile(coverage, reason) {
  increment(coverage, 'skippedFiles');
  increment(coverage, reason);
}

function hitLimit(coverage, key) {
  if (coverage) coverage[key] = true;
}

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
 * @param {string} dir plugin root
 * @param {{libArtifact?: boolean, coverage?: object, limits?: object}} [opts]
 *   scan hints, an optional mutable coverage object, and limits that may only
 *   lower the production ceilings
 */
export function* walkSource(dir, { libArtifact = false, coverage, limits: requestedLimits } = {}) {
  const limits = effectiveLimits(requestedLimits);
  const stack = [{ path: dir, depth: 0 }];
  let visitedEntries = 0;
  let acceptedFiles = 0;
  let acceptedBytes = 0;
  let stop = false;

  while (stack.length && !stop) {
    const current = stack.pop();
    let directory;
    try { directory = opendirSync(current.path); }
    catch { increment(coverage, 'unreadableDirectories'); continue; }

    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        visitedEntries += 1;
        if (coverage) coverage.entriesVisited = visitedEntries;
        if (visitedEntries > limits.maxEntries) {
          hitLimit(coverage, 'entryLimitExceeded');
          stop = true;
          break;
        }

        if (entry.isDirectory()) {
          // Prune never-scanned trees during the walk itself: node_modules is
          // enormous and walking it would dominate the scan for zero yield.
          if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
          if (current.depth >= limits.maxDepth) {
            hitLimit(coverage, 'depthLimitExceeded');
            increment(coverage, 'skippedDirectories');
            continue;
          }
          stack.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
          continue;
        }
        if (!SOURCE_EXT.test(entry.name)) continue;

        const path = join(current.path, entry.name);
        const rel = relative(dir, path);
        const kind = classifySourcePath(rel, { libArtifact });
        if (kind === 'skip') continue;

        // This lstat is the walk-time admission check. readSourceFile repeats
        // lstat immediately before O_NOFOLLOW open and verifies dev/ino after
        // fstat, closing the replacement race between enumeration and read.
        let stat;
        try { stat = lstatSync(path); }
        catch { skipFile(coverage, 'unreadableFiles'); continue; }
        if (!stat.isFile()) { skipFile(coverage, 'nonRegularFiles'); continue; }
        if (stat.size > limits.maxFileBytes) { skipFile(coverage, 'oversizeFiles'); continue; }
        if (acceptedFiles >= limits.maxFiles) {
          hitLimit(coverage, 'fileLimitExceeded');
          skipFile(coverage, 'limitSkippedFiles');
          stop = true;
          break;
        }
        if (acceptedBytes + stat.size > limits.maxTotalBytes) {
          hitLimit(coverage, 'totalBytesLimitExceeded');
          skipFile(coverage, 'limitSkippedFiles');
          continue;
        }

        acceptedFiles += 1;
        acceptedBytes += stat.size;
        if (coverage) {
          coverage.filesAccepted = acceptedFiles;
          coverage.bytesAccepted = acceptedBytes;
        }
        yield {
          path, rel, size: stat.size, kind,
          device: stat.dev, inode: stat.ino,
        };
      }
    } catch {
      increment(coverage, 'unreadableDirectories');
    } finally {
      try { directory.closeSync(); } catch { /* best effort after read error */ }
    }
  }
}

/**
 * Safely read one admitted source file without following a replacement link or
 * blocking on a replacement FIFO/device. The sequence is intentionally:
 * lstat -> O_NOFOLLOW|O_NONBLOCK open -> fstat -> bounded chunked reads.
 * dev/ino must still equal the walk-time entry, so replacing a regular file
 * with another regular file is rejected too.
 *
 * @param {{path:string, device?:number, inode?:number}} file walkSource entry
 * @param {{maxBytes?:number}} [opts] caller's remaining total-byte budget
 * @returns {{ok:true,text:string,bytes:number}|{ok:false,reason:string}}
 */
export function readSourceFile(file, { maxBytes = SOURCE_SCAN_LIMITS.maxFileBytes } = {}) {
  const ceiling = boundedLimit(maxBytes, SOURCE_SCAN_LIMITS.maxFileBytes);
  let descriptor;
  try {
    const before = lstatSync(file.path);
    if (!before.isFile()) return { ok: false, reason: 'nonRegular' };
    if ((file.device !== undefined && before.dev !== file.device)
      || (file.inode !== undefined && before.ino !== file.inode)) {
      return { ok: false, reason: 'changed' };
    }

    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const nonBlock = fsConstants.O_NONBLOCK ?? 0;
    descriptor = openSync(file.path, fsConstants.O_RDONLY | noFollow | nonBlock);
    const after = fstatSync(descriptor);
    if (!after.isFile()) return { ok: false, reason: 'nonRegular' };
    if (after.dev !== before.dev || after.ino !== before.ino) {
      return { ok: false, reason: 'changed' };
    }
    if (after.size > ceiling) return { ok: false, reason: 'oversize' };

    const chunks = [];
    let total = 0;
    while (true) {
      // The extra byte distinguishes an exact-ceiling file from one that grew
      // after fstat. It is never retained when the file is over budget.
      const capacity = Math.min(READ_CHUNK_BYTES, ceiling - total + 1);
      const chunk = Buffer.allocUnsafe(capacity);
      const bytesRead = readSync(descriptor, chunk, 0, capacity, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > ceiling) return { ok: false, reason: 'oversize' };
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { ok: true, text: Buffer.concat(chunks, total).toString('utf8'), bytes: total };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* best effort */ }
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
 * Build one line index for a source file and reuse it for every finding.
 *
 * Calling lineNumberAt(text, index) for each regex hit rescans from byte zero
 * every time. A generated file with thousands of findings therefore becomes
 * quadratic. This locator does one O(n) pass, then answers both the line
 * number and excerpt in O(log lines) + O(line length). The standalone helpers
 * remain exported for API compatibility; the scanner uses this indexed form.
 */
export function createLineLocator(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }

  const lineIndexAt = (rawIndex) => {
    const index = Math.max(0, Math.min(Number.isFinite(rawIndex) ? rawIndex : 0, text.length));
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= index) low = mid;
      else high = mid;
    }
    return low;
  };

  return {
    lineNumberAt(index) {
      return lineIndexAt(index) + 1;
    },
    lineAt(index, limit = 180) {
      const lineIndex = lineIndexAt(index);
      const start = starts[lineIndex];
      let end = lineIndex + 1 < starts.length ? starts[lineIndex + 1] - 1 : text.length;
      // CRLF: the line-feed is excluded above; exclude its preceding CR too.
      if (end > start && text.charCodeAt(end - 1) === 13) end -= 1;
      const slice = sanitizeLine(text.slice(start, end).trim());
      return slice.length > limit ? `${slice.slice(0, limit)}…` : slice;
    },
  };
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
