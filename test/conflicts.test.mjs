// Run: node --test test/
// Covers: src/scan/conflicts.mjs — findConflicts key/profile scoping and severity
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConflicts } from '../src/scan/conflicts.mjs';

function report(name, dir, profiles, claims = {}, hooks = []) {
  return {
    name,
    dir,
    installs: profiles.map((profile) => ({ profile })),
    claims: {
      toolNames: claims.toolNames ?? [],
      routeBases: claims.routeBases ?? [],
      providerIds: claims.providerIds ?? [],
      clientModuleIds: claims.clientModuleIds ?? [],
    },
    hooks,
  };
}

test('findConflicts: same name in different profiles is not a conflict', () => {
  const conflicts = findConflicts([
    report('dup', '/dup-a', ['p1'], { toolNames: ['search'] }),
    report('dup', '/dup-b', ['p2'], { toolNames: ['search'] }),
  ]);
  assert.deepEqual(conflicts, []);
});

test('findConflicts: same profile and same key is a clash', () => {
  const conflicts = findConflicts([
    report('a', '/a', ['p1'], { toolNames: ['search'] }),
    report('b', '/b', ['p1'], { toolNames: ['search'] }),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'tool-name');
  assert.equal(conflicts[0].key, 'search');
  assert.equal(conflicts[0].severity, 'clash');
  assert.deepEqual(conflicts[0].owners.map((o) => o.name).sort(), ['a', 'b']);
  assert.deepEqual(conflicts[0].owners[0].profiles, ['p1']);
});

test('findConflicts: order-sensitive hooks are info severity', () => {
  const conflicts = findConflicts([
    report('a', '/a', ['p1'], {}, ['agent/message']),
    report('b', '/b', ['p1'], {}, ['agent/message']),
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'order-sensitive');
  assert.equal(conflicts[0].severity, 'info');
});

test('findConflicts: clash sorts before info (severity distinguishes them)', () => {
  const conflicts = findConflicts([
    report('a', '/a', ['p1'], { toolNames: ['search'] }, ['agent/message']),
    report('b', '/b', ['p1'], { toolNames: ['search'] }, ['agent/message']),
  ]);
  assert.deepEqual(conflicts.map((c) => c.severity), ['clash', 'info']);
  assert.deepEqual(conflicts.map((c) => c.kind), ['tool-name', 'order-sensitive']);
});
