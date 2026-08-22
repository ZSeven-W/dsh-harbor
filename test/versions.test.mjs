// Run: node --test 'test/*.test.mjs'
// Covers: src/scan/versions.mjs — compareVersions, crossProfileDrift, checkUpstream
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, crossProfileDrift, checkUpstream } from '../src/scan/versions.mjs';

// ------------------------------------------------ compareVersions

test('compareVersions: rc.10 ranks newer than rc.9 (string compare would fail)', () => {
  assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.9') > 0);
  assert.ok(compareVersions('1.0.0-rc.9', '1.0.0-rc.10') < 0);
});

test('compareVersions: release outranks same-numbered prerelease', () => {
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.9') > 0);
  assert.ok(compareVersions('1.0.0-rc.9', '1.0.0') < 0);
});

test('compareVersions: identical versions are equal', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.3-rc.1', '1.2.3-rc.1'), 0);
});

test('compareVersions: unparseable input returns 0', () => {
  assert.equal(compareVersions('not-a-version', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', 'garbage'), 0);
});

// ------------------------------------------------ crossProfileDrift

test('crossProfileDrift: two registry versions trigger drift', () => {
  const reports = [
    { name: 'pkg', version: '1.0.0-rc.5', installs: [{ profile: 'a', spec: '1.0.0-rc.5', linked: false }] },
    { name: 'pkg', version: '1.0.0-rc.7', installs: [{ profile: 'b', spec: '1.0.0-rc.7', linked: false }] },
  ];
  const drift = crossProfileDrift(reports);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].name, 'pkg');
  assert.equal(drift[0].newest, '1.0.0-rc.7');
});

test('crossProfileDrift: a link row never triggers drift and is never newest', () => {
  const linkOnly = [
    { name: 'pkg', version: '9.9.9', installs: [{ profile: 'a', spec: 'link:../pkg', linked: true }] },
    { name: 'pkg', version: '1.0.0-rc.5', installs: [{ profile: 'b', spec: '1.0.0-rc.5', linked: false }] },
  ];
  assert.deepEqual(crossProfileDrift(linkOnly), []);

  const withDrift = [
    { name: 'pkg', version: '1.0.0-rc.5', installs: [{ profile: 'a', spec: '1.0.0-rc.5', linked: false }] },
    { name: 'pkg', version: '1.0.0-rc.7', installs: [{ profile: 'b', spec: '1.0.0-rc.7', linked: false }] },
    { name: 'pkg', version: '9.9.9', installs: [{ profile: 'c', spec: 'link:../pkg', linked: true }] },
  ];
  const drift = crossProfileDrift(withDrift);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].newest, '1.0.0-rc.7');
  assert.equal(drift[0].rows.length, 3);
  assert.equal(drift[0].rows[0].linked, true);
});

test('crossProfileDrift: identical versions return an empty array', () => {
  const reports = [
    { name: 'pkg', version: '1.0.0-rc.5', installs: [{ profile: 'a', spec: '1.0.0-rc.5', linked: false }] },
    { name: 'pkg', version: '1.0.0-rc.5', installs: [{ profile: 'b', spec: '1.0.0-rc.5', linked: false }] },
  ];
  assert.deepEqual(crossProfileDrift(reports), []);
});

test('crossProfileDrift: behind is strictly-below, kind mirrors the spec prefix', () => {
  const reports = [
    { name: 'pkg', version: '0.1.0-rc.1', installs: [{ profile: 'web', spec: '0.1.0-rc.1', linked: false }] },
    { name: 'pkg', version: '0.1.0-rc.2', installs: [{ profile: 'demo', spec: '0.1.0-rc.2', linked: false }] },
    { name: 'pkg', version: '0.1.0-rc.3', installs: [{ profile: 'work', spec: 'link:../pkg', linked: true }] },
    { name: 'pkg', version: '0.1.0-rc.4', installs: [{ profile: 'local', spec: 'file:../pkg', linked: true }] },
  ];
  const drift = crossProfileDrift(reports);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].newest, '0.1.0-rc.2');
  const rows = Object.fromEntries(drift[0].rows.map((r) => [r.version, r]));
  assert.equal(rows['0.1.0-rc.1'].behind, true); // below the published baseline
  assert.equal(rows['0.1.0-rc.1'].kind, 'registry');
  assert.equal(rows['0.1.0-rc.2'].behind, false); // equal to the baseline
  assert.equal(rows['0.1.0-rc.2'].kind, 'registry');
  // The regression this fix exists for: a link row AHEAD of the baseline must
  // not be flagged — running ahead is the normal state of a working tree.
  assert.equal(rows['0.1.0-rc.3'].behind, false);
  assert.equal(rows['0.1.0-rc.3'].kind, 'link');
  assert.equal(rows['0.1.0-rc.4'].behind, false); // file rows get the same leniency
  assert.equal(rows['0.1.0-rc.4'].kind, 'file');
});

