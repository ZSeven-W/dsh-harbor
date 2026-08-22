// Run: node --test test/
// Covers: src/scan/manifest.mjs — reconcile match/unused/undeclared/unknown
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/scan/manifest.mjs';

function makeReport(declaredCapabilities, detectedIds) {
  return {
    declared: { declaredCapabilities },
    capabilities: Object.fromEntries(detectedIds.map((id) => [id, {}])),
  };
}

test('reconcile: declared matches detected', () => {
  const r = reconcile(makeReport(['subprocess', 'network-egress'], ['subprocess', 'network-egress']));
  assert.equal(r.status, 'match');
  assert.deepEqual(r.undeclared, []);
  assert.deepEqual(r.unused, []);
  assert.deepEqual(r.unknown, []);
});

test('reconcile: declared wider than detected → unused, still match', () => {
  const r = reconcile(makeReport(['subprocess', 'network-egress'], ['subprocess']));
  assert.equal(r.status, 'match');
  assert.deepEqual(r.unused, ['network-egress']);
  assert.deepEqual(r.undeclared, []);
});

test('reconcile: detected but not declared → undeclared, drift', () => {
  const r = reconcile(makeReport(['subprocess'], ['subprocess', 'network-egress']));
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.undeclared, ['network-egress']);
});

test('reconcile: unknown id → drift', () => {
  const r = reconcile(makeReport(['subprocess', 'bogus-id'], ['subprocess']));
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.unknown, ['bogus-id']);
});

test('reconcile: nothing declared', () => {
  const r = reconcile(makeReport(null, ['subprocess']));
  assert.equal(r.status, 'not-declared');
  assert.deepEqual(r.undeclared, ['subprocess']);
  assert.deepEqual(r.unused, []);
  assert.deepEqual(r.unknown, []);
});
