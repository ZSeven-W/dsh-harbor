// Per-plugin inspection: declared surface, capabilities with evidence, and the
// registry keys it claims (which feed the conflict matrix).

import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { CAPABILITIES, capabilityMatches } from './detectors.mjs';
import {
  walkSource, readSourceFile, SOURCE_SCAN_LIMITS, looksBundled, createLineLocator,
  Findings, libIsArtifact, classifySourcePath,
} from './evidence.mjs';
import { readJson, OFFICIAL_SCOPE } from './discover.mjs';

const SOURCE_CAPS = CAPABILITIES.filter((c) => c.where === 'source' && c.match);

// Hosts that only ever appear in docs/badges — listing them as egress targets
// would be noise, not information.
const DOC_HOSTS = new Set([
  'github.com', 'www.github.com', 'raw.githubusercontent.com', 'www.npmjs.com',
  'registry.npmjs.org', 'img.shields.io', 'json.schemastore.org', 'opensource.org',
  'platform.deepseek.com', 'localhost',
]);

// RFC 2606/6761 reserved names are placeholders by definition — usually test
// fixtures. Listing them as egress targets would imply traffic that cannot
// happen. A bare word with no dot is not a host either.
const RESERVED_TLD = /\.(example|invalid|test|localhost)$/;

