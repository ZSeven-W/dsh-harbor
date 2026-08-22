// Run: node --test test/
// Covers: src/scan/discover.mjs — discoverInstalls grouping by provenance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverInstalls } from '../src/scan/discover.mjs';

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
  const alpha = rows.find((r) => r.identity === 'alpha@1.0.0-rc.1');
  assert.ok(alpha, 'alpha row exists');
  assert.equal(alpha.installs.length, 2);
  assert.deepEqual(alpha.installs.map((i) => i.profile).sort(), ['p1', 'p2']);
  assert.ok(alpha.installs.every((i) => i.linked === false));
});

test('discoverInstalls: link: and npm versions stay separate rows', (t) => {
  const rows = discoverInstalls({ root: buildProfiles(t) });
  const npm = rows.find((r) => r.identity === 'beta@1.0.0-rc.1');
  const link = rows.find((r) => r.identity === 'beta@link:../beta');
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
  const gamma = rows.find((r) => r.identity === 'gamma@file:../gamma');
  assert.ok(gamma, 'gamma file row exists');
  assert.equal(gamma.installs.length, 1);
  assert.equal(gamma.installs[0].linked, true);

  const alpha = rows.find((r) => r.identity === 'alpha@1.0.0-rc.1');
  assert.ok(alpha.installs.every((i) => i.linked === false));
});
