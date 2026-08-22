// Run: node --test test/
// Covers: src/scan/snapshot.mjs — diffAndStore first run, version/capability changes, legacy re-key
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffAndStore } from '../src/scan/snapshot.mjs';

function stateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function report(overrides = {}) {
  return {
    name: 'pkg',
    dir: '/install/pkg',
    identity: 'pkg@1.0.0',
    installs: [{ profile: 'p1' }, { profile: 'p2' }],
    version: '1.0.0',
    capabilities: { 'network-egress': { tier: 'static' } },
    claims: { toolNames: ['t'], routeBases: [], providerIds: [] },
    ...overrides,
  };
}

test('diffAndStore: first run reports every plugin as added', (t) => {
  const res = diffAndStore([report()], { dir: stateDir(t) });
  assert.equal(res.firstRun, true);
  assert.equal(res.previousScanAt, null);
  assert.equal(res.changes.length, 1);
  assert.equal(res.changes[0].type, 'added');
  assert.deepEqual(res.changes[0].profiles, ['p1', 'p2']);
});

test('diffAndStore: a version change is reported with profiles', (t) => {
  const dir = stateDir(t);
  const base = { identity: 'pkg@link:../pkg' };
  diffAndStore([report({ ...base, version: '1.0.0' })], { dir });
  const res = diffAndStore([report({ ...base, version: '1.0.1' })], { dir });
  const change = res.changes.find((c) => c.type === 'version');
  assert.ok(change, 'version change exists');
  assert.equal(change.detail, '1.0.0 → 1.0.1');
  assert.deepEqual(change.profiles, ['p1', 'p2']);
});

test('diffAndStore: capability add/remove changes carry profiles', (t) => {
  const dir = stateDir(t);
  diffAndStore([report({ capabilities: { a: {}, b: {} } })], { dir });
  const res = diffAndStore([report({ capabilities: { a: {}, c: {} } })], { dir });
  const added = res.changes.find((c) => c.type === 'capability-added');
  const removed = res.changes.find((c) => c.type === 'capability-removed');
  assert.ok(added, 'capability-added change exists');
  assert.ok(removed, 'capability-removed change exists');
  assert.deepEqual(added.profiles, ['p1', 'p2']);
  assert.deepEqual(removed.profiles, ['p1', 'p2']);
});

test('diffAndStore: legacy snapshot (no identity) re-keys without false added', (t) => {
  const dir = stateDir(t);
  // Snapshots written before identity existed were keyed by name\0dir and
  // stored no identity field on the record.
  const legacy = {
    scannedAt: '2024-01-01T00:00:00.000Z',
    plugins: [{
      name: 'pkg',
      dir: '/install/pkg',
      version: '1.0.0',
      profiles: ['p1', 'p2'],
      capabilities: ['network-egress'],
      toolNames: ['t'],
      routeBases: [],
      providerIds: [],
    }],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(legacy, null, 2));

  const res = diffAndStore([report()], { dir });
  assert.equal(res.firstRun, false);
  assert.equal(res.changes.length, 0);

  // The new snapshot is re-keyed onto the provenance identity.
  const written = JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8'));
  assert.equal(written.plugins[0].identity, 'pkg@1.0.0');
});