function isRealHost(host) {
  if (DOC_HOSTS.has(host)) return false;
  if (!host.includes('.')) return false;
  if (RESERVED_TLD.test(host)) return false;
  // The URL extractor intentionally stops before ports/paths, but source
  // examples such as "https://..." otherwise leave "..." behind. Require
  // valid DNS-style labels (IPv4 also satisfies this shape) before presenting
  // a value as a contacted host.
  return host.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

function pathIsInside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function isPhysicalDirectory(path) {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

/** Count official packages physically owned by this plugin tree.
 *
 * Workspace installs commonly expose the host's @deepseek-ai packages through
 * symlinks under a plugin's node_modules. Their path looks nested, but they are
 * the exact host realm, not a second copy. A package counts only when its
 * resolved target remains inside the plugin root; pnpm links into the plugin's
 * own .pnpm store still count because those are genuinely plugin-owned copies.
 */
function nestedOfficialCopies(dir) {
  const nested = join(dir, 'node_modules', '@deepseek-ai');
  let root;
  let scopeTarget;
  try {
    root = realpathSync(dir);
    scopeTarget = realpathSync(nested);
  } catch {
    return [];
  }
  if (!pathIsInside(root, scopeTarget)) return [];

  let entries;
  try { entries = readdirSync(nested, { withFileTypes: true }); } catch { return []; }
  const copies = [];
  for (const entry of entries) {
    const packagePath = join(nested, entry.name);
    try {
      const stat = lstatSync(packagePath);
      if (!stat.isDirectory() && !stat.isSymbolicLink()) continue;
      const target = realpathSync(packagePath);
      if (pathIsInside(root, target)) copies.push(entry.name);
    } catch { /* dangling/unreadable entries are not disk evidence */ }
  }
  return copies;
}

function scanManifest(dir, findings) {
  const pkg = readJson(join(dir, 'package.json')) ?? {};

  if (pkg.dsh?.client) {
    findings.add('client-injection', {
      tier: 'declared', file: 'package.json', line: 0,
      excerpt: `dsh.client → ${pkg.dsh.client.platform ?? 'web'}`,
    });
  }

  const officialDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith(OFFICIAL_SCOPE));
  if (officialDeps.length) {
    findings.add('realm-risk', {
      tier: 'declared', file: 'package.json', line: 0,
      excerpt: `dependencies: ${officialDeps.slice(0, 3).join(', ')}${officialDeps.length > 3 ? ` +${officialDeps.length - 3}` : ''}`,
      detail: `${officialDeps.length} 个官方包在 dependencies 中`,
    });
  }

  // A nested copy is the direct cause of the Symbol identity split, so count it
  // — "20 packages" reads very differently from "1".
  const nestedCopies = nestedOfficialCopies(dir);
  if (nestedCopies.length) {
    const count = nestedCopies.length;
    findings.add('realm-copy', {
      tier: 'declared', file: 'node_modules/@deepseek-ai', line: 0,
      excerpt: `插件目录内自带 ${count} 个官方包副本，装载时可能造成 Symbol 身份分裂`,
    });
  }

  const patchRel = pkg.dsh?.bundle?.patch?.replace(/^\.\//, '') ?? 'cordis.patch.yml';
  const patchPath = join(dir, patchRel);
  let patchIds = [];
  try {
    // A manifest may point `dsh.bundle.patch` at arbitrary filesystem input.
    // Treat it by the same regular-file rule as source so a symlink cannot
    // escape the plugin and a FIFO/device cannot block the scan.
    const patchStat = lstatSync(patchPath);
    const root = realpathSync(dir);
    const target = realpathSync(patchPath);
    if (patchStat.isFile() && pathIsInside(root, target) && patchStat.size <= 2_000_000) {
      patchIds = [...readFileSync(patchPath, 'utf8').matchAll(/^\s*-?\s*id:\s*(\S+)/gm)].map((m) => m[1]);
    }
  } catch { /* absent, unreadable, or non-regular patch: no declared ids */ }

  return {
    version: pkg.version ?? '?',
    description: pkg.description ?? '',
    isBundle: !!pkg.dsh?.bundle,
    hasClient: !!pkg.dsh?.client,
    // DSH's client loader contract uses the npm package name as the module id.
    // This is declared truth, unlike a generated source string in a build
    // script; literal runtime registrations found later are unioned with it.
    clientModuleId: pkg.dsh?.client && typeof pkg.name === 'string' && pkg.name.trim()
      ? pkg.name.trim()
      : null,
    patchIds,
    declaredCapabilities: pkg.dsh?.capabilities ?? null,
  };
}

// Does the package's primary entry (main, or the "." export) live under
// src/? Feeds the lib/ artifact judgment in evidence.mjs (see libIsArtifact
// there for why the judgment exists at all).
//
// Only the primary entry counts. A wildcard convenience export such as
// "./*": "./src/*" sits in the same exports map, but it is not "the entry":
// packages that ship only hand-written lib/ (main → lib/index.js) next to
// such a wildcard would otherwise have their entire tree branded as a bundle.
// Glob values never count either — a glob cannot be an entry.
function entryTargetsSrc(pkg) {
  const targets = [];
  if (typeof pkg.main === 'string') targets.push(pkg.main);
  if (typeof pkg.exports === 'string') {
    targets.push(pkg.exports);
  } else if (pkg.exports && typeof pkg.exports === 'object') {
    const collect = (node) => {
      if (typeof node === 'string') targets.push(node);
      else if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v);
    };
    collect(pkg.exports['.']);
  }
  return targets.some((t) => !t.includes('*') && /(^|[/\\\\])src[/\\\\]/.test(t));
}

// Does any declared entry of the package — main, the "." export, or a bin
// value — resolve into an artifact-classified file? Reuses classifySourcePath
// so the answer comes from the single exclusion table in evidence.mjs, never
// from a second ad-hoc path list. A leading "./" is stripped first because
// the table's top-level checks ("lib/") compare against the first path
// segment. Glob patterns are never entries, same as entryTargetsSrc.
function entryTargetsArtifact(pkg, { libArtifact }) {
  const targets = [];
  if (typeof pkg.main === 'string') targets.push(pkg.main);
  if (typeof pkg.exports === 'string') {
    targets.push(pkg.exports);
  } else if (pkg.exports && typeof pkg.exports === 'object') {
    const collect = (node) => {
      if (typeof node === 'string') targets.push(node);
      else if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v);
    };
    collect(pkg.exports['.']);
  }
  if (typeof pkg.bin === 'string') targets.push(pkg.bin);
  else if (pkg.bin && typeof pkg.bin === 'object') {
    for (const v of Object.values(pkg.bin)) if (typeof v === 'string') targets.push(v);
  }
  return targets.some((t) => {
    if (t.includes('*')) return false;
    return classifySourcePath(t.replace(/^\.\//, ''), { libArtifact }) === 'artifact';
  });
}

// How much smaller must the author-source side be, relative to the artifact
// side, before a package counts as shipping a shim instead of the
// implementation? See sourceIsShim for the corpus measurements behind this
// line — an explainable line, not a guess.
const SHIM_BYTES_RATIO = 10;

/**
 * Is the author-source side merely a shim in front of the artifact tree?
 *
 * The zero-source fallback below handles packages that ship no source at
 * all, but real packages ship a *token* of source and still keep the entire
 * implementation in dist/: dsh-feishu-bot's source side is one 74-byte
 * shebang wrapper (bin/dsh-feishu-bot.mjs) around dist/cli.js's 1.5 MB;
 * dsh-llm-fallbacks' is six build scripts; dsh-testkit's is one
 * community-validation runner. With a non-empty source side defeating the
 * artifact fallback, the report goes from inflated to empty — the
 * mirror-image lie. This judgment detects that shape with two checkable
 * facts, both measured on the 141-package corpus:
 *
 * 1. Byte ratio, not file count. A 74-byte wrapper and a 74 KB
 *    implementation are both one file; bytes separate them. The five corpus
 *    victims sit at artifact-bytes ÷ source-bytes ≈ ×44 (dsh-testkit),
 *    ×10.2 (dsh-llm-fallbacks), ×10.6 (_liustack_pptfast) and ×20,000+
 *    (dsh-feishu-bot, dsh-lark-bot) — all above the ×10 line. Every
 *    source-first package sits far below it: dsh-config-manager is at ×1.2,
 *    and the tightest known non-victim — deepseek-idesign/ippt, whose lib/
 *    is compiled output with the entry pointing at it — is at ×9.4. The
 *    line separates the two populations with margin on both sides, and the
 *    entry check below independently keeps idesign out even if its byte
 *    ratio drifts across it.
 *
 * 2. The declared entry loads the artifact side. When main/exports/bin
 *    point into dist/ (or into lib/ judged artifact), the runtime executes
 *    the artifact tree, so the shipped behavior genuinely lives there and
 *    the source side is the wrapper. When the entries point at the source
 *    side instead, a big artifact tree next to it is a compiled copy of
 *    src plus bundled dependencies — the double-copy shape the artifact
 *    exclusion already handles — and scanning it would re-import exactly
 *    the third-party noise the previous fix removed (the pi2dsh shape: 1004
 *    credential hits inside the bundled Anthropic SDK). The byte test alone
 *    could misfire on that shape when the real src is small but its
 *    dependency bundle is large; the entry test alone cannot see a shim
 *    loaded by an undeclared path. Together they pick out "tiny source
 *    side, and the entries say the artifact is the program" — precisely the
 *    five measured victims and nothing else in the corpus. bin is included
 *    because the CLI entry is a first-class load path: _liustack_pptfast's
 *    export points at its hand-written dsh/ glue, but its bin points at
 *    dist/cli.js where the deck-generation implementation lives, and that
 *    is what the skill actually executes.
 *
 * @param {{size: number}[]} srcFiles source-classified files
 * @param {{size: number}[]} artFiles artifact-classified files
 * @param {object} pkg the package.json
 * @param {boolean} libArtifact the lib/ judgment for this package
 * @returns {boolean}
 */
function sourceIsShim(srcFiles, artFiles, pkg, libArtifact) {
  const srcBytes = srcFiles.reduce((a, f) => a + f.size, 0);
  const artBytes = artFiles.reduce((a, f) => a + f.size, 0);
  if (artBytes === 0) return false;
  if (srcBytes * SHIM_BYTES_RATIO >= artBytes) return false;
  return entryTargetsArtifact(pkg, { libArtifact });
}

// Replace strings and comments with spaces while retaining offsets. Client
// bundle builders contain generated `__ModuleLoader__` source inside quoted
// strings; scanning the raw text treats the quote that *ends* such a string as
// the quote that starts a literal module id. We first locate loader calls in
// executable code, then read the literal id from the original slice.
function maskStringsAndComments(text) {
  // split('') preserves UTF-16 code-unit offsets used by RegExp match.index;
  // a code-point spread would shift every position after an emoji.
  const chars = text.split('');
  let state = 'code';
  let escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i += 1;
        state = 'line-comment';
      } else if (char === '/' && next === '*') {
        chars[i] = chars[i + 1] = ' ';
        i += 1;
        state = 'block-comment';
      } else if (char === "'" || char === '"' || char === '`') {
        chars[i] = ' ';
        state = char;
        escaped = false;
      }
      continue;
    }
    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      else chars[i] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (char !== '\n') chars[i] = ' ';
      continue;
    }
    if (char === '\n') {
      // Keep line offsets readable even in template literals.
      escaped = false;
      continue;
    }
    chars[i] = ' ';
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === state) {
      state = 'code';
    }
  }
  return chars.join('');
}

