// Run: node --test 'test/*.test.mjs'
// Covers: src/hub/freshness.mjs — fingerprintSource, readClientBuildId
//
// Zero network, zero touches of the real tree: every case builds a tiny fake
// repo (src/scan/*.mjs + src/hub/*.mjs, or lib/client.js) inside mkdtemp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintSource, readClientBuildId } from '../src/hub/freshness.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'harbor-freshness-'));
  mkdirSync(join(root, 'src', 'scan'), { recursive: true });
  mkdirSync(join(root, 'src', 'hub'), { recursive: true });
  writeFileSync(join(root, 'src', 'scan', 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'scan', 'b.mjs'), 'export const b = 2;\n');
  writeFileSync(join(root, 'src', 'hub', 'c.mjs'), 'export const c = 3;\n');
  return root;
}

async function withRepo(body) {
  const root = makeRepo();
  try {
    return await body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ------------------------------------------------ fingerprintSource

test('fingerprintSource: identical content yields an identical 16-hex fingerprint', async () => {
  await withRepo(async (root) => {
    const first = await fingerprintSource(root);
    const second = await fingerprintSource(root);
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{16}$/);
  });
});

test('fingerprintSource: one changed byte changes the fingerprint (content hash, not mtime)', async () => {
  await withRepo(async (root) => {
    const before = await fingerprintSource(root);
    // Same length, one byte different — an mtime-only check could not care
    // less, a content hash must.
    writeFileSync(join(root, 'src', 'scan', 'b.mjs'), 'export const b = 3;\n');
    const after = await fingerprintSource(root);
    assert.notEqual(after, before);
  });
});

test('fingerprintSource: deleting a file changes the fingerprint', async () => {
  await withRepo(async (root) => {
    const before = await fingerprintSource(root);
    rmSync(join(root, 'src', 'scan', 'a.mjs'));
    const after = await fingerprintSource(root);
    assert.notEqual(after, before);
  });
});

test('fingerprintSource: an unreadable file flips the skip counter and changes the fingerprint', async () => {
  await withRepo(async (root) => {
    const before = await fingerprintSource(root);
    chmodSync(join(root, 'src', 'scan', 'b.mjs'), 0o000);
    try {
      const after = await fingerprintSource(root);
      assert.notEqual(after, before);
    } finally {
      chmodSync(join(root, 'src', 'scan', 'b.mjs'), 0o644); // let rmSync clean up
    }
  });
});

test('fingerprintSource: never follows an mjs symlink outside the source tree', async () => {
  await withRepo(async (root) => {
    const outside = join(root, 'outside.mjs');
    writeFileSync(outside, 'export const outside = 1;\n');
    symlinkSync(outside, join(root, 'src', 'scan', 'linked.mjs'));
    const before = await fingerprintSource(root);
    writeFileSync(outside, 'export const outside = 2;\n');
    const after = await fingerprintSource(root);
    assert.equal(after, before);
  });
});

test('fingerprintSource: oversized files use a bounded metadata fallback', async () => {
  await withRepo(async (root) => {
    const path = join(root, 'src', 'scan', 'large.mjs');
    writeFileSync(path, 'a'.repeat(1024 * 1024));
    const before = await fingerprintSource(root, { maxFileBytes: 64, maxTotalBytes: 256 });
    writeFileSync(path, 'b'.repeat(1024 * 1024));
    utimesSync(path, new Date(2_000_000), new Date(2_000_000));
    const after = await fingerprintSource(root, { maxFileBytes: 64, maxTotalBytes: 256 });
    assert.match(before, /^[0-9a-f]{16}$/);
    assert.notEqual(after, before);
  });
});

// ------------------------------------------------ readClientBuildId

test('readClientBuildId: extracts the stamped id from a fake bundle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-freshness-'));
  try {
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'client.js'),
      'window.__ModuleLoader__.load({ factory: () => {\n// panel code\n} });\n//__HARBOR_CLIENT_BUILD__=0123456789abcdef\n');
    assert.equal(await readClientBuildId(root), '0123456789abcdef');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readClientBuildId: returns null when lib/client.js is missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-freshness-'));
  try {
    assert.equal(await readClientBuildId(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readClientBuildId: returns null when the bundle carries no identifier', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-freshness-'));
  try {
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'client.js'), 'window.__ModuleLoader__.load({ factory: () => {} });\n');
    assert.equal(await readClientBuildId(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readClientBuildId: reads only the bounded tail and rejects a symlink', async () => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-freshness-'));
  try {
    mkdirSync(join(root, 'lib'), { recursive: true });
    const outside = join(root, 'outside-client.js');
    writeFileSync(outside, 'x'.repeat(32 * 1024) + '\n//__HARBOR_CLIENT_BUILD__=fedcba9876543210\n');
    symlinkSync(outside, join(root, 'lib', 'client.js'));
    assert.equal(await readClientBuildId(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
