import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistryReader } from '../scripts/board/registry-fetch.mjs';
import { releaseTargets } from '../scripts/board/release-targets.mjs';

test('board registry honors Retry-After seconds and dates before repeating a read', async () => {
  for (const retryAfter of ['60', new Date(60_000).toUTCString()]) {
    let time = 0, calls = 0;
    const waits = [];
    const read = createRegistryReader({ now: () => time, wait: async ms => { waits.push(ms); time += ms; }, fetchImpl: async () => ++calls === 1 ? new Response(null, { status: 429, headers: { 'retry-after': retryAfter } }) : Response.json({ ok: true }) });
    assert.deepEqual(await read('https://registry.example/search'), { ok: true });
    assert.deepEqual(waits, [60_000]);
    assert.equal(calls, 2);
  }
});
test('board registry backs off without a header and refuses permanent errors', async () => {
  let time = 0, calls = 0;
  const waits = [];
  const read = createRegistryReader({ retries: 3, now: () => time, wait: async ms => { waits.push(ms); time += ms; }, fetchImpl: async () => { calls++; return new Response(null, { status: 429 }); } });
  await assert.rejects(read('https://registry.example/search'), /HTTP 429/);
  assert.deepEqual(waits, [15_000, 30_000]);
  assert.equal(calls, 3);
  const unauthorized = createRegistryReader({ fetchImpl: async () => new Response(null, { status: 401 }), wait: async () => { throw new Error('must not retry'); } });
  await assert.rejects(unauthorized('https://registry.example/private'), /HTTP 401/);
});
test('a latest/next move schedules one board; alpha still gets a contract diff', () => {
  const plan = releaseTargets([
    { tag: 'alpha', from: '0.1.5-alpha.2', to: '0.2.1-alpha.1' },
    { tag: 'latest', from: '0.1.5-rc.1', to: '0.2.0-rc.2' },
    { tag: 'next', from: '0.1.5-rc.2', to: '0.2.0-rc.2' },
  ]);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.filter(p => p.runBoard).map(p => p.to), ['0.2.0-rc.2']);
});


test('overlapping search pages count one package and refresh ambiguous cached versions', async () => {
  const { uniquePackages } = await import('../scripts/board/packages.mjs');
  const rows = uniquePackages([
    { name: 'a', version: '1', modified: '2026-09-01' },
    { name: 'b', version: '1', modified: '2026-09-01' },
    { name: 'a', version: '2', modified: '2026-10-01' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].version, '2');
  assert.equal(rows[0].ambiguous, true);
  assert.equal(rows[1].name, 'b');
});


test('cached results survive reassignment and old unrelated shard rows are removed', async () => {
  const { mergeCachedResults, cachedShard } = await import('../scripts/board/cache.mjs');
  const cache = mergeCachedResults([
    { results: { a: { version: '1', probeSchema: 2, probedAt: '2026-10-01' }, b: { version: '1', probeSchema: 2 } } },
    { results: { a: { version: '2', probeSchema: 2, probedAt: '2026-10-02' } } },
  ]);
  const shard = cachedShard([{ name: 'a', version: '2' }, { name: 'new', version: '1' }], cache, 2);
  assert.deepEqual(Object.keys(shard), ['a']);
  assert.equal(shard.a.version, '2');
  assert.deepEqual(cachedShard([{ name: 'a', version: '1' }], cache, 2), {});
});
