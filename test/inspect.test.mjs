// Run: node --test 'test/*.test.mjs'
// Covers: src/scan/inspect.mjs — the author-source file policy end to end:
// build artifacts and tests never enter the normal scan, lib/ is judged by
// the presence of a src/ tree (or a src/-pointing entry), and a package that
// ships only build output falls back to scanning it with sourceKind
// 'bundled' so it cannot silently read as author code. A package whose
// source side is a shim in front of a much larger artifact tree (byte ratio
// ×10 plus a declared entry loading the artifact side, sourceIsShim) falls
// back the same way, scanning both sides under the bundled flag.
//
// Every fixture lives in a mkdtemp tree outside the repository, so none of
// these files can leak into harbor's self-scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPlugin } from '../src/scan/inspect.mjs';

// A file containing one detectable tool registration: a quoted name next to a
// description, exactly the shape the scanner's tool-registration probe looks
// for.
const tool = (name) => `export const t = { name: '${name}', description: 'does things' };\n`;

function makePkg(t, files, pkg = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-inspect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', ...pkg }));
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

const scan = (dir) => inspectPlugin({ name: 'fixture', dir, installs: [] });

test('dist/ is excluded from the author-source scan', (t) => {
  const report = scan(makePkg(t, {
    'src/index.mjs': tool('src_tool'),
    'dist/index.js': tool('dist_tool'),
  }));
  assert.deepEqual(report.claims.toolNames, ['src_tool'], 'the bundled copy must not register its tool twice');
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, true);
  assert.equal(report.coverage.bundledFiles, 0);
  const evidence = report.capabilities['tool-registration'].evidence.map((e) => e.file);
  assert.deepEqual(evidence, ['src/index.mjs']);
});

test('test files and test directories are excluded', (t) => {
  const report = scan(makePkg(t, {
    'src/index.mjs': tool('real_tool'),
    'src/index.test.mjs': tool('test_only_tool'),
    'test/helper.mjs': tool('helper_tool'),
    '__tests__/nested.mjs': tool('nested_tool'),
    'fixtures/f.mjs': tool('fixture_tool'),
  }));
  assert.deepEqual(report.claims.toolNames, ['real_tool'], 'assertions inside tests are not author behavior');
});

test('lib/ is excluded when a src/ tree exists', (t) => {
  const report = scan(makePkg(t, {
    'src/index.mjs': tool('src_tool'),
    'lib/index.js': tool('lib_tool'),
  }, { main: './lib/index.js' }));
  assert.deepEqual(report.claims.toolNames, ['src_tool'], 'with src/ present, lib/ is the compiled copy of code already scanned');
  assert.equal(report.coverage.sourceKind, 'source');
});

test('lib/ is kept as source when no src/ tree exists', (t) => {
  // dsh-quant shape: the published package carries only lib/, entry at
  // lib/index.js — excluding it would erase the only copy of the code.
  const report = scan(makePkg(t, {
    'lib/index.js': tool('lib_tool'),
  }, { main: './lib/index.js' }));
  assert.deepEqual(report.claims.toolNames, ['lib_tool']);
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, true);
});

test('an entry pointing into src/ marks lib/ as build output even without a src/ dir', (t) => {
  const report = scan(makePkg(t, {
    'lib/index.js': tool('lib_tool'),
  }, { main: './src/index.mjs' }));
  // lib/ is judged artifact, no source remains → the bundled fallback scans it.
  assert.deepEqual(report.claims.toolNames, ['lib_tool']);
  assert.equal(report.coverage.sourceKind, 'bundled');
});

test('a dist-only package falls back to its build output and is marked bundled', (t) => {
  const report = scan(makePkg(t, {
    'dist/index.js': tool('dist_tool'),
  }));
  assert.deepEqual(report.claims.toolNames, ['dist_tool'], 'falling back beats an empty report');
  assert.equal(report.coverage.sourceKind, 'bundled');
  assert.equal(report.coverage.sourceAvailable, false, 'the report must not pass as a source read');
  assert.equal(report.coverage.sourceFiles, 1);
  assert.equal(report.coverage.bundledFiles, 1);
  const finding = report.capabilities['tool-registration'];
  assert.equal(finding.tier, 'heuristic', 'bundled evidence never carries a static tier');
  assert.deepEqual(finding.evidence.map((e) => e.file), ['dist/index.js (产物)'], 'every bundled file is labelled 产物');
});

test('a minified bundle alone triggers the same fallback', (t) => {
  const report = scan(makePkg(t, {
    'index.min.js': tool('min_tool'),
  }));
  assert.deepEqual(report.claims.toolNames, ['min_tool']);
  assert.equal(report.coverage.sourceKind, 'bundled');
  assert.equal(report.coverage.sourceAvailable, false);
});

