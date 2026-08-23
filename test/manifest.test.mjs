// Run: node --test test/
// Covers: src/scan/manifest.mjs — reconcile and parseable manifest drafts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftManifest, reconcile } from '../src/scan/manifest.mjs';

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

test('reconcile: string declaration fails closed without throwing', () => {
  const r = reconcile(makeReport('subprocess', ['subprocess']));
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.declared, []);
  assert.deepEqual(r.undeclared, ['subprocess']);
  assert.equal(r.invalidDeclaration.expected, 'string[]');
  assert.equal(r.invalidDeclaration.received, 'string');
  assert.equal(r.invalidDeclaration.invalidItemCount, 0);
  assert.deepEqual(r.unknown, [r.invalidDeclaration.sentinel]);
});

test('reconcile: object declaration fails closed without leaking object values', () => {
  const r = reconcile(makeReport({ subprocess: true }, ['subprocess']));
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.declared, []);
  assert.deepEqual(r.undeclared, ['subprocess']);
  assert.equal(r.invalidDeclaration.received, 'object');
  assert.deepEqual(r.invalidDeclaration.invalidItems, []);
  assert.ok(r.unknown[0].includes('expected string[]'));
});

test('reconcile: mixed array keeps valid ids for diff but marks declaration invalid', () => {
  const r = reconcile(makeReport(
    ['subprocess', 42, { id: 'network-egress' }, 'bogus-id'],
    ['subprocess'],
  ));
  assert.equal(r.status, 'drift');
  assert.deepEqual(r.declared, ['bogus-id', 'subprocess']);
  assert.deepEqual(r.undeclared, []);
  assert.deepEqual(r.unused, ['bogus-id']);
  assert.equal(r.invalidDeclaration.received, 'array');
  assert.equal(r.invalidDeclaration.invalidItemCount, 2);
  assert.deepEqual(r.invalidDeclaration.invalidItems, [
    { index: 1, type: 'number' },
    { index: 2, type: 'object' },
  ]);
  assert.ok(r.unknown.includes('bogus-id'));
  assert.ok(r.unknown.includes(r.invalidDeclaration.sentinel));
});

test('draftManifest: emits a parseable capabilities-only object in stable order', () => {
  const draft = draftManifest(makeReport(null, ['subprocess', 'network-egress']));
  assert.deepEqual(draft.capabilities, ['network-egress', 'subprocess']);
  assert.deepEqual(JSON.parse(draft.json), {
    capabilities: ['network-egress', 'subprocess'],
  });
  assert.equal(Object.hasOwn(JSON.parse(draft.json), 'dsh'), false,
    'the draft must merge into dsh, not replace the entire dsh object');
});

test('draftManifest: zero detected capabilities is still valid JSON', () => {
  const draft = draftManifest(makeReport(null, []));
  assert.deepEqual(draft.capabilities, []);
  assert.deepEqual(JSON.parse(draft.json), { capabilities: [] });
  assert.deepEqual(draft.notes, []);
});
