// Run: node --test test/
// Covers: src/scan/discover.mjs — discoverInstalls grouping by provenance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync, truncateSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverInstalls, readJson } from '../src/scan/discover.mjs';
import { scan } from '../src/scan/index.mjs';

function buildProfiles(t) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-profiles-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const writeProfile = (profile, bundles, deps) => {
    const dir = join(root, profile);
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    for (const b of bundles) mkdirSync(join(dir, 'node_modules', b), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: profile,
      dependencies: deps,
      dsh: { profile: { bundles } },
    }));
  };

  writeProfile('p1', ['alpha', 'beta', 'gamma'], {
    alpha: '1.0.0-rc.1',
    beta: '1.0.0-rc.1',
    gamma: 'file:../gamma',
  });
  writeProfile('p2', ['alpha', 'beta'], {
    alpha: '1.0.0-rc.1',
    beta: 'link:../beta',
  });
  return root;
}

test('discoverInstalls: same semver in two profiles merges to one row with two installs', (t) => {
  const rows = discoverInstalls({ root: buildProfiles(t) });
  const alpha = rows.find((r) => r.name === 'alpha');
  assert.ok(alpha, 'alpha row exists');
  assert.match(alpha.identity, /^alpha@registry:/);
  assert.equal(alpha.installs.length, 2);
  assert.deepEqual(alpha.installs.map((i) => i.profile).sort(), ['p1', 'p2']);
  assert.ok(alpha.installs.every((i) => i.linked === false));
});

test('discoverInstalls: link: and npm versions stay separate rows', (t) => {
  const rows = discoverInstalls({ root: buildProfiles(t) });
  const npm = rows.find((r) => r.name === 'beta' && !r.installs[0].linked);
  const link = rows.find((r) => r.name === 'beta' && r.installs[0].linked);
  assert.ok(npm, 'npm row exists');
  assert.ok(link, 'link row exists');
  assert.equal(npm.installs.length, 1);
  assert.equal(npm.installs[0].profile, 'p1');
  assert.equal(npm.installs[0].linked, false);
  assert.equal(link.installs.length, 1);
  assert.equal(link.installs[0].profile, 'p2');
  assert.equal(link.installs[0].linked, true);
});

test('discoverInstalls: file: is linked, plain semver is not', (t) => {
  const rows = discoverInstalls({ root: buildProfiles(t) });
  const gamma = rows.find((r) => r.name === 'gamma');
  assert.ok(gamma, 'gamma file row exists');
  assert.equal(gamma.installs.length, 1);
  assert.equal(gamma.installs[0].linked, true);

  const alpha = rows.find((r) => r.name === 'alpha');
  assert.ok(alpha.installs.every((i) => i.linked === false));
});

test('readJson: accepts a small regular file but rejects symlinks and oversized manifests', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-json-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const regular = join(root, 'regular.json');
  const symlink = join(root, 'symlink.json');
  const oversized = join(root, 'oversized.json');
  writeFileSync(regular, '{"ok":true}');
  symlinkSync(regular, symlink);
  writeFileSync(oversized, '');
  truncateSync(oversized, 2 * 1024 * 1024);

  assert.deepEqual(readJson(regular), { ok: true });
  assert.equal(readJson(symlink), null);
  assert.equal(readJson(oversized), null);
});

test('readJson: rejects a FIFO without opening or blocking', { skip: process.platform === 'win32' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-json-fifo-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fifo = join(root, 'manifest.json');
  execFileSync('mkfifo', [fifo]);
  assert.equal(readJson(fifo), null);
});

function writeInstalled(root, profile, name, version, code = 'same code\n') {
  const dir = join(root, profile, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  writeFileSync(join(dir, 'index.mjs'), code);
}

function writeSingleBundleProfile(root, profile, name, spec) {
  const dir = join(root, profile);
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: profile,
    dependencies: { [name]: spec },
    dsh: { profile: { bundles: [name] } },
  }));
}

test('discoverInstalls: the same range resolving to different versions stays split', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-resolved-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSingleBundleProfile(root, 'p1', 'pkg', '^1.0.0');
  writeSingleBundleProfile(root, 'p2', 'pkg', '^1.0.0');
  writeInstalled(root, 'p1', 'pkg', '1.0.1');
  writeInstalled(root, 'p2', 'pkg', '1.1.0');

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.resolvedVersion).sort(), ['1.0.1', '1.1.0']);
  assert.deepEqual(rows.flatMap((r) => r.installs.map((i) => i.profile)).sort(), ['p1', 'p2']);
});

test('discoverInstalls: byte-identical registry artifacts merge even when declared specs differ', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-same-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSingleBundleProfile(root, 'p1', 'pkg', '^1.0.0');
  writeSingleBundleProfile(root, 'p2', 'pkg', '1.0.1');
  writeInstalled(root, 'p1', 'pkg', '1.0.1');
  writeInstalled(root, 'p2', 'pkg', '1.0.1');

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].installs.map((i) => i.spec).sort(), ['1.0.1', '^1.0.0']);
});