test('a package with only tests is not a fallback target', (t) => {
  const report = scan(makePkg(t, {
    'test/x.mjs': tool('test_only_tool'),
  }));
  assert.deepEqual(report.claims.toolNames, [], 'falling back to tests would re-import the noise this policy removes');
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, false);
});

test('a wildcard subpath export pointing into src/ does not brand lib/ as build output', (t) => {
  // Real shape from the corpus (_hytime_dsh-client-ui-shortcuts and
  // _isomoes_dsh-ikanban): main and "." export into lib/, only a convenience
  // "./*": "./src/*" wildcard mentions src/. lib/ is the only copy of the
  // code and must stay source.
  const report = scan(makePkg(t, {
    'lib/index.js': tool('lib_tool'),
  }, {
    main: './lib/index.js',
    exports: { '.': './lib/index.js', './*': './src/*' },
  }));
  assert.deepEqual(report.claims.toolNames, ['lib_tool']);
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, true);
});

// ---------------------------------------------------------------------------
// Shim degradation: a package whose author-source side is a wrapper in front
// of a much larger artifact tree (dsh-feishu-bot: a 74-byte bin/ shim around
// 1.5 MB of dist/) falls back to scanning both sides with everything flagged
// bundled — the "source exists, but is not the implementation" mirror image
// of the dist-only fallback above. The trigger is two checkable facts (see
// sourceIsShim in inspect.mjs): artifact bytes exceed source bytes ×10, and
// a declared entry (main/exports/bin) loads the artifact side.

test('a shim-sized source side falls back to the artifact and is marked bundled', (t) => {
  // The dsh-feishu-bot shape: the bin/ wrapper imports dist/cli.js and main
  // loads dist. Under the old scanFiles.length === 0 rule this package
  // reported sourceKind 'source' with zero capability detections — a plugin
  // that "does nothing".
  const report = scan(makePkg(t, {
    'bin/fixture.mjs': "#!/usr/bin/env node\nimport { main } from '../dist/cli.js';\n\nawait main();\n",
    'dist/cli.js': tool('cli_tool') + '// ' + 'x'.repeat(1200) + '\n',
  }, { main: './dist/cli.js', bin: { fixture: './bin/fixture.mjs' } }));
  assert.equal(report.coverage.sourceKind, 'bundled');
  assert.equal(report.coverage.sourceAvailable, false, 'the report must not pass as a source read');
  assert.deepEqual(report.claims.toolNames, ['cli_tool']);
  assert.equal(report.coverage.sourceFiles, 2, 'wrapper and artifact are both scanned');
  assert.equal(report.coverage.bundledFiles, 2, 'every scanned file is flagged under a bundled read');
  const finding = report.capabilities['tool-registration'];
  assert.equal(finding.tier, 'heuristic', 'bundled evidence never carries a static tier');
  assert.deepEqual(finding.evidence.map((e) => e.file), ['dist/cli.js (产物)'], 'every bundled file is labelled 产物');
});

test('the degraded scan reads both sides: author code in the shim is kept, flagged 产物', (t) => {
  // The fallback scans source and artifact together — the 74-byte wrapper is
  // author code too and costs nothing to read — and both sides carry the
  // bundled flag so no shim citation can upgrade the report to a source read.
  const report = scan(makePkg(t, {
    'bin/fixture.mjs': tool('shim_tool'),
    'dist/cli.js': tool('cli_tool') + '// ' + 'x'.repeat(1200) + '\n',
  }, { main: './dist/cli.js', bin: { fixture: './bin/fixture.mjs' } }));
  assert.equal(report.coverage.sourceKind, 'bundled');
  assert.deepEqual(report.claims.toolNames, ['cli_tool', 'shim_tool'], 'both sides are scanned');
  const files = report.capabilities['tool-registration'].evidence.map((e) => e.file);
  assert.ok(files.every((f) => f.endsWith(' (产物)')), 'even the shim file is labelled under the bundled read: ' + files.join(', '));
  assert.equal(report.capabilities['tool-registration'].tier, 'heuristic');
});

