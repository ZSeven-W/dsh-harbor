// Run: node --test 'test/*.test.mjs'
// Covers: src/scan/evidence.mjs — Findings tiers/capping, looksBundled,
// and the source/artifact/test file classification (classifySourcePath,
// libIsArtifact, walkSource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Findings, looksBundled, lineNumberAt, lineAt, classifySourcePath, libIsArtifact, walkSource } from '../src/scan/evidence.mjs';

test('Findings: a static citation beats a heuristic one', () => {
  const f = new Findings();
  f.add('subprocess', { tier: 'heuristic', file: 'a.mjs', line: 1, excerpt: 'first' });
  f.add('subprocess', { tier: 'static', file: 'a.mjs', line: 2, excerpt: 'second' });
  assert.equal(f.toJSON().subprocess.tier, 'static');

  // Reverse order must also end up static.
  const g = new Findings();
  g.add('subprocess', { tier: 'static', file: 'a.mjs' });
  g.add('subprocess', { tier: 'heuristic', file: 'a.mjs' });
  assert.equal(g.toJSON().subprocess.tier, 'static');
});

test('Findings: evidence is capped at 6 and the rest count as omitted', () => {
  const f = new Findings();
  for (let i = 0; i < 10; i++) {
    f.add('x', { tier: 'heuristic', file: 'f' + i + '.mjs', line: i, excerpt: 'e' + i });
  }
  const entry = f.toJSON().x;
  assert.equal(entry.evidence.length, 6);
  assert.equal(entry.omitted, 4);
});

test('looksBundled: a long-line artifact returns true', () => {
  assert.equal(looksBundled('x'.repeat(20000)), true);
});

test('looksBundled: ordinary short-line source returns false', () => {
  const lines = [];
  for (let i = 0; i < 2000; i++) lines.push('export const v' + i + ' = ' + i + ';');
  assert.equal(looksBundled(lines.join('\n')), false);
});

test('lineNumberAt and lineAt locate the matched line (text, not exact bytes)', () => {
  const text = 'const a = 1;\nconst token = "abc";\nconst b = 2;';
  const idx = text.indexOf('token');
  assert.equal(lineNumberAt(text, idx), 2);
  assert.ok(lineAt(text, idx).includes('token'));
});

// ---------------------------------------------------------------------------
// File classification — the one table + one judgment function that decide
// whether evidence can be attributed to the plugin author.

test('classifySourcePath: build-output directories are artifacts at any depth', () => {
  for (const rel of ['dist/index.js', 'build/x.mjs', 'out/y.ts', 'bundle/z.tsx', '.output/server/index.mjs', 'packages/a/dist/index.mjs']) {
    assert.equal(classifySourcePath(rel), 'artifact', rel);
  }
});

test('classifySourcePath: minified bundles are artifacts, other min-named files are source', () => {
  for (const rel of ['index.min.js', 'lib/x.min.mjs', 'deep/dir/app.min.cjs']) {
    assert.equal(classifySourcePath(rel), 'artifact', rel);
  }
  assert.equal(classifySourcePath('app.min.ts'), 'source', 'only the minified JS family counts');
  assert.equal(classifySourcePath('src/mindset.js'), 'source');
});

test('classifySourcePath: test files and test dirs are excluded, helper dirs are not', () => {
  for (const rel of ['src/a.test.ts', 'b.spec.mjs', '__tests__/x.js', 'test/y.ts', 'tests/z.tsx', 'fixtures/f.mjs', '__fixtures__/g.cjs', '__mocks__/h.mjs', 'dist/fixtures/inside-artifact.js']) {
    assert.equal(classifySourcePath(rel), 'test', rel);
  }
  assert.equal(classifySourcePath('src/test-utils/helper.mjs'), 'source', 'a test-utils helper dir is hand-written source');
});

test('classifySourcePath: skip dirs beat everything and are never fallback candidates', () => {
  assert.equal(classifySourcePath('node_modules/x/y.js'), 'skip');
  assert.equal(classifySourcePath('coverage/lcov/index.js'), 'skip');
  assert.equal(classifySourcePath('node_modules/dist/bundle.min.js'), 'skip');
});

test('classifySourcePath: the lib/ judgment applies only to the top level', () => {
  assert.equal(classifySourcePath('lib/index.js', { libArtifact: true }), 'artifact');
  assert.equal(classifySourcePath('lib/index.js', { libArtifact: false }), 'source');
  assert.equal(classifySourcePath('src/lib/x.js', { libArtifact: true }), 'source', 'src/lib/ is hand-written source in the normal layout');
});

test('libIsArtifact: evidence of a separate source tree is what excludes lib/', () => {
  assert.equal(libIsArtifact({ hasSrc: true, entryInSrc: false }), true, 'a src/ tree means lib/ is compiled output');
  assert.equal(libIsArtifact({ hasSrc: false, entryInSrc: true }), true, 'an entry pointing into src/ means the same');
  assert.equal(libIsArtifact({ hasSrc: false, entryInSrc: false }), false, 'without either, lib/ is the only copy and stays source');
});

test('walkSource: yields classified entries and never descends into skip dirs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-walk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel) => {
    const path = join(root, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, 'export const x = 1;\n');
  };
  put('src/a.mjs');
  put('dist/b.mjs');
  put('test/c.mjs');
  put('node_modules/d.mjs');
  put('lib/e.mjs');

  const rels = new Map();
  for (const f of walkSource(root, { libArtifact: true })) rels.set(f.rel, f.kind);
  assert.equal(rels.get('src/a.mjs'), 'source');
  assert.equal(rels.get('dist/b.mjs'), 'artifact');
  assert.equal(rels.get('test/c.mjs'), 'test');
  assert.equal(rels.get('lib/e.mjs'), 'artifact');
  assert.equal(rels.has('node_modules/d.mjs'), false, 'node_modules is pruned, never yielded');
});