// ------------------------------------------------ checkUpstream

function upstreamDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-upstream-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function report(name, version, installs) {
  return { name, version, identity: name + '@' + version, installs };
}

test('checkUpstream: behind/current/ahead/local/unknown', async (t) => {
  const dir = upstreamDir(t);
  const requests = [];
  const LATEST = { 'behind-pkg': '1.0.1', 'current-pkg': '1.0.0', 'ahead-pkg': '0.9.0' };
  const fetchImpl = async (url) => {
    requests.push(url);
    const name = url.split('/').pop();
    if (name === 'unknown-pkg') throw new Error('boom');
    return { ok: true, json: async () => ({ 'dist-tags': { latest: LATEST[name] } }) };
  };
  const reports = [
    report('behind-pkg', '1.0.0', [{ profile: 'a', spec: '1.0.0', linked: false }]),
    report('current-pkg', '1.0.0', [{ profile: 'a', spec: '1.0.0', linked: false }]),
    report('ahead-pkg', '1.0.1', [{ profile: 'a', spec: '1.0.1', linked: false }]),
    report('local-pkg', '9.9.9', [{ profile: 'a', spec: 'link:../pkg', linked: true }]),
    report('unknown-pkg', '1.0.0', [{ profile: 'a', spec: '1.0.0', linked: false }]),
  ];
  const res = await checkUpstream(reports, { dir, now: 1000000, ttlMs: 60000, fetchImpl });
  const byName = Object.fromEntries(res.results.map((r) => [r.name, r]));

  assert.equal(byName['behind-pkg'].status, 'behind');
  assert.equal(byName['behind-pkg'].latest, '1.0.1');
  assert.equal(byName['current-pkg'].status, 'current');
  assert.equal(byName['ahead-pkg'].status, 'ahead');
  assert.equal(byName['local-pkg'].status, 'local');
  assert.equal(byName['local-pkg'].latest, null);
  assert.equal(byName['unknown-pkg'].status, 'unknown');
  assert.equal(byName['unknown-pkg'].error, 'boom');
  assert.ok(Array.isArray(res.registryHosts));
  assert.ok(requests.every((u) => !u.endsWith('/local-pkg')));
});

test('checkUpstream: same package across rows fetches only once', async (t) => {
  const dir = upstreamDir(t);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.1' } }) };
  };
  const reports = [
    report('multi', '1.0.0', [{ profile: 'a', spec: '1.0.0', linked: false }]),
    report('multi', '1.0.0', [{ profile: 'b', spec: '1.0.0', linked: false }]),
  ];
  const res = await checkUpstream(reports, { dir, now: 2000000, ttlMs: 60000, fetchImpl });
  assert.equal(requests.length, 1);
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].status, 'behind');
  assert.equal(res.results[1].status, 'behind');
});

test('checkUpstream: within ttl the cache is used and no request fires', async (t) => {
  const dir = upstreamDir(t);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.1' } }) };
  };
  const reports = [report('cached-pkg', '1.0.0', [{ profile: 'a', spec: '1.0.0', linked: false }])];

  const t0 = 1000000;
  await checkUpstream(reports, { dir, now: t0, ttlMs: 60000, fetchImpl });
  assert.equal(requests.length, 1);

  const res2 = await checkUpstream(reports, { dir, now: t0 + 30000, ttlMs: 60000, fetchImpl });
  assert.equal(requests.length, 1);
  assert.equal(res2.results[0].cached, true);
  assert.equal(res2.results[0].status, 'behind');
});