test('the byte-ratio boundary is exact: ×10 stays source, one byte over degrades', (t) => {
  // srcBytes × 10 < artifactBytes is the line. Exactly ×10 keeps the normal
  // source read (the artifact stays excluded); one more artifact byte
  // crosses into the shim fallback. Both fixtures point main at the artifact
  // so only the byte leg differs. Padding is computed from the actual
  // content length, so the boundary cannot drift with the fixture text.
  const srcContent = 'const x = 1;';
  const srcBytes = Buffer.byteLength(srcContent);
  const padDist = (totalBytes) => {
    const head = tool('dist_tool') + '// ';
    const pad = totalBytes - Buffer.byteLength(head) - 1; // trailing newline
    assert.ok(pad >= 0, 'padding must be non-negative');
    return head + 'x'.repeat(pad) + '\n';
  };
  const exact = scan(makePkg(t, {
    'src/index.mjs': srcContent,
    'dist/index.js': padDist(srcBytes * 10),
  }, { main: './dist/index.js' }));
  assert.equal(exact.coverage.sourceKind, 'source', 'exactly ×10 does not degrade');
  assert.deepEqual(exact.claims.toolNames, [], 'the artifact stays excluded');
  const over = scan(makePkg(t, {
    'src/index.mjs': srcContent,
    'dist/index.js': padDist(srcBytes * 10 + 1),
  }, { main: './dist/index.js' }));
  assert.equal(over.coverage.sourceKind, 'bundled', 'one byte past ×10 degrades');
  assert.deepEqual(over.claims.toolNames, ['dist_tool']);
});

test('a tiny real src with the entry pointing at it is never degraded (double-copy guard)', (t) => {
  // src and dist hold the same logic; dist also bundles a large dependency,
  // so the byte ratio alone would fire. The entry loads src/index.mjs — the
  // source IS the program — and the artifact exclusion must keep the dist
  // copy out: degrading here would re-import the bundled-dependency noise
  // the exclusion policy removes (the pi2dsh shape).
  const report = scan(makePkg(t, {
    'src/index.mjs': tool('src_tool'),
    'dist/index.js': tool('dist_tool') + '// ' + 'x'.repeat(1200) + '\n',
  }, { main: './src/index.mjs' }));
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, true);
  assert.deepEqual(report.claims.toolNames, ['src_tool'], 'the artifact copy must not register its tool twice');
  assert.equal(report.coverage.bundledFiles, 0);
});

test('the export pointing at hand-written code is overridden by a bin entry into dist (pptfast shape)', (t) => {
  // _liustack_pptfast: main/exports load the hand-written dsh/ glue, but the
  // bin entry loads dist/cli.js where the implementation lives. The bin leg
  // of the entry check is what catches it.
  const report = scan(makePkg(t, {
    'dsh/index.js': tool('glue_tool'),
    'dist/cli.js': tool('cli_tool') + '// ' + 'x'.repeat(1200) + '\n',
  }, { main: './dsh/index.js', bin: { fixture: './dist/cli.js' } }));
  assert.equal(report.coverage.sourceKind, 'bundled');
  assert.deepEqual(report.claims.toolNames, ['cli_tool', 'glue_tool'], 'both the glue and the implementation are scanned');
  assert.equal(report.capabilities['tool-registration'].tier, 'heuristic');
});

test('a small source next to a small artifact never degrades (ratio below ×10)', (t) => {
  // The _crazy_th_dsh-computer-use / dsh-plugin-vajraclaw shape: real src
  // with main pointing at dist, but the artifact is the same order of
  // magnitude — not a shim, no fallback.
  const report = scan(makePkg(t, {
    'src/index.ts': tool('src_tool'),
    'dist/index.js': tool('dist_tool'),
  }, { main: './dist/index.js' }));
  assert.equal(report.coverage.sourceKind, 'source');
  assert.equal(report.coverage.sourceAvailable, true);
  assert.deepEqual(report.claims.toolNames, ['src_tool'], 'the dist copy stays excluded');
  assert.equal(report.coverage.bundledFiles, 0);
});

test('realm-copy counts plugin-owned packages but ignores a host scope symlink', { skip: process.platform === 'win32' }, (t) => {
  const owned = makePkg(t, {
    'src/index.mjs': 'export const x = 1;\n',
    'node_modules/@deepseek-ai/dsh-agent/package.json': '{"name":"@deepseek-ai/dsh-agent"}',
  });
  assert.ok(scan(owned).capabilities['realm-copy'], 'a physical nested package is a second realm');

  const host = mkdtempSync(join(tmpdir(), 'harbor-host-realm-'));
  t.after(() => rmSync(host, { recursive: true, force: true }));
  const hostScope = join(host, 'node_modules', '@deepseek-ai');
  mkdirSync(join(hostScope, 'dsh-agent'), { recursive: true });
  writeFileSync(join(hostScope, 'dsh-agent', 'package.json'), '{"name":"@deepseek-ai/dsh-agent"}');

  const linked = makePkg(t, { 'src/index.mjs': 'export const x = 1;\n' });
  mkdirSync(join(linked, 'node_modules'), { recursive: true });
  symlinkSync(hostScope, join(linked, 'node_modules', '@deepseek-ai'), 'dir');
  assert.equal(
    scan(linked).capabilities['realm-copy'],
    undefined,
    'a link to the host packages shares the host realm and is not a nested copy',
  );

  const packageLinked = makePkg(t, { 'src/index.mjs': 'export const x = 1;\n' });
  const localScope = join(packageLinked, 'node_modules', '@deepseek-ai');
  mkdirSync(localScope, { recursive: true });
  symlinkSync(join(hostScope, 'dsh-agent'), join(localScope, 'dsh-agent'), 'dir');
  assert.equal(
    scan(packageLinked).capabilities['realm-copy'],
    undefined,
    'an individual package link to the host is not a nested copy either',
  );
});

