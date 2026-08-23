// Run: node --test 'test/*.test.mjs'
// Covers: src/scan/detectors.mjs — pattern precision, fetch-alias coverage, and
// the self-match regressions (credential-handling, foreign-config,
// network-egress) fixed so the detector table stops matching its own source.
//
// Fixture style: the strings under test are assembled from fragments at
// runtime instead of being spelled out literally. harbor scans its own
// repository, and this file is inside it — a literal fixture (the npm
// auth-token key, a dotted global fetch reference, a bare spawn call) would
// make the scanner report capabilities for the test itself, which is the very
// self-match bug these tests guard. Assembly keeps the assertions exact while
// the file stays invisible to the scanner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPABILITIES, byId, capabilityMatches } from '../src/scan/detectors.mjs';

const get = (id) => {
  const entry = byId[id];
  assert.ok(entry, `capability ${id} missing from the table`);
  return entry;
};

// Same compilation the scanner uses (scanSources in src/scan/inspect.mjs):
// every pattern is re-compiled from source+flags per file, then matched.
const hits = (patterns, text) => patterns.flatMap((p) => [...text.matchAll(new RegExp(p.source, p.flags))]);

const detectorSource = readFileSync(new URL('../src/scan/detectors.mjs', import.meta.url), 'utf8');

// --- runtime-assembled fixtures (see the header note) ---
const join = (...parts) => parts.join('');
const AUTH_TOKEN_ENV = join('const t = process.env.', '_auth', 'Token');
const API_KEY_CAMEL = join('api', 'Key: ', "'x'");
const API_KEY_SNAKE = join('api', '_', 'key=');
const BEARER_AUTH = join('Bea', 'rer abc');
const FETCH_ALIAS_BINDING = join('const fetchImpl = globalThis.', 'fetch', ';');
const FETCH_ALIAS_CALL = 'await fetchImpl(url)';
const FETCH_DEFAULT_PARAM = join('const { fetchImpl = globalThis.', 'fetch', ' }', ' = options;');
const FETCH_DESTRUCTURED = join('const { ', 'fetch', ' }', ' = globalThis;');
const SPAWN_CALL = join('const p = ', 'spawn', "('ls');");
const HUB_SPAWN_CALL = join('const p = hub.', 'spawn', "('ls');");

test('credential patterns still hit real credential text', () => {
  const patterns = get('credential-handling').match.patterns;
  for (const fixture of [AUTH_TOKEN_ENV, API_KEY_CAMEL, API_KEY_SNAKE, BEARER_AUTH]) {
    assert.equal(
      hits(patterns, fixture).length,
      1,
      `expected exactly one credential hit for ${JSON.stringify(fixture)}`,
    );
  }
});

test('credential pattern has zero hits on its own source file (self-match regression)', () => {
  const patterns = get('credential-handling').match.patterns;
  assert.equal(
    hits(patterns, detectorSource).length,
    0,
    'the credential pattern must not match the detector table it lives in',
  );
});

test('foreign-config pattern has zero hits on its own source file', () => {
  const patterns = get('foreign-config').match.patterns;
  assert.equal(
    hits(patterns, detectorSource).length,
    0,
    'the foreign-config note must not cite itself as evidence',
  );
});

test('no source pattern matches the detector table itself', () => {
  const found = [];
  for (const entry of CAPABILITIES) {
    if (!entry.match) continue;
    if (entry.match.require && !entry.match.require.test(detectorSource)) continue;
    for (const m of hits(entry.match.patterns, detectorSource)) {
      found.push(`${entry.id} :: ${m[0]}`);
    }
  }
  assert.deepEqual(found, [], 'every pattern must stay blind to the table that defines it');
});

test('network-egress detects fetch taken by reference, not only direct calls', () => {
  const patterns = get('network-egress').match.patterns;
  const aliased = `${FETCH_ALIAS_BINDING}\n${FETCH_ALIAS_CALL}`;
  assert.equal(
    hits(patterns, aliased).length,
    1,
    'the binding line must hit; the aliased call site alone cannot',
  );
  assert.equal(
    hits(patterns, FETCH_DESTRUCTURED).length,
    1,
    'a destructured fetch binding must hit',
  );
  assert.ok(
    hits(patterns, FETCH_DEFAULT_PARAM).length > 0,
    'a default parameter bound to the global fetch must hit',
  );
});

test('network-egress stays precise: helper names do not hit', () => {
  const patterns = get('network-egress').match.patterns;
  for (const text of ['prefetchData()', 'refetch()', 'fetcher(']) {
    assert.equal(
      hits(patterns, text).length,
      0,
      `${JSON.stringify(text)} must not hit network-egress`,
    );
  }
});

test('subprocess patterns keep their precision and the import gate', () => {
  const entry = get('subprocess');
  assert.equal(hits(entry.match.patterns, SPAWN_CALL).length, 1, 'a bare spawn call must hit');
  assert.equal(
    hits(entry.match.patterns, HUB_SPAWN_CALL).length,
    0,
    'a method call on another object must not hit',
  );
  // The import gate blocks the same bare call when no child_process import exists…
  assert.ok(!entry.match.require.test(SPAWN_CALL), 'no import → gate closed');
  // …and passes it with the real import, where only the call site is evidence.
  const gated = join("import { spawn } from 'node:child_process';", '\n', SPAWN_CALL);
  assert.ok(entry.match.require.test(gated), 'import present → gate open');
  assert.equal(hits(entry.match.patterns, gated).length, 1, 'only the bare call site is evidence');
});

test('subprocess matching follows namespace and imported aliases only', () => {
  const entry = get('subprocess');
  const fixtures = [
    join("import * as cp from 'node:child_process';", '\n', "cp.spawn('one');"),
    join("import { spawn as launch } from 'child_process';", '\n', "launch('two');"),
    join("const cp = require('node:child_process');", '\n', "cp.spawnSync('three');"),
    join("const { execFile: runFile } = require('child_process');", '\n', "runFile('four');"),
    join("const cp = require('child_process');", '\n', 'const launch = cp.spawn;', '\n', "launch('five');"),
  ];
  for (const fixture of fixtures) {
    assert.equal(capabilityMatches(entry, fixture).length, 1, fixture);
  }

  const unrelated = join(
    "import { execFile } from 'node:child_process';",
    '\n',
    "const obj = { spawn() {} };",
    '\n',
    "obj.spawn('not-a-process-binding');",
  );
  assert.equal(capabilityMatches(entry, unrelated).length, 0, 'an arbitrary object method stays invisible');
});