function matchingParen(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

function clientModuleIdsIn(text) {
  if (!text.includes('__ModuleLoader__')) return [];
  const masked = maskStringsAndComments(text);
  const ids = [];
  const calls = /(?:\b(?:window|globalThis)\s*\.\s*)?\b__ModuleLoader__\s*\.\s*(?:load|register)\s*\(/g;
  for (const call of masked.matchAll(calls)) {
    const open = call.index + call[0].lastIndexOf('(');
    const close = matchingParen(masked, open);
    if (close === -1) continue;
    const args = text.slice(open + 1, close);
    const id = args.match(/(?:^|[{,])\s*id\s*:\s*(['"])([A-Za-z0-9@._:/-]{1,200})\1/)?.[2];
    if (id) ids.push(id);
  }
  return ids;
}

function sourceExpression(text, masked, start, stopChars) {
  let round = 0;
  let square = 0;
  let curly = 0;
  const endLimit = Math.min(masked.length, start + 1_000);
  for (let i = start; i < endLimit; i++) {
    const char = masked[i];
    if (char === '(') round += 1;
    else if (char === ')' && round > 0) round -= 1;
    else if (char === '[') square += 1;
    else if (char === ']' && square > 0) square -= 1;
    else if (char === '{') curly += 1;
    else if (char === '}' && curly > 0) curly -= 1;
    if (round === 0 && square === 0 && curly === 0 && stopChars.has(char)) {
      return text.slice(start, i).trim();
    }
  }
  return text.slice(start, endLimit).trim();
}

function routeDefinitionsIn(text, masked) {
  const definitions = new Map();
  const declarations = /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  for (const declaration of masked.matchAll(declarations)) {
    const start = declaration.index + declaration[0].length;
    const expression = sourceExpression(text, masked, start, new Set([';', '\n']));
    // Keep the graph route-specific. Feeding every const in a large plugin
    // into global name resolution creates dense collisions on generic names
    // such as `value` and `result`; route chains are either rooted in a
    // literal /_dsh value or use an explicit route/path/prefix/base name.
    if (!expression.includes('/_dsh/')
      && !/(?:route|path|prefix|base|endpoint|api|url)/i.test(declaration[1])
      && !/(?:route|path|prefix|base|endpoint|api|url)/i.test(expression)) continue;
    if (!definitions.has(declaration[1])) definitions.set(declaration[1], []);
    definitions.get(declaration[1]).push(expression);
  }
  return definitions;
}

function registeredRouteExpressionsIn(text, masked) {
  // A route claim exists only in a module that executes the DSH registration
  // API. Frontend fetch constants and shared protocol modules may carry the
  // same /_dsh path, but they consume the route rather than own it.
  if (!/\bwebServer\s*\.\s*register(?:Upgrade)?\s*\(/.test(masked)) return [];
  const expressions = [];
  for (const field of masked.matchAll(/\bpath\s*:/g)) {
    const start = field.index + field[0].length;
    expressions.push(sourceExpression(text, masked, start, new Set([',', ';', '\n', '}'])));
  }
  return expressions;
}

function addDefinitions(target, incoming) {
  for (const [name, expressions] of incoming) {
    if (!target.has(name)) target.set(name, []);
    target.get(name).push(...expressions);
  }
}

function routeBase(value) {
  const match = /\/_dsh\/([A-Za-z0-9._-]+)/.exec(value);
  return match ? `/_dsh/${match[1]}` : null;
}

function resolveRouteBases(expression, localDefinitions, globalDefinitions, seen = new Set()) {
  const bases = new Set();
  for (const path of expression.matchAll(/\/_dsh\/[A-Za-z0-9._-]+/g)) {
    const base = routeBase(path[0]);
    if (base) bases.add(base);
  }
  for (const token of expression.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    const name = token[1];
    if (seen.has(name) || seen.size >= 24) continue;
    const definitions = localDefinitions.get(name) ?? globalDefinitions.get(name);
    if (!definitions) continue;
    seen.add(name);
    for (const nested of definitions) {
      for (const base of resolveRouteBases(nested, localDefinitions, globalDefinitions, seen)) bases.add(base);
    }
    seen.delete(name);
  }
  return bases;
}

function scanSources(dir, findings) {
  const claims = { toolNames: new Set(), routeBases: new Set(), providerIds: new Set(), clientModuleIds: new Set() };
  const hooks = new Set();
  const egressHosts = new Set();
  const envVars = new Set();
  const globalRouteDefinitions = new Map();
  const routeRegistrationSites = [];
  let sourceFiles = 0;
  let bundledFiles = 0;
  let sourceBytes = 0;
  const skipped = {
    skippedFiles: 0,
    nonRegularFiles: 0,
    oversizeFiles: 0,
    unreadableFiles: 0,
    changedFiles: 0,
    limitSkippedFiles: 0,
    entriesVisited: 0,
    filesAccepted: 0,
    bytesAccepted: 0,
  };

  const pkg = readJson(join(dir, 'package.json')) ?? {};
  const libArtifact = libIsArtifact({
    hasSrc: isPhysicalDirectory(join(dir, 'src')),
    entryInSrc: entryTargetsSrc(pkg),
  });
  const files = [...walkSource(dir, { libArtifact, coverage: skipped })];

  // Author source first — but only when it is the implementation. Two
  // distinct shapes make that assumption false, and both fall back to the
  // artifact tree with the whole report marked sourceKind: 'bundled' and
  // every finding heuristic/(产物):
  //   1. no author source at all — a published plugin that ships only build
  //      output. A blanket exclusion would produce zero detections, the
  //      mirror image of the double-counting this policy removes, and just
  //      as dishonest;
  //   2. a shim instead of the implementation (sourceIsShim above): the
  //      source side is a wrapper or build scripts while the artifact tree
  //      holds the shipped behavior. Scanning only the source side then
  //      reports "this plugin does nothing" (dsh-feishu-bot: credential-
  //      handling 103 → 0), a lie more dangerous than the inflation this
  //      policy fixes.
  // In both shapes source and artifact are scanned together — the 74-byte
  // wrapper is author code too and costs nothing to read — and nothing is
  // double-counted: the two sides of a shim package hold different code
  // (wrapper vs implementation), while the src+dist double-copy packages
  // whose sides do overlap never reach this path, because sourceIsShim's
  // byte-ratio and entry checks both fail for them.
  const srcFiles = files.filter((f) => f.kind === 'source');
  const artFiles = files.filter((f) => f.kind === 'artifact');
  let scanFiles = srcFiles;
  let sourceKind = 'source';
  if (srcFiles.length === 0) {
    scanFiles = artFiles;
    if (scanFiles.length) sourceKind = 'bundled';
  } else if (sourceIsShim(srcFiles, artFiles, pkg, libArtifact)) {
    scanFiles = [...srcFiles, ...artFiles];
    sourceKind = 'bundled';
  }

  for (const file of scanFiles) {
    const remainingBytes = Math.max(0, SOURCE_SCAN_LIMITS.maxTotalBytes - sourceBytes);
    const read = readSourceFile(file, {
      maxBytes: Math.min(SOURCE_SCAN_LIMITS.maxFileBytes, remainingBytes),
    });
    if (!read.ok) {
      skipped.skippedFiles += 1;
      if (read.reason === 'nonRegular') skipped.nonRegularFiles += 1;
      else if (read.reason === 'changed') skipped.changedFiles += 1;
      else if (read.reason === 'oversize' && remainingBytes < SOURCE_SCAN_LIMITS.maxFileBytes) {
        skipped.totalBytesLimitExceeded = true;
        skipped.limitSkippedFiles += 1;
      } else if (read.reason === 'oversize') skipped.oversizeFiles += 1;
      else skipped.unreadableFiles += 1;
      continue;
    }
    const text = read.text;
    sourceBytes += read.bytes;
    sourceFiles += 1;
    const lines = createLineLocator(text);
    // The kind from the classification table overrides the looksBundled
    // heuristic: a small chunk file can have short lines and pass the
    // heuristic, but it is still bundled output by class.
    // Under either fallback every scanned file is flagged: a report marked
    // 'bundled' must not let a single static-tier citation from a shim file
    // upgrade the whole finding past the bundle read.
    const bundled = sourceKind === 'bundled' || file.kind === 'artifact' || looksBundled(text);
    if (bundled) bundledFiles += 1;
    const label = bundled ? `${file.rel} (产物)` : file.rel;

    // Same-file const → quoted-string table. Used only to resolve identifiers
    // that appear inside a registerAdapter bracket list (see below): the API
    // position is what makes the value a provider id, and a value that is not
    // a plain same-file quoted string is never guessed at.
    const constStringValues = new Map();
    for (const c of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*['"]([^'"\n]{1,200})['"]/g)) {
      constStringValues.set(c[1], c[2]);
    }

    const codeMask = maskStringsAndComments(text);
    const routeDefinitions = routeDefinitionsIn(text, codeMask);
    addDefinitions(globalRouteDefinitions, routeDefinitions);
    for (const expression of registeredRouteExpressionsIn(text, codeMask)) {
      routeRegistrationSites.push({ expression, definitions: routeDefinitions });
    }

    for (const cap of SOURCE_CAPS) {
      const tier = bundled ? 'heuristic' : cap.tier;
      for (const m of capabilityMatches(cap, text)) {
        findings.add(cap.id, {
          tier, file: label, line: lines.lineNumberAt(m.index), excerpt: lines.lineAt(m.index),
        });
        if (cap.id === 'global-hook' && m[1]) hooks.add(m[1]);
        if (cap.id === 'llm-adapter' && m[1]) {
          for (const id of m[1].matchAll(/['"]([^'"]+)['"]/g)) claims.providerIds.add(id[1]);
          // dsh-crew registers by identifier: `const VISION_PROVIDER =
          // 'deepseek-vision'` far above, then hands registerAdapter a
          // bracket list of identifiers, so the inline-quoted extraction
          // above finds nothing. Resolve identifiers inside the bracket list
          // against the same-file const table, but only when the list is a
          // plain comma-separated identifier list: every element in that API
          // position is a provider id by definition, while any operator, call
          // or spread means the id is computed and its value must not be
          // guessed at.
          if (/^[\s,A-Za-z_$][\s,A-Za-z0-9_$]*$/.test(m[1])) {
            for (const id of m[1].matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
              const value = constStringValues.get(id[1]);
              if (value) claims.providerIds.add(value);
            }
          }
        }
        if (cap.id === 'env-read' && m[1]) envVars.add(m[1]);
      }
    }

    // A tool is an object with both a name and a description next to it.
    for (const m of text.matchAll(/name:\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) {
      if (/description:\s*['"`]/.test(text.slice(m.index, m.index + 500))) {
        claims.toolNames.add(m[1]);
        findings.add('tool-registration', {
          tier: bundled ? 'heuristic' : 'heuristic', file: label,
          line: lines.lineNumberAt(m.index), excerpt: `tool "${m[1]}"`,
        });
      }
    }
    // Tool-name constant tables. dsh-openpencil never writes a literal quoted
    // name value next to its description: each model-facing name lives in an
    // exported all-caps constant (OPENPENCIL_RENDER_TOOL_NAME and friends,
    // whose values like openpencil_render are held `as const`) and that
    // identifier is handed to defineTool's name slot. Both ends of the
    // assignment are the precision gate: an all-caps identifier ending in
    // _TOOL_NAME (a name-table convention, never a prose field) holding a
    // lowercase snake_case string (the model-facing tool-name charset).
    // Arbitrary name fields on other objects cannot match, and LEGACY_*
    // constants are skipped because they name aliases retained for replay,
    // not active registrations (dsh-openpencil documents its design_render
    // alias exactly that way). The pattern is anchored to the start of the
    // line (leading whitespace allowed): tool-name tables are top-level
    // declarations, and the anchor keeps a documentation example inside a
    // comment line from self-matching — this scanner reads its own source.
    for (const m of text.matchAll(/^[ \t]*(?:export[ \t]+)?const[ \t]+((?!LEGACY_)[A-Z][A-Z0-9_]*_TOOL_NAME)[ \t]*=[ \t]*['"]([a-z][a-z0-9_]{2,})['"]/gm)) {
      claims.toolNames.add(m[2]);
      findings.add('tool-registration', {
        tier: 'heuristic', file: label,
        line: lines.lineNumberAt(m.index), excerpt: `tool "${m[2]}" (${m[1]} const)`,
      });
    }
    for (const id of clientModuleIdsIn(text)) claims.clientModuleIds.add(id);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (isRealHost(host)) egressHosts.add(host);
    }
  }

  // Resolve only path fields from modules that actually call the registration
  // API. Constants may live in a shared host/client module, so resolution is a
  // post-pass over all scanned definitions; the consumer file itself still
  // cannot claim ownership without a registrar.
  for (const site of routeRegistrationSites) {
    for (const base of resolveRouteBases(site.expression, site.definitions, globalRouteDefinitions)) {
      claims.routeBases.add(base);
    }
  }

  // The aggregate lines carry the same tier as the scan itself: a bundled
  // fallback must not smuggle in a static-tier summary over heuristic
  // evidence, or the bundle would pass for a source read after all.
  const aggregateTier = sourceKind === 'bundled' ? 'heuristic' : 'static';
  // A URL literal is data, not an action. Host detail may enrich an existing
  // egress finding, but must never manufacture the capability by itself.
  if (egressHosts.size && findings.has('network-egress')) {
    findings.add('network-egress', {
      tier: aggregateTier, file: '', detail: `${sourceKind === 'bundled' ? '产物' : '源码'}中出现的主机: ${[...egressHosts].slice(0, 8).join(', ')}${egressHosts.size > 8 ? ` +${egressHosts.size - 8}` : ''}`,
    });
  }
  if (envVars.size) {
    findings.add('env-read', {
      tier: aggregateTier, file: '', detail: `读取: ${[...envVars].sort().slice(0, 10).join(', ')}${envVars.size > 10 ? ` +${envVars.size - 10}` : ''}`,
    });
  }

  return { claims, hooks: [...hooks].sort(), sourceFiles, sourceBytes, bundledFiles, sourceKind, skipped };
}

/** @returns a full report for one installed plugin */
export function inspectPlugin(plugin) {
  const findings = new Findings();
  const declared = scanManifest(plugin.dir, findings);
  const { claims, hooks, sourceFiles, sourceBytes, bundledFiles, sourceKind, skipped } = scanSources(plugin.dir, findings);
  if (declared.clientModuleId) claims.clientModuleIds.add(declared.clientModuleId);

  return {
    name: plugin.name,
    version: declared.version,
    description: declared.description,
    dir: plugin.dir,
    identity: plugin.identity ?? `${plugin.name}\u0000${plugin.dir}`,
    installs: plugin.installs,
    declared,
    capabilities: findings.toJSON(),
    claims: {
      toolNames: [...claims.toolNames].sort(),
      routeBases: [...claims.routeBases].sort(),
      providerIds: [...claims.providerIds].sort(),
      clientModuleIds: [...claims.clientModuleIds].sort(),
    },
    hooks,
    coverage: {
      sourceFiles,
      sourceBytes,
      bundledFiles,
      // Everything below rests on build output; say so rather than implying
      // the same confidence as a source read.
      sourceAvailable: sourceKind === 'source' && sourceFiles > 0,
      // 'source' = every scanned file is the author's own source (build
      // artifacts and tests were excluded); 'bundled' = the package shipped
      // no author source, or only a shim in front of its build output (see
      // sourceIsShim), and the scan fell back to the artifacts — every
      // finding above is flagged and the capability profile must be read as
      // "what got bundled in", not "what the author wrote".
      sourceKind,
      skippedFiles: skipped.skippedFiles,
      skipped: {
        nonRegular: skipped.nonRegularFiles,
        oversize: skipped.oversizeFiles,
        unreadable: skipped.unreadableFiles,
        changed: skipped.changedFiles,
        limit: skipped.limitSkippedFiles,
      },
      limits: {
        entriesVisited: skipped.entriesVisited,
        filesAccepted: skipped.filesAccepted,
        bytesAccepted: skipped.bytesAccepted,
        entryExceeded: skipped.entryLimitExceeded === true,
        fileExceeded: skipped.fileLimitExceeded === true,
        totalBytesExceeded: skipped.totalBytesLimitExceeded === true,
        depthExceeded: skipped.depthLimitExceeded === true,
      },
    },
  };
}