test('URL literals enrich real egress but cannot create it', (t) => {
  const onlyUrl = scan(makePkg(t, {
    'src/constants.mjs': "export const docs = 'https://api.vendor.dev/v1';\n",
  }));
  assert.equal(onlyUrl.capabilities['network-egress'], undefined, 'data alone is not an outbound action');

  const request = scan(makePkg(t, {
    'src/request.mjs': "export async function go() { return fetch('https://api.vendor.dev/v1'); }\n",
  }));
  const finding = request.capabilities['network-egress'];
  assert.ok(finding, 'a real request remains detected');
  assert.ok(finding.details.some((detail) => detail.includes('api.vendor.dev')), 'host detail attaches to that behavior');
});

test('route claims belong to webServer.register owners, not fetch consumers', (t) => {
  const report = scan(makePkg(t, {
    'src/routes.mjs': "export const OWNER_ROUTE = '/_dsh/owner/report';\n",
    'src/host.mjs': [
      "import { OWNER_ROUTE } from './routes.mjs';",
      "webServer.register({ kind: 'exact', path: OWNER_ROUTE, handler() {} });",
    ].join('\n'),
    'src/client.mjs': [
      "const API = '/_dsh/foreign/report';",
      "const request = { path: '/_dsh/foreign/report' };",
      'export const load = () => fetch(API, request);',
    ].join('\n'),
  }));
  assert.deepEqual(report.claims.routeBases, ['/_dsh/owner']);
});

test('client module claims require an executable loader call with a literal id', (t) => {
  const report = scan(makePkg(t, {
    'src/runtime.mjs': "window.__ModuleLoader__.load({ id: '@scope/real-client', factory: () => {} });\n",
    'scripts/build-client.mjs': [
      "const pluginId = pkg.name;",
      "const header = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(pluginId) + ', factory: () => {';",
      "const templated = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pluginId)}, factory: () => {} })`;",
    ].join('\n'),
  }));
  assert.deepEqual(report.claims.clientModuleIds, ['@scope/real-client']);
});

test('a declared dsh client claims its package name and keeps explicit runtime ids', (t) => {
  const report = scan(makePkg(t, {
    'src/runtime.mjs': "window.__ModuleLoader__.load({ id: '@scope/compat-client', factory: () => {} });\n",
  }, {
    name: '@scope/declared-client',
    dsh: { client: { platform: 'web' } },
  }));
  assert.deepEqual(report.claims.clientModuleIds, [
    '@scope/compat-client',
    '@scope/declared-client',
  ]);
  assert.equal(report.declared.clientModuleId, '@scope/declared-client');
});

test('Harbor self-scan reports the declared client id, never its dynamic builder expression', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = inspectPlugin({ name: '@zseven-w/dsh-harbor', dir: root, installs: [] });
  assert.deepEqual(report.claims.clientModuleIds, ['@zseven-w/dsh-harbor']);
});

test('source-looking symlinks never escape the plugin and skipped coverage is visible', { skip: process.platform === 'win32' }, (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'harbor-outside-source-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const target = join(outside, 'outside.mjs');
  writeFileSync(target, tool('outside_tool'));

  const dir = makePkg(t, { 'src/inside.mjs': tool('inside_tool') });
  symlinkSync(target, join(dir, 'src', 'linked.mjs'));
  const report = scan(dir);
  assert.deepEqual(report.claims.toolNames, ['inside_tool']);
  assert.equal(report.coverage.skippedFiles, 1);
  assert.equal(report.coverage.skipped.nonRegular, 1);
});

test('declared patch files obey the same regular-file boundary', { skip: process.platform === 'win32' }, (t) => {
  const outside = mkdtempSync(join(tmpdir(), 'harbor-outside-patch-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const secret = join(outside, 'secret.yml');
  writeFileSync(secret, '- id: escaped-service\n');

  const linked = makePkg(t, { 'src/index.mjs': 'export const x = 1;\n' }, {
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  symlinkSync(secret, join(linked, 'cordis.patch.yml'));
  assert.deepEqual(scan(linked).declared.patchIds, [], 'a patch symlink cannot read outside the plugin');

  const fifo = makePkg(t, { 'src/index.mjs': 'export const x = 1;\n' }, {
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  });
  execFileSync('mkfifo', [join(fifo, 'cordis.patch.yml')]);
  assert.deepEqual(scan(fifo).declared.patchIds, [], 'a patch FIFO is rejected before read');
});