test('discoverInstalls: same registry version with different shipped code stays split', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-patched-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeSingleBundleProfile(root, 'p1', 'pkg', '1.0.1');
  writeSingleBundleProfile(root, 'p2', 'pkg', '1.0.1');
  writeInstalled(root, 'p1', 'pkg', '1.0.1', 'export const build = 1;\n');
  writeInstalled(root, 'p2', 'pkg', '1.0.1', 'export const build = 2;\n');

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].identity, rows[1].identity);
});

test('discoverInstalls: over-limit registry artifacts fail closed to separate realpaths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-large-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const profile of ['p1', 'p2']) {
    writeSingleBundleProfile(root, profile, 'pkg', '^1.0.0');
    writeInstalled(root, profile, 'pkg', '1.0.1');
    // Sparse, so the regression stays fast while exceeding the 16 MiB
    // per-file fingerprint ceiling.
    const payload = join(root, profile, 'node_modules', 'pkg', 'payload.bin');
    writeFileSync(payload, '');
    truncateSync(payload, 17 * 1024 * 1024);
  }

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.identity.includes('unreadable:')));
  assert.deepEqual(rows.map((r) => r.resolvedVersion), ['1.0.1', '1.0.1']);
});

test('discoverInstalls: relative link provenance resolves per profile', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-relative-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const profile of ['p1', 'p2']) {
    writeSingleBundleProfile(root, profile, 'pkg', 'link:./source');
    const source = join(root, profile, 'source');
    writeFileSync(join(root, profile, 'package.json'), JSON.stringify({
      name: profile,
      dependencies: { pkg: 'link:./source' },
      dsh: { profile: { bundles: ['pkg'] } },
    }));
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0' }));
    symlinkSync(source, join(root, profile, 'node_modules', 'pkg'));
  }

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.installs[0].linked));
  assert.notEqual(rows[0].identity, rows[1].identity);
});

test('discoverInstalls: different link spellings for the same canonical target merge', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-canonical-link-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shared = join(root, 'shared');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'package.json'), JSON.stringify({ name: 'pkg', version: '1.0.0' }));

  writeSingleBundleProfile(root, 'p1', 'pkg', 'link:../shared');
  writeSingleBundleProfile(root, 'p2', 'pkg', `link:${shared}`);
  symlinkSync(shared, join(root, 'p1', 'node_modules', 'pkg'));
  symlinkSync(shared, join(root, 'p2', 'node_modules', 'pkg'));

  const rows = discoverInstalls({ root }).filter((r) => r.name === 'pkg');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].installs.map((i) => i.profile), ['p1', 'p2']);
  assert.equal(rows[0].identity, `pkg@link:${realpathSync(shared)}`);
});

test('scan: file snapshots from one source retain distinct versions, claims, and reconciliation drift', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-file-snapshots-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'pkg-source.tgz');
  writeFileSync(source, 'fixture source provenance');
  const fixtures = [
    { profile: 'p1', version: '1.0.0', tool: 'alpha_tool', declared: [] },
    { profile: 'p2', version: '1.0.0', tool: 'beta_tool', declared: ['tool-registration'] },
    { profile: 'p3', version: '1.1.0', tool: 'gamma_tool', declared: null },
  ];

  for (const fixture of fixtures) {
    writeSingleBundleProfile(root, fixture.profile, 'pkg', `file:${source}`);
    writeInstalled(root, fixture.profile, 'pkg', fixture.version);
    const sourceDir = join(root, fixture.profile, 'node_modules', 'pkg', 'src');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, 'index.mjs'),
      `export const tool = { name: '${fixture.tool}', description: 'fixture tool' };\n`,
    );
    const pkg = { name: 'pkg', version: fixture.version };
    if (fixture.declared !== null) pkg.dsh = { capabilities: fixture.declared };
    writeFileSync(join(root, fixture.profile, 'node_modules', 'pkg', 'package.json'), JSON.stringify(pkg));
  }

  const report = await scan({ root, snapshot: false });
  assert.equal(report.plugins.length, 3);
  assert.equal(new Set(report.plugins.map((p) => p.identity)).size, 3);
  assert.ok(report.plugins.every((p) => p.identity.startsWith(`pkg@file:${realpathSync(source)}:`)));
  const byProfile = Object.fromEntries(report.plugins.map((p) => [p.installs[0].profile, p]));
  assert.deepEqual(byProfile.p1.claims.toolNames, ['alpha_tool']);
  assert.deepEqual(byProfile.p2.claims.toolNames, ['beta_tool']);
  assert.deepEqual(byProfile.p3.claims.toolNames, ['gamma_tool']);
  assert.equal(byProfile.p1.reconciliation.status, 'drift');
  assert.equal(byProfile.p2.reconciliation.status, 'match');
  assert.equal(byProfile.p3.reconciliation.status, 'not-declared');
  assert.deepEqual(report.plugins.map((p) => p.version).sort(), ['1.0.0', '1.0.0', '1.1.0']);
  assert.deepEqual(report.versionDrift, [], 'file snapshots stay visible but do not become registry drift');
});
