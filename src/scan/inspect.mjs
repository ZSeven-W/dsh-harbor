// Per-plugin inspection: declared surface, capabilities with evidence, and the
// registry keys it claims (which feed the conflict matrix).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITIES } from './detectors.mjs';
import { walkSource, looksBundled, lineNumberAt, lineAt, Findings, libIsArtifact, classifySourcePath } from './evidence.mjs';
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
  return true;
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
  const nested = join(dir, 'node_modules', '@deepseek-ai');
  if (existsSync(nested)) {
    let count = 0;
    try { count = readdirSync(nested).length; } catch { /* unreadable: report presence only */ }
    findings.add('realm-copy', {
      tier: 'declared', file: 'node_modules/@deepseek-ai', line: 0,
      excerpt: `插件目录内自带 ${count || '若干'} 个官方包副本，装载时可能造成 Symbol 身份分裂`,
    });
  }

  const patchRel = pkg.dsh?.bundle?.patch?.replace(/^\.\//, '') ?? 'cordis.patch.yml';
  const patchPath = join(dir, patchRel);
  const patchIds = existsSync(patchPath)
    ? [...readFileSync(patchPath, 'utf8').matchAll(/^\s*-?\s*id:\s*(\S+)/gm)].map((m) => m[1])
    : [];

  return {
    version: pkg.version ?? '?',
    description: pkg.description ?? '',
    isBundle: !!pkg.dsh?.bundle,
    hasClient: !!pkg.dsh?.client,
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

function scanSources(dir, findings) {
  const claims = { toolNames: new Set(), routeBases: new Set(), providerIds: new Set(), clientModuleIds: new Set() };
  const hooks = new Set();
  const egressHosts = new Set();
  const envVars = new Set();
  let sourceFiles = 0;
  let bundledFiles = 0;

  const pkg = readJson(join(dir, 'package.json')) ?? {};
  const libArtifact = libIsArtifact({
    hasSrc: existsSync(join(dir, 'src')),
    entryInSrc: entryTargetsSrc(pkg),
  });
  const files = [...walkSource(dir, { libArtifact })];

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
    let text;
    try { text = readFileSync(file.path, 'utf8'); } catch { continue; }
    sourceFiles += 1;
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

    for (const cap of SOURCE_CAPS) {
      if (cap.match.require && !cap.match.require.test(text)) continue;
      const tier = bundled ? 'heuristic' : cap.tier;
      for (const pattern of cap.match.patterns) {
        for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
          findings.add(cap.id, {
            tier, file: label, line: lineNumberAt(text, m.index), excerpt: lineAt(text, m.index),
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
    }

    // Registry claims that are not capabilities themselves, but drive conflicts.
    for (const m of text.matchAll(/['"`](\/_dsh\/[A-Za-z0-9._-]+)/g)) {
      claims.routeBases.add(m[1].split('/').slice(0, 3).join('/'));
    }
    // A tool is an object with both a name and a description next to it.
    for (const m of text.matchAll(/name:\s*['"]([a-z][a-z0-9_]{2,})['"]/g)) {
      if (/description:\s*['"`]/.test(text.slice(m.index, m.index + 500))) {
        claims.toolNames.add(m[1]);
        findings.add('tool-registration', {
          tier: bundled ? 'heuristic' : 'heuristic', file: label,
          line: lineNumberAt(text, m.index), excerpt: `tool "${m[1]}"`,
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
        line: lineNumberAt(text, m.index), excerpt: `tool "${m[2]}" (${m[1]} const)`,
      });
    }
    for (const m of text.matchAll(/__ModuleLoader__[\s\S]{0,120}?id:\s*['"]([^'"]+)['"]/g)) {
      claims.clientModuleIds.add(m[1]);
    }
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (isRealHost(host)) egressHosts.add(host);
    }
  }

  // The aggregate lines carry the same tier as the scan itself: a bundled
  // fallback must not smuggle in a static-tier summary over heuristic
  // evidence, or the bundle would pass for a source read after all.
  const aggregateTier = sourceKind === 'bundled' ? 'heuristic' : 'static';
  if (egressHosts.size) {
    findings.add('network-egress', {
      tier: aggregateTier, file: '', detail: `${sourceKind === 'bundled' ? '产物' : '源码'}中出现的主机: ${[...egressHosts].slice(0, 8).join(', ')}${egressHosts.size > 8 ? ` +${egressHosts.size - 8}` : ''}`,
    });
  }
  if (envVars.size) {
    findings.add('env-read', {
      tier: aggregateTier, file: '', detail: `读取: ${[...envVars].sort().slice(0, 10).join(', ')}${envVars.size > 10 ? ` +${envVars.size - 10}` : ''}`,
    });
  }

  return { claims, hooks: [...hooks].sort(), sourceFiles, bundledFiles, sourceKind };
}

/** @returns a full report for one installed plugin */
export function inspectPlugin(plugin) {
  const findings = new Findings();
  const declared = scanManifest(plugin.dir, findings);
  const { claims, hooks, sourceFiles, bundledFiles, sourceKind } = scanSources(plugin.dir, findings);

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
    },
  };
}
